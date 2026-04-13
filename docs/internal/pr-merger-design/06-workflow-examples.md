# 06. Workflow Examples

> **Canonical source**: 00-design-decisions.md § T14 (2026-04-13) が最新。T14 は
> agent 起動フローを「orchestrator → agent runner
> (`agents/scripts/run-agent.ts` + `AgentRunner` + `boundary-hooks.ts`) →
> merger-cli」の 3 層 runner-mediated flow として確定し、T12 の「案 A
> 採用」判断は維持しつつ agent 起動経路の記述 (b.1 agent.json の permissions /
> template 構文 / b.3 diagram) を supersede する。b.1 agent.json は T14 Decision
> 5 の最終形が authoritative。Scheduler 単一化 (orchestrator) と
> `issueStore.path` directory 形式は Amendment T10 を継承、verdict JSON
> フィールド名・outcome 名は Amendment T8 + 03-data-flow.md の JSON Schema
> (verdict-1.0.0) が authoritative。

本ドキュメントは PR Merger 用の workflow 定義と agent 定義の具体例、
試験運用手順、CI 連携例を示す。すべて valid JSON / YAML として 提供する。

## a. `.agent/workflow-merge.json` 全体

既存の `.agent/workflow.json` とは独立した workflow 定義。F1 (`--workflow`
で別名指定・並走安全) と F2 (`labelPrefix` 分離) を 利用し、`issueStore.path`
も分離 (F3) して lock 競合を回避する。

```json
{
  "$schema": "../../agents/orchestrator/workflow-schema.json",
  "version": "1.0.0",
  "labelPrefix": "merge",
  "phases": {
    "merge-ready": {
      "type": "actionable",
      "priority": 1,
      "agent": "merger"
    },
    "merge-blocked": {
      "type": "blocking"
    },
    "merged": {
      "type": "terminal"
    }
  },
  "labelMapping": {
    "ready": "merge-ready",
    "blocked": "merge-blocked",
    "done": "merged"
  },
  "agents": {
    "merger": {
      "role": "validator",
      "directory": "merger",
      "outputPhases": {
        "merged": "merged",
        "ci-pending": "merge-ready",
        "approvals-missing": "merge-blocked",
        "conflicts": "merge-blocked",
        "rejected": "merge-blocked"
      },
      "fallbackPhase": "merge-blocked"
    }
  },
  "rules": {
    "maxCycles": 3,
    "cycleDelayMs": 60000
  },
  "issueStore": {
    "path": ".agent/climpt/tmp/issues-merge"
  }
}
```

### a.1 labelPrefix の解説

`labelPrefix: "merge"` と `labelMapping` の組み合わせにより、 orchestrator
が実際に GitHub 上で付与・検索するラベル名は以下となる (F2 の仕様に従う):

| labelMapping のキー | phase 名        | 実ラベル (prefix 適用後) |
| ------------------- | --------------- | ------------------------ |
| `ready`             | `merge-ready`   | `merge:ready`            |
| `blocked`           | `merge-blocked` | `merge:blocked`          |
| `done`              | `merged`        | `merge:done`             |

既存 workflow.json は `labelPrefix` を別値 (例: `review` / `impl`) に
しているため、ラベル名前空間が衝突しない。両 workflow を並走させても 相互に
phase 遷移が干渉しない。

### a.2 outputPhases の解説

merger agent (validator role) が出力する canonical outcome 名 (`merged` /
`ci-pending` / `approvals-missing` / `conflicts` / `rejected`) を phase
にマッピングする (F4)。outcome 未知の場合は `fallbackPhase` の `merge-blocked`
に落ちる (fail-safe)。

