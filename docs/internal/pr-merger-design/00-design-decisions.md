# 00 Design Decisions — PR Merger

> 本ドキュメントは PR Merger 設計の意思決定履歴 (Amendment chain)
> を時系列に統合したものである。各 Amendment は後続の Amendment により部分的に
> supersede されることがあるため、**最新の T14
> を最優先**とし、それに矛盾しない範囲で T12/T10/T8 を参照する。

## Reading order

1. `README.md` — INDEX と読み順
2. 本ドキュメント (00) — 意思決定の系譜
3. `01-overview.md` 以降 — 個別設計

## Amendment chain

T8 → T10 → T12 → T14 (最新)

## Initial design goals

PR マージ機能の設計仕上げ。AI 判断と機械実行を分離する。

- AI: PR 内容を読んで評価 (reviewer agent)
- 機械: verdict + 前提ゲートに基づき `gh pr merge` を実行 (LLM 不介在)
- 既存の workflow.json 並走モデル + reviewer/iterator への非干渉
- 成果物: 設計ドキュメント一式 (概要/アーキ/データフロー/実装計画/Mermaid)

### Goal

`docs/internal/pr-merger-design/` に PR
マージ機能の設計ドキュメント一式を配置し、実装チームが着手可能な状態にする。設計は既存の
climpt orchestration アーキと整合し、LLM を merge
パスから排除する決定論的プロセスを定義する。

### Established Facts (F1-F10)

既に確認済みの事実 — 本設計の前提。

| #   | 事実                                                                                  | 出典                                                                             |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| F1  | `workflow.json` は `--workflow` で別名指定可能、並走安全                              | `agents/orchestrator/workflow-loader.ts:54-58`, `cli-smoke_test.ts:5`            |
| F2  | `labelPrefix` でラベル名前空間を分離可能                                              | `workflow-loader.ts:85`, `workflow.yaml:37-53`                                   |
| F3  | `issueStore.path` 分離はシングルissueモードでも動作、per-workflow lock                | `issue-store.ts:237`                                                             |
| F4  | Validator agent の outcome → phase → label 自動付与                                   | `phase-transition.ts:69-73`, `orchestrator.ts:362-391`                           |
| F5  | `BOUNDARY_BASH_PATTERNS` は closure step でも global block、per-agent override なし   | `agents/common/tool-policy.ts:51-84, 145-148`                                    |
| F6  | Boundary Hook は agent/runner 側 (closure step 内) で `Deno.Command("gh",...)` を実行 | `runner/boundary-hooks.ts`, `verdict/external-state-adapter.ts:321-329, 368-372` |
| F7  | `githubPrMerge` は BOUNDARY_TOOLS に宣言のみ、ハンドラ未実装                          | `tool-policy.ts:28`                                                              |
| F8  | `gh pr view/diff/checks` は read-only で BOUNDARY_BASH_PATTERNS に非該当              | `tool-policy.ts:51-84`                                                           |
| F9  | `github_read` MCP が runner に動的注入済み (in-process)                               | `query-executor.ts:302-320`                                                      |
| F10 | `finalizeWorktreeBranch()` が `gh pr create` を parent プロセスで実行する既存パターン | `agents/common/worktree.ts:475-488`                                              |

### Design Principles

1. **責務分離**: AI (reviewer) は評価のみ、機械 (merger) は実行のみ
2. **LLM を merge path から排除**: `gh pr merge` の前段に LLM 呼び出しを入れない
3. **既存に非干渉**: iterator/reviewer の BOUNDARY_BASH_PATTERNS や boundary
   hook は触らない
4. **並走モデル活用**: merger は独立 workflow/CLI、orchestrator の既存 run
   と並走
5. **前提ゲートは純関数**: mergeable / reviewDecision / statusCheckRollup
   のブール合成

---

## § T8 — Outcome canonical names (2026-04-13)

### 背景

初期レビューで 5 つの矛盾が指摘された:

1. 06 dry-run sample (`pr`, `type`, `"1.0"`) が 03 JSON Schema (`pr_number`,
   `verdict`, `"1.0.0"`) 非準拠
2. 05 `canMerge` 擬似コードが 03 ゲート仕様と乖離 (schema_version 未検査,
   ci_required 無視, ci-failed 誤扱い, base_branch 比較不在)
3. 04 outcome 表に `rejected` 行なし + CI 失敗を `conflicts` に誤帰属
4. 01 canonical (4 値) と 03 canonical (5 値, `rejected` 追加) が直接矛盾
5. 03 内部矛盾: 表は ci-failed を ci-pending に集約、メモは集約しないと記述

