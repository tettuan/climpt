# 02 Architecture — PR Merger

> **Canonical source**: 00-design-decisions.md § T14 (2026-04-13, supersedes T12
> for runner-mediated flow depiction)。T12 継承: canMerge/mergePr responsibility
> split。T10 継承: outcome/reason/gate 順序。T8 継承: outcome
> 名一覧。Scheduler/Reason/issueStore は T10 + 03-data-flow.md を参照。

## 全体構成図

```mermaid
flowchart LR
    subgraph GH[GitHub]
        PR[Pull Request]
        LBL[Labels: merge:ready/blocked/done]
        API[GitHub API: mergeable/reviewDecision/statusCheckRollup]
    end

    subgraph LLM_PATH["LLM path (非決定論)"]
        direction TB
        RA[reviewer-agent<br/>既存・非変更]
        VS[(verdict-store<br/>.agent/verdicts/ PR .json)]
        RA -->|writes verdict JSON| VS
    end

    subgraph DET_PATH["Deterministic path (LLM 不介在)"]
        direction TB
        WMO[workflow-merge<br/>orchestrator<br/>actionable phase handler]
        RUN[agent runner<br/>agents/scripts/run-agent.ts<br/>+ AgentRunner + boundary-hooks]
        MC[merger-cli<br/>agents/scripts/merge-pr.ts]
        GATE{前提ゲート<br/>純関数ブール合成}
        WMO -->|spawn run-agent.ts<br/>--issue n --pr n --verdict-path path| RUN
        RUN -->|closure step "merge"<br/>Deno.Command で spawn<br/>${context.*} substitute 済| MC
        MC --> GATE
    end

    subgraph IMPL["workflow-impl orchestrator (既存・並走)"]
        direction TB
        ITER[iterator]
        REV[reviewer closure]
        ITER --> REV
        REV -.->|approved| RA
    end

    PR -->|read-only<br/>gh pr view/diff/checks + github_read MCP| RA
    VS -->|read verdict| MC
    MC -->|read| API
    API -->|json fields| GATE
    GATE -->|all true| MERGE[gh pr merge<br/>nested subprocess]
    MERGE --> PR
    MC -->|apply| LBL
    RA -.->|apply merge:ready| LBL
    LBL -.->|phase pick<br/>(orchestrator actionable)| WMO

    classDef llm fill:#fde68a,stroke:#b45309,color:#78350f
    classDef det fill:#bbf7d0,stroke:#15803d,color:#14532d
    classDef existing fill:#e5e7eb,stroke:#4b5563,color:#1f2937
    class RA,VS llm
    class WMO,RUN,MC,GATE,MERGE det
    class ITER,REV,PR,LBL,API existing
```

**読み方**:

- 黄色 (LLM path) の出力は必ず verdict-store を経由して緑 (Deterministic path)
  に渡る。LLM は merge の実行経路に直接介在しない。
- `gh pr merge` は merger-cli subprocess 内で実行される。merger-cli は agent
  runner の孫 subprocess であり、SDK tool-policy (BOUNDARY_BASH_PATTERNS) は
  nested subprocess 経由の呼出に発動しない (T14 Decision 3、F10 parent-process
  免除と同原理)。
- workflow-impl (既存) と workflow-merge (新規) は並走する
  (F1)。破線は非同期ハンドオフ (ラベル経由)。

## コンポーネント責務表