| outcome             | 遷移先 phase           | 意味                                                                                                                  |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `merged`            | `merged` (terminal)    | マージ完了                                                                                                            |
| `ci-pending`        | `merge-ready` (再試行) | CI 完了待ちで次サイクルへ                                                                                             |
| `approvals-missing` | `merge-blocked`        | レビュー再要求                                                                                                        |
| `conflicts`         | `merge-blocked`        | 手動 resolve 要求                                                                                                     |
| `rejected`          | `merge-blocked`        | schema drift / reviewer 拒否 / CI 失敗 / base-branch 不一致 (canonical 5 値の 1 つ、00-design-decisions.md § T8 準拠) |

### a.3 issueStore.path の分離

`.agent/climpt/tmp/issues-merge/` を専用ディレクトリにすることで、 既存
`.agent/climpt/tmp/issues/` (impl/review サイクル用) と per-workflow lock (F3)
が衝突しない。

> Canonical: `.agent/climpt/tmp/issues-merge` (directory) — orchestrator の
> `IssueStore` 実装 (`agents/orchestrator/issue-store.ts:8-13, 59, 122`) が
> storePath を `Deno.mkdir` / `Deno.readDir` で扱う仕様に準拠
> (00-design-decisions.md § T10 Decision 3)。

### a.4 custom exec を持たないことの明示

`workflow-merge.json` は custom exec
機構を一切持たず、`agents.merger.directory: "merger"` によって
`.agent/merger/agent.json` を参照するのみである。orchestrator は `merge-ready`
phase を検知した際、validator agent 既存機構 (`agents/scripts/run-agent.ts` を
subprocess 起動し、`AgentRunner` 経由で closure step を実行する標準経路) に
dispatch する (00-design-decisions.md § T14 Decision 1)。phase handler 側で
`Deno.Command` を直接呼ぶような custom exec は存在せず、merger 固有の実行機構は
agent.json closure step runner のみに集約される。

## b. `.agent/merger/agent.json` スケルトン

merger-cli を起動する薄い wrapper として定義する。**採用: 案 A (AgentDefinition
の closure step 経由で `merge-pr.ts` を spawn)** を維持し、 起動経路は
**runner-mediated flow** (orchestrator → `agents/scripts/run-agent.ts` →
`AgentRunner` → closure step) に揃える (00-design-decisions.md § T12 Decision
2 + § T14 Decision 1/5)。

### b.1 案 A: AgentDefinition closure step 経由で merger-cli を呼ぶ (採用, runner-mediated)

```json
{
  "name": "merger",
  "role": "validator",
  "description": "Deterministic PR merger. Closure step spawns agents/scripts/merge-pr.ts as subprocess. No LLM involvement.",
  "parameters": {
    "pr": { "type": "number", "required": true },
    "verdictPath": { "type": "string", "required": true }
  },
  "steps": [
    {
      "id": "merge",
      "type": "closure",
      "runner": {
        "command": "deno",
        "args": [
          "run",
          "--allow-read",
          "--allow-run",
          "--allow-net",
          "agents/scripts/merge-pr.ts",
          "--pr",
          "${context.prNumber}",
          "--verdict",
          "${context.verdictPath}"
        ]
      }
    }
  ]
}
```

permissions は T14 で `--allow-read --allow-run --allow-net` の 3 種に限定した
(旧 T12 案にあった `--allow-write` / `--allow-env` は削除)。`merge-pr.ts` は
verdict ファイルを読むのみで書き込みは行わず、stdout への JSON emission で
output を返すため `--allow-write` 不要。環境変数参照も現時点で不要。

`args` 内の `${context.prNumber}` / `${context.verdictPath}` は、agent runner が
closure step 起動前に substitute する template (T14 Decision 4)。 `context.*`
namespace は issue.payload と agent parameters をマージした
実行コンテキストで、`context = { ...issuePayload, ...agentParameters }` (衝突時
parameters 優先) で bind される。**この template substitution は 現行
`AgentRunner` に未実装であり、Phase 0-b prerequisite
として先行実装する必要がある** (00-design-decisions.md § T14 Decision
2)。未解決テンプレートは起動前検査で error とする。