根本原因: 並列委譲時に canonical outcome セットを固定しなかった。

### Canonical 確定 (本 Amendment を唯一の source of truth とする)

#### Canonical Outcomes (5 値)

```
merged / ci-pending / approvals-missing / conflicts / rejected
```

| Outcome             | 付与ラベル         | Phase 遷移                | Retry | 意味                                                 |
| ------------------- | ------------------ | ------------------------- | :---: | ---------------------------------------------------- |
| `merged`            | `merge:done`       | `merged` (terminal)       |   -   | `gh pr merge` 成功                                   |
| `ci-pending`        | `merge:ready` 維持 | `merge-ready` (self-loop) |   ○   | GitHub 計算待ち                                      |
| `approvals-missing` | `merge:blocked`    | `merge-blocked`           |   ×   | reviewDecision 未承認                                |
| `conflicts`         | `merge:blocked`    | `merge-blocked`           |   ×   | mergeable=CONFLICTING のみ                           |
| `rejected`          | `merge:blocked`    | `merge-blocked`           |   ×   | reviewer 拒否 / schema drift / base 不一致 / CI 失敗 |

#### canMerge Reason → Canonical Outcome (決定表)

| canMerge Reason        | Canonical Outcome   | 根拠                                              |
| ---------------------- | ------------------- | ------------------------------------------------- |
| (Ok)                   | `merged`            | 前提ゲート全通過                                  |
| `schema-mismatch`      | `rejected`          | verdict 契約破綻、人手必須                        |
| `rejected-by-reviewer` | `rejected`          | reviewer 明示拒否                                 |
| `unknown-mergeable`    | `ci-pending`        | GitHub 非同期計算、retry 可                       |
| `conflicts`            | `conflicts`         | rebase 必要、retry 不可                           |
| `approvals-missing`    | `approvals-missing` | 人手承認必要                                      |
| `ci-pending`           | `ci-pending`        | CI 完了待ち                                       |
| `ci-failed`            | `rejected`          | **CI 失敗は人手介入必須 (決定論的に retry 不可)** |
| `base-branch-mismatch` | `rejected`          | verdict 再生成必須                                |

### 決定根拠

1. **`rejected` を canonical 化**: reviewer 明示拒否を表現できない 4
   値案は不採用。schema-mismatch / base-branch-mismatch / ci-failed /
   reviewer-rejected を全て「人手介入必須」クラスとして 1 outcome に束ねる
   (運用複雑度を抑える)
2. **`ci-failed` → `rejected`**: CI 失敗の自動 retry は無限ループリスク (root
   cause が解消されない限り failure 継続) + CI green 化判断は LLM
   含むため決定論パスから除外
3. **`unknown-mergeable` → `ci-pending`**: GitHub の mergeable
   計算は数秒〜分で確定するため retry は決定論的に終息する
4. **03 JSON Schema (`$id: verdict-1.0.0`) を唯一の source of truth** とする

### Done Criteria (完了時点の記録)

- [x] 01-06 に canonical 決定を反映
- [x] 各ファイルに「Canonical source: § T8」の注記を付与
- [x] 整合性検証: `merged`, `ci-pending`, `approvals-missing`, `conflicts`,
      `rejected` の 5 トークンが 01-06 に一貫して出現し、`verdict-rejected`
      (旧名) が残っていないこと

### Approach (履歴)

Phase 1 (逐次): 03 の内部矛盾解消を先行。Phase 2 (並列 4): 01/02, 04, 05, 06
を同時修正。Phase 3: 5 トークン出現検証 + `verdict-rejected` 残存なしを確認。

---

## § T10 — Scheduler unification (2026-04-13)

### 背景

2nd レビューで 4 件の矛盾指摘 (F1 High / F2-F3 Medium / F4 Low):

1. **F1**: merge-watcher が workflow state machine を無視 — 04 の per-PR
   lock/maxCycles と 05 の全件列挙 one-shot CLI が両立しない
2. **F2**: mergePr() に `args.pr === verdict.pr_number` 照合欠落 (04 契約違反)
3. **F3**: 01 の canonical 表が「JSON verdict フィールドに 5 値入る」と誤読可能
   (03 Schema は 2 値制限)
4. **F4**: issueStore.path の表記不一致 (01/04: `.agent/issues-merge.json` / 06:
   `.agent/climpt/tmp/issues-merge`)