| コンポーネント                  | 種別                                                                    | 入力                                                                        | 出力                                                              | 責務                                                                                                                                                                                                                                                                                                                                                                                | LLM |
| ------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **reviewer-agent**              | LLM agent (既存)                                                        | PR 本体 (gh pr view/diff/checks, github_read MCP)                           | verdict JSON (via orchestrator の永続化層) + `merge:ready` ラベル | PR の評価・判定。承認/差戻し/CI 待ち等の判断。**本設計ではプロンプト変更なし**。                                                                                                                                                                                                                                                                                                    | Yes |
| **workflow-merge orchestrator** | 新規 (既存 orchestrator の別 workflow.json)                             | `.agent/workflow-merge.json`, GitHub labels                                 | issue phase 遷移, agent runner 起動                               | `merge-ready` phase の issue を actionable phase handler で pick し、`agents/scripts/run-agent.ts` を subprocess で起動して merger agent を dispatch する (00-design-decisions.md § T14 Decision 1)。既存 orchestrator のコードを再利用 (F1, F2, F3)。                                                                                                                              | No  |
| **agent runner**                | 既存 (`agents/scripts/run-agent.ts` + `AgentRunner` + `boundary-hooks`) | CLI args (`--issue`, `--pr`, `--verdict-path`) + `.agent/merger/agent.json` | closure step spawn                                                | `run-agent.ts` が agent.json を load、`AgentRunner` が closure step `"merge"` を dispatch、`${context.*}` template を substitute して `merge-pr.ts` を subprocess として起動。本設計は Phase 0 prerequisite (template substitution / issue.payload binding / closure subprocess kind) を要する (00-design-decisions.md § T14 Decision 2)。**LLM 非介在** (closure は prompt なし)。 | No  |
| **merger-cli**                  | 新規 CLI (`agents/scripts/merge-pr.ts`)                                 | `--pr <number>`, verdict JSON path                                          | exit code, `merge:done`/`merge:blocked` label, verdict outcome    | verdict を読み (不在時は step -1 で `verdict-missing` → `rejected`)、`args.pr === verdict.pr_number` を照合し (step -0.5)、GitHub API で前提ゲートを評価し、全真なら `gh pr merge` を実行する。**LLM 非介在**。                                                                                                                                                                     | No  |
| **verdict-store**               | ファイルストア                                                          | reviewer-agent の出力                                                       | `.agent/verdicts/<pr-number>.json`                                | verdict の JSON 永続化。reviewer-agent が書き、merger-cli が読む。並走安全のため per-PR ファイル分離。                                                                                                                                                                                                                                                                              | No  |
| **既存 iterator**               | LLM agent (既存)                                                        | 既存 workflow-impl                                                          | 既存の通り                                                        | **非干渉**: 本設計では一切変更しない (F5)。                                                                                                                                                                                                                                                                                                                                         | Yes |
| **既存 reviewer closure**       | closure step (既存)                                                     | 既存 workflow-impl                                                          | 既存の通り + verdict JSON と `merge:ready` ラベル (追加出力)      | reviewer-agent が承認判定したとき、orchestrator の既存 label 付与機構 (F4) を通じて `merge:ready` を付ける。プロンプト本体は無変更。                                                                                                                                                                                                                                                | Yes |

## LLM 境界

```mermaid
flowchart LR
    subgraph LLM["LLM path<br/>(評価のみ)"]
        direction LR
        A[reviewer-agent] --> B[verdict JSON]
    end
    subgraph DET["Deterministic path<br/>(実行のみ、LLM 不介在)"]
        direction LR
        C[merger-cli] --> D[前提ゲート<br/>mergeable ∧ reviewDecision='APPROVED'<br/>∧ statusCheckRollup all SUCCESS<br/>∧ base branch 合致]
        D -->|true| E[gh pr merge]
        D -->|false| F[merge:blocked]
    end
    B -.->|verdict-store<br/>ファイル経由| C

    style LLM fill:#fde68a,stroke:#b45309
    style DET fill:#bbf7d0,stroke:#15803d
```

**境界条件**:

1. LLM path の出力は **必ず JSON ファイル (verdict-store)**
   を経由する。メモリ内の直接呼び出しやパイプはしない。
2. Deterministic path の入力は **verdict JSON と GitHub API のみ**。LLM
   プロンプトや MCP tool は呼ばない。