**採用理由** (00-design-decisions.md § T12 Decision 2 + § T14 Decision 1):

- **Runner-mediated flow**: orchestrator は `agents/scripts/run-agent.ts` を
  subprocess 起動し、`AgentRunner.run()` が `boundary-hooks.ts` を通過した 上で
  closure step runner を dispatch する。本設計は agent runner 標準経路
  を通過する (T14 Decision 1)。
- **既存機構の活用 + Phase 0 拡張**: validator agent 起動パスは既に closure step
  runner で `Deno.Command` を呼ぶ構造 (F6)。本設計が必要と
  する新規機能は「closure.runner.args の `${context.*}` template
  substitution」と「issue.payload → agent.parameters binding」の 2 点 (T14
  Decision 2 Phase 0-a/0-b) のみで、実装規模は最小。
- **LLM 非介在の維持**: closure step は prompt/LLM 呼出を伴わない (runner が
  subprocess を spawn するのみ)。runner-mediated flow 下でも Design Principle #2
  (LLM を merge path から排除) は崩れない。 `merge-pr.ts` 自身が LLM import
  を一切持たない (05 section 2.1 禁則事項 で担保) 限り、LLM 経由で `gh pr merge`
  に到達する経路は構造上存在しない。
- **F5 / F10 整合 (nested subprocess escape)**: `merge-pr.ts` は `AgentRunner`
  よりさらに深い独立 Deno プロセスとして spawn されるため、 merge-pr.ts 内部の
  `Deno.Command("gh", ["pr", "merge", ...])` は SDK の Bash tool-invocation
  経路を通らず、`BOUNDARY_BASH_PATTERNS` (F5) の enforcement
  対象外となる。これは F10 (`finalizeWorktreeBranch()` の `gh pr create` を
  `run-agent.ts` から実行するパターン) と同原理 (T14 Decision 3)。

### b.2 案 B: 旧「watcher 直接起動 / actionable phase handler custom exec」は棄却

案 B の 2 系統 —「actionable phase handler の custom exec による直接 spawn」
および「merge-watcher.ts による独立プロセス起動」— は共に棄却済み。T10 で
merge-watcher.ts が廃止され、custom exec 機構も具体的な実装ターゲットを
持たないまま `steps: []` 空殻 (F2 構造欠陥) を残していたため、T12 で案 A
(agent.json closure step 経由) に回帰。T14 は案 A 採用を維持しつつ、起動 経路が
agent runner (`agents/scripts/run-agent.ts` + `AgentRunner`) 経由
であることを明示化し、orchestrator → agent runner → merger-cli の 3 層
runner-mediated flow を正式採用機構として確定する (00-design-decisions.md § T14
Decision 1)。

### b.3 採用構造の運用イメージ (4 層 runner-mediated flow)

```
orchestrator (workflow-merge.json)
    │
    ├─ phase `merge-ready` を検知、issue.payload から { prNumber, verdictPath } 抽出
    │
    ├─ agents/scripts/run-agent.ts を subprocess で起動
    │   (CLI: --issue <n> --pr <pr> --verdict-path <vp>)
    │       │
    │       ├─ .agent/merger/agent.json を load (validator role)
    │       │
    │       └─ AgentRunner.run() → closure step "merge" 起動
    │               (boundary-hooks.ts 通過、LLM 呼出なし)
    │               │
    │               └─ closure runner が ${context.prNumber} / ${context.verdictPath} を substitute
    │                   │
    │                   └─ Deno.Command("deno", ["run", "--allow-read", "--allow-run",
    │                        "--allow-net", "agents/scripts/merge-pr.ts",
    │                        "--pr", N, "--verdict", "tmp/climpt/orchestrator/emits/N.json"]) を spawn
    │                       │
    │                       └─ merge-pr.ts (nested subprocess)
    │                             step 1: verdict file check → verdict-missing? → rejected
    │                             step 2: JSON Schema validate → schema-mismatch?
    │                             step 3: args.pr === verdict.pr_number → pr-number-mismatch?
    │                             step 4: gh pr view で prData 取得
    │                             step 5: canMerge() で gate 評価 (純関数)
    │                             step 6: dry-run 分岐
    │                             step 7: gh pr merge 実行 + label 付替
    └─ outputPhases mapping で phase 遷移
```