根本原因: T8 で outcome 命名は統一したが、**Scheduler 責務 (PR を merge-pr.ts
に流すトリガー)** を確定しなかった。cron と orchestrator の 2
候補が並立したまま文書化されており、どちらの前提で書かれたかがファイルごとに揺れた。

### T10 Decision 1: Scheduler を orchestrator に単一化

**採択: orchestrator (workflow-merge.json) が単一 PR を merge-pr.ts
に受渡す**。cron は廃止。

理由:

- 04 の state machine (F3 per-workflow lock / maxCycles / cycleDelayMs)
  が設計の中核。cron を残すと state machine が飾りになる
- F1 Codex 指摘 (High) が構造的に消滅
- F2 pr_number 照合が自然に成立 (orchestrator が `--pr <n>` を渡す)
- orchestrator プロセス停止中は merge 保留だが、verdict+label
  が残るので復旧後自動再開

### T10 Decision 2: merge-watcher.ts を merge-pr.ts に統合

cron 廃止後、merge-watcher の責務は「verdict 存在確認 → merge-pr.ts 呼出」のみで
~5 行に縮む。これを merge-pr.ts step 0
(`verdict 不在 → outcome=rejected, reason=verdict-missing`) に吸収。

効果:

- ファイル 1 つ減 (`agents/scripts/merge-watcher.ts` 削除)
- orchestrator → merge-pr.ts の 1 段呼出に簡素化
- `CanMergeReason` に `verdict-missing` を追加 (→ `rejected` に写像)

### T10 Decision 3: issueStore.path を directory 形式に確定

調査結果 (`agents/orchestrator/issue-store.ts:8-13, 59, 122` +
`examples/fixtures/workflow/workflow.json:41`):

- `IssueStore` は storePath を **ディレクトリ**として扱う (`Deno.mkdir` /
  `Deno.readDir`)
- 既存 production workflow は `.agent/climpt/tmp/issues` を使用
- デフォルト定数 `DEFAULT_ISSUE_STORE.path = ".agent/climpt/tmp/issues"`
  (workflow-types.ts:136-138)

**Canonical 確定**: `.agent/climpt/tmp/issues-merge` (directory)。01/04 の
`.agent/issues-merge.json` 誤記を修正。

### T10 Decision 4: CanMergeReason 拡張 (10 値)

```
rejected-by-reviewer / unknown-mergeable / conflicts / approvals-missing /
ci-pending / ci-failed / base-branch-mismatch / schema-mismatch /
verdict-missing / pr-number-mismatch
```

追加 2 値の Canonical Outcome 写像:

| Reason               | Canonical Outcome | 根拠                                                                          |
| -------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `verdict-missing`    | `rejected`        | verdict 未 emit のまま merge:ready ラベルが付いた状態 — 人手介入必須          |
| `pr-number-mismatch` | `rejected`        | `args.pr !== verdict.pr_number` — 誤った verdict ファイルの参照、運用事故防止 |

`canMerge()` の step 順序に以下を先頭追加:

- step -1: verdict 不在 → `verdict-missing` → `rejected`
- step -0.5: `args.pr !== verdict.pr_number` → `pr-number-mismatch` → `rejected`
- (既存 step 0-5 はそのまま)

### T10 Decision 5: 01 canonical 表の記述是正

01 旧版の記述:

> | Verdict outcome | merged / ci-pending / ... / rejected | **verdict JSON の
> verdict フィールド + merger-cli の canonical outcome** |

誤解誘導: 使用箇所列が「verdict JSON の verdict フィールド」を含んでおり、5 値が
JSON に直接入ると読める。

修正後:

> | Verdict outcome (canonical) | merged / ci-pending / approvals-missing /
> conflicts / rejected | **merger-cli の canonical outcome** (verdict JSON の
> `verdict` フィールドは `approved` / `rejected` の 2 値のみ — 03 JSON Schema
> 参照) |

### Done Criteria (完了時点の記録)

- [x] 05: `merge-watcher.ts` 節削除、`merge-pr.ts` に verdict-missing /
      pr-number-mismatch 処理追加 (CanMergeReason 10 値化、step -1/-0.5 追加)
- [x] 06: cron YAML 削除、`issueStore.path` を `.agent/climpt/tmp/issues-merge`
      に統一、b.3 運用イメージ図を orchestrator → merge-pr.ts 直結に修正
- [x] 01/02/04: `.agent/issues-merge.json` 誤記修正、sequence diagram から MW
      (merge-watcher) アクタ削除、canonical 表記述修正
- [x] 03: pr_number 照合要件を明文化 (canMerge step 仕様に pr-number-mismatch
      追加)