3. 前提ゲートは 4 つの独立条件の **AND 合成**。全て GitHub API
   から取得する事実ベース値:
   - `mergeable === "MERGEABLE"`
   - `reviewDecision === "APPROVED"`
   - `statusCheckRollup` の全要素が `conclusion === "SUCCESS"` (skipped/neutral
     は除外ルール要検討、詳細は 03)
   - `baseRefName` が許可リスト (例: `develop`, `main`) に合致
4. いずれかが偽なら merger-cli は `merge:blocked` ラベルを付けて exit
   1。`gh pr merge` は呼ばない。
5. verdict の `outcome` フィールドと前提ゲートの AND が最終判定。verdict
   だけでも、ゲートだけでも merge には不十分。

## 既存への非干渉証明

本設計で **変更しないファイル**
を列挙する。設計レビュー時にこのリストを根拠に非干渉を確認する。

| ファイル/領域                                                               | 非干渉の根拠                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents/common/tool-policy.ts` (`BOUNDARY_BASH_PATTERNS`, `BOUNDARY_TOOLS`) | F5 より global block なので変更すると全 agent に影響する。merger-cli は agent runner 経由の孫 subprocess として起動され、SDK tool-policy は nested subprocess 呼出に発動しない (T14 Decision 3)。F7 の `githubPrMerge` スタブも放置。                                                                               |
| `agents/runner/boundary-hooks.ts`                                           | F6 の boundary hook は iterator/reviewer の closure step 内で `Deno.Command("gh",...)` を実行する機構。merger 用 closure step は `boundary-hooks.ts` の共通機構を通過するが、本設計では hook の挙動を拡張しない (Phase 0-b の template substitution 拡張は AgentRunner 側で行う)。                                  |
| `agents/verdict/external-state-adapter.ts`                                  | `githubPrMerge` ハンドラ追加は F7 で未実装だが、本設計では追加しない。LLM → adapter → `gh pr merge` の経路そのものを排除するため、ハンドラが不要。                                                                                                                                                                  |
| reviewer agent prompt / steps_registry.json                                 | プロンプト変更なし。reviewer の出力フォーマットから orchestrator 層で verdict JSON を導出するため、prompt 側の修正は不要。                                                                                                                                                                                          |
| iterator agent prompt / steps_registry.json                                 | 完全非干渉。iterator は merge に関与しない。                                                                                                                                                                                                                                                                        |
| `agents/orchestrator/workflow-loader.ts`                                    | F1, F2, F3 の既存機能 (`--workflow`, `labelPrefix`, `issueStore.path`) を流用するのみ。ローダ自体の変更不要。                                                                                                                                                                                                       |
| `agents/scripts/run-agent.ts`                                               | T14 で本設計は `run-agent.ts` に依存する方針へ変更 (workflow-merge orchestrator → run-agent.ts → merger-cli の 3 層構造)。ただし本 PR 内での直接変更は行わず、Phase 0 prerequisite (issue.payload → agent.parameters binding、closure.runner.args template substitution) として別 PR または先行コミットで拡張する。 |
| `agents/common/worktree.ts` (`finalizeWorktreeBranch`)                      | F10 のパターンは参考にするが流用はしない。merger-cli は独立した entry point。                                                                                                                                                                                                                                       |

**追加/新規ファイル** は以下のみ (詳細は `05-implementation-plan.md`):

- `agents/scripts/merge-pr.ts` (merger-cli 本体, 新規)
- `.agent/workflow-merge.json` (workflow 定義, 新規)
- `.agent/verdicts/<pr-number>.json` (runtime 生成, 新規ディレクトリ)
- verdict schema 定義 (TypeScript type のみ, 配置は実装計画で決定)

**変更が許されるファイル** (設計ドキュメント外):

- `deno.json` の tasks 節に `agent-merge`
  等のタスクを追加する可能性はある。ただしこれは実装計画
  (05-implementation-plan.md) で決定する。

## 並走時の相互作用

workflow-impl と workflow-merge は独立した issue-store / label
名前空間を持つため、相互のロック競合や phase 誤遷移は発生しない
(F3)。両者の接続点は以下のみ:

1. **Label `merge:ready` の授受**: workflow-impl の reviewer が承認 →
   `merge:ready` 付与 → workflow-merge の actionable phase handler が
   `merge-ready` phase issue を pick。
2. **Verdict JSON の授受**: workflow-impl の reviewer closure が書く →
   merger-cli が読む。
3. **GitHub PR の状態**: 両 workflow とも同じ PR を参照するが、workflow-impl
   は読み取り + push のみ、workflow-merge は merge のみ。書き込み先が排他。

これらの接続点は全て **ファイル** または **GitHub API**
経由で、プロセス内共有状態を持たない。

## エラー伝播とフェイルセーフ

Deterministic path における失敗モードと対処を明記する。

| 失敗点                                                                       | 検知方法                     | 対処                                                                                                                     | LLM 介在 |
| ---------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| verdict JSON 読み込み失敗 (ファイル不在)                                     | `Deno.readTextFile` の throw | `merge-blocked` 遷移 + PR コメント「verdict missing」                                                                    | No       |
| verdict JSON パースエラー                                                    | `JSON.parse` の throw        | `merge-blocked` 遷移 + PR コメント「verdict malformed」                                                                  | No       |
| `gh pr view --json ...` 失敗 (ネットワーク, 認証)                            | exit code 非 0               | merger-cli は exit 2 (retry 可能エラー)。workflow-merge の cycle 再試行に委ねる。                                        | No       |
| 前提ゲートの一部が false                                                     | 純関数評価の結果             | verdict outcome を `ci-pending` / `approvals-missing` / `conflicts` / `rejected` のいずれかに分類し、対応する phase 遷移 | No       |
| `gh pr merge` 失敗                                                           | exit code 非 0               | エラー種別を判定し、retriable なら `merge-ready` 維持、そうでなければ `merge-blocked`                                    | No       |
| verdict と GitHub 事実の乖離 (例: verdict=merged だが mergeable=CONFLICTING) | 前提ゲートで捕捉             | GitHub 事実を優先。verdict を信用せず `conflicts` として `merge-blocked`                                                 | No       |

**原則**: 不明な状態は全て `merge-blocked` に倒し、人間の判断を待つ。自動復旧は
`ci-pending` の self-loop のみ。

## プロセス境界と権限

| プロセス                      | 起動方法                                                                                                                                                                                                          | 権限                                                                                      | Deno flags                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| workflow-impl orchestrator    | 既存 `deno task agent` 等                                                                                                                                                                                         | 既存通り                                                                                  | 既存通り                                                                        |
| workflow-merge orchestrator   | `deno task agent --workflow .agent/workflow-merge.json` (仮)                                                                                                                                                      | issue-store 書き込み, GitHub read, subprocess spawn (agent runner 経由で subprocess 起動) | `--allow-read --allow-write .agent --allow-run --allow-net`                     |
| agent runner (`run-agent.ts`) | workflow-merge orchestrator から subprocess spawn                                                                                                                                                                 | issueStore read, agent.json read, closure subprocess spawn                                | `--allow-read .agent --allow-write (metrics のみ) --allow-run=deno --allow-env` |
| merger-cli                    | workflow-merge orchestrator → `agents/scripts/run-agent.ts` → `AgentRunner` closure step runner から subprocess spawn (本番)、または手動 `deno run agents/scripts/merge-pr.ts --pr <n>` (ローカル dry-run 検証用) | GitHub API read + merge, label 変更, verdict read                                         | `--allow-read .agent --allow-run=gh --allow-net=api.github.com`                 |

merger-cli は最小権限。ファイル書き込み権限は持たず、GitHub への書き込みは `gh`
経由に限定。