**補足**:

- **Nested subprocess escape**: `merge-pr.ts` は `AgentRunner` から見て 2
  段下の独立 Deno プロセスとして spawn される。そのため `merge-pr.ts` 内部の
  `gh pr merge` 呼出に対し `BOUNDARY_BASH_PATTERNS` は発動しない — SDK の Bash
  tool-invocation 経路を通らないため、tool-policy による
  正規表現マッチは構造的に適用されない。これは F10 (`finalizeWorktreeBranch()`
  が `run-agent.ts` parent プロセスから `gh pr create` を呼ぶ際に
  BOUNDARY_BASH_PATTERNS の対象外となる) と同原理 (00-design-decisions.md § T14
  Decision 3 採用)。
- **LLM 非介在の構造的保証**: `merge-pr.ts` は独立 Deno プロセスかつ LLM SDK を
  import しない (05 section 2.1 禁則事項)。`canMerge()` を bypass
  する経路も持たない。よって BOUNDARY_BASH_PATTERNS の本来目的 (LLM
  による任意コマンド実行の制限) は merge-pr.ts のコード境界で既に 満たされる。

agent.json closure step 定義と `.agent/workflow-merge.json` の配線 詳細、および
Phase 0 prerequisites (issue.payload → agent.parameters
binding、closure.runner.args template substitution) の実装は
`05-implementation-plan.md` で扱う。

## c. 試験運用手順

### c.1 並走セットアップ

```bash
# ターミナル A: 既存 impl / review サイクル (不変)
deno task orchestrator --workflow .agent/workflow.json --label ready

# ターミナル B: merge サイクル (新設, F1 による並走)
deno task orchestrator --workflow .agent/workflow-merge.json --label merge:ready
```

F1 (別名 workflow で並走安全) と F3 (issueStore per-workflow lock) に より 2
プロセスは互いに干渉しない。ラベル名前空間も F2 で分離済み。

### c.2 手動 dry-run (merger-cli 単体, ローカル検証用)

**前提**: 以下の `deno task merge-pr` 直接起動は agent runner を経由しない
開発者用ショートカット (dry-run / debug 目的のローカル検証専用) である。
本番経路は c.1 の orchestrator 経由 (workflow-merge.json → run-agent.ts →
AgentRunner → closure step → merge-pr.ts) を使うこと。runner-mediated flow
と同等の経路で end-to-end テストする場合は、次のように起動する:

```bash
# c.1 と同じ、orchestrator 経由で本番経路を走らせる
deno task orchestrator --workflow .agent/workflow-merge.json --label merge:ready

# または手動で単発 agent を起動 (run-agent.ts → AgentRunner → closure step)
deno task agent --agent merger --issue <n> --pr <pr> --verdict-path tmp/climpt/orchestrator/emits/<pr>.json
```

ローカル検証のみを目的に merger-cli のロジック (canMerge gate / verdict
validation / JSON emission) を即席で確認したい場合は、以下の直接起動を 使う:

```bash
# verdict.json を事前に配置
mkdir -p tmp/climpt/orchestrator/emits
cat > tmp/climpt/orchestrator/emits/123.json <<'EOF'
{
  "schema_version": "1.0.0",
  "pr_number": 123,
  "base_branch": "develop",
  "verdict": "approved",
  "merge_method": "squash",
  "delete_branch": true,
  "reviewer_summary": "Manual dry-run sample. All acceptance criteria satisfied on head ref. CHANGELOG updated.",
  "evaluated_at": "2026-04-12T00:00:00Z",
  "reviewer_agent_version": "1.13.26",
  "ci_required": true
}
EOF

# dry-run (判定のみ, gh pr merge は実行しない)
# 本コマンドは agent runner を経由しないローカル検証用ショートカット
deno task merge-pr --pr 123 --verdict tmp/climpt/orchestrator/emits/123.json --dry-run
```