- [x] 整合性検証: `merge-watcher` が実在ファイル参照として残っていない /
      `.agent/issues-merge.json` が 0 件 / `verdict-missing`
      `pr-number-mismatch` が 03/05 に出現

---

## § T12 — canMerge / mergePr split (2026-04-13)

### 背景

3rd レビューで 2 件の矛盾指摘 (F1 Medium レイヤ違反 / F2 High 構造欠陥):

1. **F1 (03 layer violation)**: 03 の `canMerge(prData, verdict)`
   は純関数と宣言されているが、疑似コードでは `cli_args` 引数を仮定し、verdict
   ファイル存在チェック (step -1) と `args.pr === verdict.pr_number` 照合 (step
   -0.5) を実行している。pure function の署名には `cli_args` が存在せず、verdict
   は既に parse
   済みオブジェクトとして渡されるため、「ファイル不在」を内部で検出することは論理的に不可能。05
   は正しく wrapper (`mergePr`) 側に step -1/-0.5 を配置済み → **03 のみが layer
   violation**。
2. **F2 (06/05 structural gap)**: T10 で merge-watcher.ts を廃止し 06 b.2 で
   `agent.json = { steps: [] }` の空殻にしたが、06 は「actionable phase handler
   (custom exec) が直接 merge-pr.ts を spawn」と書きつつ、05 にはその custom
   exec の実体が一切記述されていない。結果: `merge-ready` phase が pick
   されても何も起きない構造欠陥。

根本原因:

- F1: T10 で wrapper 側の責務 (step -1/-0.5) を pure function
  の疑似コードに混入させた
- F2: T10 Decision 2 で merge-watcher を廃止した際、代替トリガ機構として T5-T6
  で棄却した 案 A (agent.json closure step 経由) に立ち戻らなかった。Design
  Principle #2 (LLM 排除) の棄却理由は watcher 消失後は失効している (closure
  step runner は LLM 非介在、F10 と同じ `Deno.Command` 起動パターン)

### T12 Decision 1: canMerge 純関数 / mergePr wrapper の責務分離を 03 でも明示

03 の疑似コードを 2 ブロックに再構成する:

#### ブロック A: `mergePr(args: MergePrArgs)` CLI wrapper (新規で疑似コード化)

- 役割: CLI 入出力境界 + ファイル I/O + GitHub API 呼出 + ラベル付替を担当
- step 構成:
  - step 1 (wrapper): verdict ファイル存在確認 → 不在なら `verdict-missing` →
    outcome=rejected (早期 return、canMerge 非呼出)
  - step 2 (wrapper): verdict.json parse + JSON Schema validate → schema
    違反なら `schema-mismatch` → outcome=rejected
  - step 3 (wrapper): `args.pr === verdict.pr_number` 照合 → NO なら
    `pr-number-mismatch` → outcome=rejected (GitHub API 呼出前)
  - step 4 (wrapper): `gh pr view` で prData 取得
  - step 5 (wrapper): `canMerge(prData, verdict)` 呼出 (純関数)
  - step 6 (wrapper): dry-run 分岐
  - step 7 (wrapper): `gh pr merge` 実行 + ラベル付替

#### ブロック B: `canMerge(prData: PrData, verdict: Verdict): Result<void, CanMergeReason>` 純関数

- 役割: 前提ゲートの決定論的評価のみ。I/O なし、引数のみで判定完結
- 署名: **引数は prData と verdict の 2 つのみ** (`cli_args` を含めない)
- step 構成 (step 0-5): schema_version (major=1) → reviewer 承認 → mergeable →
  approvals → CI → base_branch
- 扱わない Reason: `verdict-missing` / `pr-number-mismatch` (wrapper 担当)
- 扱う Reason (8 値): `schema-mismatch` / `rejected-by-reviewer` /
  `unknown-mergeable` / `conflicts` / `approvals-missing` / `ci-pending` /
  `ci-failed` / `base-branch-mismatch`

#### 整合性規約

- `CanMergeReason` union は 10 値のまま維持 (wrapper が返す 2 値 + canMerge
  が返す 8 値)
- Reason ↔ Outcome 写像表 (11 行) は維持
- sequence diagram は維持
- gate 評価順序の記述: wrapper step 1-3 → canMerge step 0-5 の 2
  層構造として明示
- 03 の canMerge 疑似コードから `cli_args` 引数を削除、step -1 / step -0.5 を
  mergePr wrapper ブロックに移動

### T12 Decision 2: 案 A (agent.json closure step) への回帰

T5-T6 で棄却した 案 A に回帰し、orchestrator → `.agent/merger/agent.json` の
closure step → `deno run agents/scripts/merge-pr.ts` の 1
段で起動する構造に確定する。

#### 回帰の理由

1. **棄却理由の失効**: 案 B 採択 (06 旧版) の根拠は「merge-watcher.ts が agent
   framework を迂回し、LLM 排除を構造的に保証」だった。T10 で watcher
   が消えた今、**案 B 残存形** ("actionable phase handler が custom exec で直接
   spawn") には具体的な実装ターゲットが存在せず、F2 構造欠陥を生んでいる。
2. **既存機構の活用**: orchestrator の validator agent 起動パスは既に closure
   step runner で `Deno.Command` を呼ぶ構造 (F6)。agent.json に closure step
   定義を置けば、追加の custom exec 機構を設計・実装せずに起動できる。
3. **LLM 非介在の維持**: closure step は prompt/LLM 呼出を伴わない (runner が
   subprocess を spawn するのみ)。案 A 回帰しても Design Principle #2 (LLM を
   merge path から排除) は崩れない。`merge-pr.ts` 自身が LLM import
   を一切持たない (05 section 2.1 禁則事項で担保) 限り、LLM 経由で `gh pr merge`
   に到達する経路は構造上存在しない。
4. **F5 整合**: `merge-pr.ts` は独立 Deno プロセスとして実行されるため
   `BOUNDARY_BASH_PATTERNS` (F5, agent runner 内限定) の外で `gh pr merge`
   を呼べる。F10 (`finalizeWorktreeBranch()` の `gh pr create` を parent
   プロセスで実行するパターン) と同じ構造。

#### 案 A 確定形 (T12 時点、T14 で更新)