> **注**: 本番経路は c.1 の orchestrator 経由 (agent runner を通す)、
> ローカル検証のみ c.2 の直接起動を使う。`deno task merge-pr` 直接起動
> を本番運用で使うことは想定しない。

期待出力例 (JSON):

```json
{
  "ok": true,
  "decision": { "kind": "ci-pending" },
  "executed": false,
  "labels": { "added": [], "removed": [] },
  "pr_state": {
    "mergeable": "MERGEABLE",
    "reviewDecision": "APPROVED",
    "statusCheckRollup_summary": "1 PENDING / 4 SUCCESS"
  }
}
```

### c.3 本番実行

本番経路は c.1 の orchestrator 起動を使う:

```bash
deno task orchestrator --workflow .agent/workflow-merge.json --label merge:ready
```

orchestrator が `merge-ready` phase issue を pick
すると、`agents/scripts/run-agent.ts` を subprocess として起動し、`AgentRunner`
が `.agent/merger/agent.json` の closure step runner 経由で
`agents/scripts/merge-pr.ts` を spawn する (b.3 の 4
層構造)。`decision.kind === "merged"` のときのみ `gh pr merge` が
実行され、それ以外のラベル付替は decision に応じて実行される。

ローカル検証で同じ経路を単発で走らせる場合:

```bash
deno task agent --agent merger --issue <n> --pr <pr> --verdict-path tmp/climpt/orchestrator/emits/<pr>.json
```

### c.4 deno.json タスク追加 (参考)

```jsonc
{
  "tasks": {
    // ... 既存タスク ...
    // 本番経路: orchestrator 経由で run-agent.ts を起動
    //   deno task orchestrator --workflow .agent/workflow-merge.json --label merge:ready
    // 単発 agent 起動 (run-agent.ts → AgentRunner → closure step)
    //   deno task agent --agent merger --issue <n> --pr <pr> --verdict-path <vp>
    // 下記 `merge-pr` は dry-run / debug 用のローカル検証ショートカット (agent runner 非経由)
    "merge-pr": "deno run --allow-read --allow-run --allow-net agents/scripts/merge-pr.ts"
  }
}
```

本番経路は `deno task agent --agent merger --issue <n>` (内部で `run-agent.ts`
を経由) を使う。`deno task merge-pr` は c.2 で述べた通り
ローカル検証用のショートカットであり、agent runner を経由しないため本番
運用には使わない。

## d. CI integration

CI integration は本設計では扱わない。orchestrator (workflow-merge.json)
は開発者が
`deno task orchestrator --workflow .agent/workflow-merge.json
--label merge:ready`
で明示起動する運用を前提とする (section c.1 参照)。 cron
による自動スケジュールは T10 Decision 1 で廃止した (state machine の per-PR lock
/ maxCycles と構造的に両立しないため)。ローカル検証では `merge-pr_test.ts`
ユニットテストのみ実行する (実 gh 呼出は含まない)。

## Canonical Names 再掲

- merger-cli: `agents/scripts/merge-pr.ts`
- verdict-store: `tmp/climpt/orchestrator/emits/<pr-number>.json`
- issueStore.path: `.agent/climpt/tmp/issues-merge` (directory)
- Phase: `merge-ready` / `merge-blocked` / `merged`
- Label (with prefix): `merge:ready` / `merge:blocked` / `merge:done`
- agent runner: `agents/scripts/run-agent.ts` (参照のみ、本設計は Phase 0
  拡張として新機能追加)