T12 時点の agent.json (permissions は T14 で見直し):

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
          "--allow-write",
          "--allow-run",
          "--allow-env",
          "agents/scripts/merge-pr.ts",
          "--pr",
          "${pr}",
          "--verdict",
          "${verdictPath}"
        ]
      }
    }
  ]
}
```

**T14 で permissions と template 構文を更新** — 最終形は § T14 Decision 5
を参照。

#### orchestrator からの起動経路 (T12 時点)

1. orchestrator が `merge-ready` phase の issue を pick (per-workflow lock)
2. issue から `pr` (整数) と `verdictPath` (`.agent/verdicts/<pr>.json`)
   を抽出し、`AgentDefinition.parameters` に bind
3. validator agent 既存機構で closure step 起動 → closure runner が
   `Deno.Command("deno", ["run", ..., "agents/scripts/merge-pr.ts", "--pr", pr, "--verdict", verdictPath])`
   を subprocess として spawn
4. `merge-pr.ts` が stdout に JSON を書き、exit code で outcome 判定
5. `outputPhases` マッピングで phase 遷移

T14 で上記経路は「orchestrator → run-agent.ts → AgentRunner → closure step →
merge-pr.ts」の 4 層 runner-mediated flow として再定義される。

#### issue の pr / verdictPath 受渡

`workflow-merge.json` の issueStore (F3, per-workflow lock) が保持する issue
payload に `pr` + `verdictPath` を含める。reviewer agent が `merge:ready` phase
遷移を起こす際に issueStore に書き込む (05 section 3.2 の拡張点)。

### Done Criteria (完了時点の記録)

- [x] 03: canMerge 疑似コードを 2 ブロック再構成 (mergePr wrapper + canMerge
      pure)、canMerge の署名から `cli_args` を除去、step -1/-0.5 を wrapper
      ブロックに移動
- [x] 03: gate 順序サマリを「wrapper step 1-3 → canMerge step 0-5」の 2
      層構造として明示
- [x] 06: b.1/b.2 案比較セクションを「案 A 採用」に書換、agent.json skeleton を
      closure step 定義に置換、b.3 運用図を orchestrator → agent closure step →
      merge-pr.ts に再描画
- [x] 06: 「actionable phase handler (custom exec)」表現を「validator agent
      closure step」に全置換
- [x] 05: section 2 の canMerge 擬似コードは 03 と整合している状態を維持
- [x] 整合性検証: 03 canMerge 署名に `cli_args` 残存 0 件 / 06 の「custom
      exec」表現 0 件 / 06 agent.json の `steps: []` 空殻 0 件 / `closure step`
      が 05/06 に出現

---

## § T14 — Runner-mediated flow (最新, 2026-04-13)

### 背景

User feedback: T12 で案 A (agent.json closure step)
回帰は正しいが、設計記述が「orchestrator が直接 merge-pr.ts を
spawn」寄りで、climpt 本来の runner 経路 (`agents/scripts/run-agent.ts` +
`AgentRunner` + `boundary-hooks.ts`) を迂回しているように読める。実際には
orchestrator → **agent runner** → merger-cli の 3
層フローで回すべきで、以下を明示する必要がある:

1. `.agent/workflow-merge.json` の merger phase は `directory: "merger"`
   で正規の agent 定義を参照する (custom exec なし)
2. `.agent/merger/agent.json` を validator agent として実装 (closure step が
   `deno run ... merge-pr.ts --pr ${context.prNumber} --verdict ...`)
3. 05 で runner が prNumber / verdictPath を closure に渡す経路 (issue.payload →
   agent parameters → template substitution) を明文化
4. 02/03/04/06 の図を `orchestrator → agent runner → merger-cli` に揃える
5. closure 経由で最終的に `gh pr merge` が実行されるため、BOUNDARY_BASH_PATTERNS
   (F5) 遵守方針を明記

### 調査結果サマリ (T14 Explore)

- **F10 parent-process 免除**: `finalizeWorktreeBranch()` は
  `run-agent.ts:680-684` から呼ばれる (parent orchestrator プロセス、SDK
  外)。よって `gh pr create` は BOUNDARY_BASH_PATTERNS の enforcement 対象外
- **BOUNDARY_BASH_PATTERNS の発動条件**: SDK agent が `Bash` tool
  を直接呼出した時点の `canUseTool` で正規表現マッチ
  (`query-executor.ts:148-198`)。**nested subprocess から呼ばれる `gh` は
  enforcement 対象外** (subprocess は SDK tool-invocation 経路を通らない)
- **F7 githubPrMerge boundary hook**: `BOUNDARY_TOOLS` に declare のみ、handler
  未実装 (`tool-policy.ts:28`)。実装には SDK-level tool handler か
  `verdictHandler.onBoundaryHook()` (`boundary-hooks.ts:75`) 追加が必要
- **既存 closure step の subprocess runner パターン**: 存在しない。現行 closure
  step は全て prompt-only。closure.runner.args の template substitution
  (`${context.prNumber}` 等) も未実装。本設計の closure subprocess 起動は
  **新規機能**
- **issue.payload → agent.parameters 経路**: 未実装。現行 `dispatcher.ts` は
  `issueNumber` のみ渡し、payload object の unpack 機構なし

### T14 Decision 1: Runner-mediated flow を正式採用

次の 3 層で起動する:

```
1. workflow-merge orchestrator (別プロセス、agents/orchestrator)
   └─ merge-ready phase issue を pick (per-workflow lock)
      └─ issue.payload から { prNumber, verdictPath } を抽出
         └─ agent 起動を dispatch → run-agent.ts subprocess
            (CLI: --issue <n> --pr <pr> --verdict-path <vp>)
2. agents/scripts/run-agent.ts (新規 subprocess、parent プロセス相当)
   └─ .agent/merger/agent.json (validator role) を読込
      └─ AgentRunner.run() を起動
         └─ boundary-hooks.ts を通過 (closure step の onBoundaryHook 発火準備)
3. AgentRunner closure step runner
   └─ closure.runner.args の ${pr} / ${verdictPath} を substitute
      └─ Deno.Command("deno", ["run", "--allow-read", "--allow-run", "--allow-net",
                      "agents/scripts/merge-pr.ts", "--pr", N, "--verdict", path]) を spawn
         └─ merge-pr.ts (3 層目の subprocess) が内部で gh pr merge 実行
```

第 3 層の `merge-pr.ts` から呼ばれる `gh pr merge` は nested subprocess (SDK の
Bash tool 経路外) のため、BOUNDARY_BASH_PATTERNS は構造的に発動しない。これは
F10 `finalizeWorktreeBranch` の parent-process 免除と同等の原理で成立する。

### T14 Decision 2: Phase 0 prerequisites の明示

runner-mediated flow を実装するため、本設計の実装前に climpt runtime
に以下を追加する:

#### Phase 0-a: issue.payload → agent.parameters binding

- `workflow-merge.json` が扱う issue には
  `payload: { prNumber: number, verdictPath: string }` が含まれる前提
- reviewer agent が `merge:ready` 遷移を起こす際 (T8 extension point、05 section
  3.2) に issueStore に payload を書き込む
- orchestrator dispatcher は issue.payload を展開し、run-agent.ts への CLI
  引数に変換する (例:
  `--pr ${payload.prNumber} --verdict-path ${payload.verdictPath}`)
- run-agent.ts の CLI→parameters 既存機構 (run-agent.ts:517-529) が
  `definition.parameters.pr` / `definition.parameters.verdictPath` にマッピング

#### Phase 0-b: closure.runner.args template substitution

- AgentRunner が closure step を起動する際、`runner.args` 中の `${pr}` /
  `${verdictPath}` / `${context.prNumber}` 等を agent parameters 値から
  substitute
- substitution 対象フィールド: `definition.parameters` のキー名
- 実装箇所候補: `AgentRunner.run()` 内の closure step dispatch 周辺
- 不在キーへの参照は実装時 error (テンプレート解決失敗 = 設計バグ)

#### Phase 0-c: closure step subprocess runner 定義

- 既存 closure step は prompt-only だが、`type: "subprocess"` 相当の新 kind
  を追加、または既存 closure 内に `runner.command` が存在する場合に subprocess
  spawn するよう拡張
- 追加 subprocess kind のスキーマ定義 + runner 実装 (`agents/runner/` 配下)

**これらは本 PR Merger 設計の prerequisite であり、別 PR または同 PR の Phase 0
として先行実装する**。05 section 5 のロールアウト表に Phase 0 行を追加する。

### T14 Decision 3: BOUNDARY_BASH_PATTERNS 遵守策 — Nested subprocess escape (採用)

#### 検討した 3 案

| 案                               | 仕組み                                                                                                                                               | 既存機構                        | 複雑度 | 採否              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------ | ----------------- |
| (a) Nested subprocess escape     | closure が `deno run merge-pr.ts` を spawn、merge-pr.ts が `gh pr merge` を subprocess として実行。SDK tool-policy は nested subprocess に発動しない | 活用                            | 低     | ○採用             |
| (b) F10 parent-process exemption | closure は dry-run のみ、run-agent.ts 側 post-agent hook が `gh pr merge` を実行                                                                     | `finalizeWorktreeBranch` と同型 | 中     | × 棄却 (下記理由) |
| (c) F7 boundary hook 実装        | closure step が structured output で「merge 要求」を出し、`verdictHandler.onBoundaryHook()` が実行                                                   | SDK-level handler 追加が必要    | 高     | × 棄却            |

#### 採用理由 (案 a)

- **構造的整合**: T14 Decision 1 の 3 層 subprocess
  構造から自然に導かれる。merge-pr.ts は **独立 Deno プロセス**として spawn
  されるため、SDK の Bash tool-policy は merge-pr.ts 内部の `Deno.Command`
  呼出に発動しない (Explore Q5 確認済)
- **F10 との類似性**: F10 `finalizeWorktreeBranch` が `run-agent.ts:680-684`
  (parent-process) から `gh pr create` を呼ぶのと同様、本設計の `gh pr merge` は
  `run-agent.ts` より深い subprocess tree だが、同じく SDK tool-policy
  の外側で実行される
- **merge-pr.ts の信頼境界**: merge-pr.ts は LLM 非介在の決定論的 Deno script
  (05 section 2.1 禁則事項で担保)。LLM 生成 bash 文字列を `gh pr merge`
  に流し込む経路は構造上存在しない。BOUNDARY_BASH_PATTERNS の本来目的 (LLM
  による任意コマンド実行の制限) は merge-pr.ts のコード境界で既に満たされる

#### 棄却した案の理由

- **案 (b) 棄却**: closure step を評価専用 (`--dry-run`) にして parent-process
  post-hook で merge 実行する設計は、agent runner の責務を「評価のみ」にして
  `run-agent.ts` に merge 実行ロジックが漏れる。run-agent.ts はすべての agent
  共通で使う汎用 entrypoint であり、PR merger 専用の post-hook
  を追加すると汎用性が落ちる。`finalizeWorktreeBranch` は全 agent 共通の
  worktree cleanup であり、PR merger-specific な merge 実行とは性質が異なる
- **案 (c) 棄却**: SDK-level tool handler 実装は climpt から SDK
  側への変更注入が必要で、ABI 安定性を損なう。`verdictHandler.onBoundaryHook` は
  boundary event の hook であり、実際の merge 実行を handler
  内に置くのは責務混同 (event notifier vs. executor の混線)

#### Risk (案 a の副作用)

1. **Boundary policy の意図崩壊 risk**: 本来「LLM が `gh pr merge`
   を実行できない」を保証するための BOUNDARY_BASH_PATTERNS が、nested subprocess
   escape を汎用的に許容してしまうと policy の意図が崩れる
   - **緩和**: merge-pr.ts の禁則事項 (05 section 2.1) を「LLM import 禁止 +
     外部 process 実行は `Deno.Command` のみ + `canMerge` を必ず通す bypass
     経路なし」として固定。実装レビュー時に禁則違反を reject する運用を確立
   - **緩和**: 本設計の nested subprocess escape は **merge-pr.ts
     に限定**とし、他 agent
     で同パターンを横展開する際は別途設計レビューを要する旨を 05 Risk Section
     に明記

2. **脱出経路の監査性 low risk**: `gh pr merge` が boundary
   経由でないため、agent runner 内の実行ログに乗らない
   - **緩和**: merge-pr.ts は stdout に JSON (outcome / pr_number /
     executed_command) を emit する責務を持ち、run-agent.ts はその JSON を
     boundary hook 相当の event として re-emit する (実装時に
     verdictHandler.onBoundaryHook 様のイベント再発火を追加、Phase 0-d
     として扱う)

3. **Template substitution 失敗 risk**: `${context.prNumber}` 未解決のまま
   subprocess 起動すると merge-pr.ts が literal 文字列 "${context.prNumber}" を
   argv に受け取り parse 失敗
   - **緩和**: Phase 0-b
     実装時に未解決テンプレートを起動前に検査し、未解決があれば agent 起動を
     abort + log

### T14 Decision 4: Template 構文は `${context.prNumber}` / `${context.verdictPath}`

closure.runner.args 内の template 構文:

- `${context.prNumber}` — issue.payload から抽出した PR 番号 (integer)
- `${context.verdictPath}` — issue.payload から抽出した verdict JSON パス
  (string、`.agent/verdicts/<pr>.json`)

`context.*` namespace は agent runner が issue 起動時に bind する top-level
オブジェクト。`${parameters.xxx}` ではなく `${context.xxx}` とする理由:
agent.json の `parameters` は CLI 受け渡しの契約だが、closure.runner.args
で参照される値は論理的に「実行コンテキスト」(issue + parameters の合成)
のため、意味論的にも `context.` 接頭辞が適切。実装時は
`context = { ...issuePayload, ...agentParameters }` でマージし、衝突時は agent
parameters 優先。

### T14 Decision 5: `.agent/merger/agent.json` 最終形

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

permissions を `--allow-read --allow-run --allow-net` の 3 種に限定 (T12
で付けていた `--allow-write --allow-env` を削除)。`merge-pr.ts` 自身は
`.agent/verdicts/` 以下の read のみでファイル書込を行わないため `--allow-write`
は不要 (stdout output のみ)。`--allow-env`
も実装時に真に必要な変数があれば個別付与。

### Done Criteria (完了時点の記録)

- [x] 06 a (workflow-merge.json): merger phase が `directory: "merger"` で agent
      定義参照
- [x] 06 b.1 (agent.json): T14 Decision 5 の最終形 — `${context.prNumber}` /
      `${context.verdictPath}` 使用、permissions 限定、step id = `merge`
- [x] 06 b.3 diagram: orchestrator → agents/scripts/run-agent.ts → AgentRunner →
      closure step runner → merge-pr.ts の 4 層構造として描画
- [x] 06 c (試験運用): agent runner 経由起動の例を追加
- [x] 05: section 2 と section 5 に「orchestrator → run-agent.ts → AgentRunner →
      closure step → merge-pr.ts」の runner dependency 説明追加、issue.payload →
      agent.parameters 経路と template substitution を明記、Phase 0 prerequisite
      行を ロールアウト表に追加
- [x] 05: 1.2 変更しないファイル表から `agents/scripts/run-agent.ts` と
      `agents/runner/boundary-hooks.ts` を除外 (本設計が依存するため)
- [x] 02: Mermaid コンポーネント図に `AgentRunner` box を orchestrator と
      merger-cli の間に挿入、コンポーネント責務表に agent runner
      行追加、プロセス境界表の起動チェーンを更新
- [x] 03: sequenceDiagram に RUN (agent runner) participant を WFM と MC
      の間に挿入、WFM → RUN → MC の 3 ホップに書き直し
- [x] 04: sequenceDiagram に RUN participant を挿入 (03 と同構造)
- [x] Risk section に BOUNDARY_BASH_PATTERNS nested subprocess escape の risks
      (#1 #2 #3) を記録
- [x] 整合性検証: `${context.prNumber}` が 06 + 05 に出現 / run-agent.ts への
      dependency が 05 に記述 / `AgentRunner` が 02/03/04 diagram に出現
