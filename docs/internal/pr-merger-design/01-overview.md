# 01 Overview — PR Merger

> **Canonical source**: 00-design-decisions.md § T10 (2026-04-13)。outcome 名は
> T8、Scheduler/Reason/issueStore は T10 + 03-data-flow.md を参照。

## 目的

PR merge プロセスを **AI 判断** と **機械実行** に責務分離し、決定論化する。

- **AI (reviewer-agent)**: PR
  の内容を読んで評価する。承認/差戻しの判定、理由の説明、verdict JSON
  の出力を担う。
- **機械 (merger-cli)**: verdict + 前提ゲート (mergeable / reviewDecision /
  statusCheckRollup) のブール合成に基づき `gh pr merge` を実行する。LLM
  呼び出しを一切含まない。

この分離により、以下を達成する。

1. `gh pr merge` 実行経路に LLM が介在しないため、merge の副作用は verdict と
   GitHub API の事実のみで決まる。
2. reviewer-agent の出力は verdict-store に JSON として永続化され、merger-cli
   が非同期に観測できる (並走安全)。
3. 既存 iterator / reviewer の挙動 (BOUNDARY_BASH_PATTERNS, boundary hook,
   tool-policy) は一切変更しない。

## スコープ

本設計が扱うのは以下の 3 点のみ。

- **merger-cli の新設**: `agents/scripts/merge-pr.ts` を新規追加。verdict
  を読み、GitHub API で前提ゲートを評価し、gate が全て真なら `gh pr merge`
  を実行する純粋な CLI。
- **reviewer-agent 出力の verdict 契約**: 既存 reviewer の出力から verdict JSON
  (`tmp/climpt/orchestrator/emits/<pr-number>.json`)
  を導出する契約を定義する。reviewer プロンプト自体は変更せず、orchestrator の
  verdict 永続化層で対応する。
- **workflow-merge.json 追加**: `.agent/workflow-merge.json`
  を新設し、`workflow-impl` (既存) と並走させる。`labelPrefix: "merge:"` /
  `issueStore.path: ".agent/climpt/tmp/issues-merge"` で名前空間を分離する (F2,
  F3)。

## 非スコープ

以下は本設計では扱わない。

- **既存 iterator / reviewer の挙動変更**: プロンプト、steps_registry、agent
  definition、runnerArgs の転送ルールは一切変更しない。
- **`BOUNDARY_BASH_PATTERNS` の変更**: `gh pr merge` を agent 側の closure step
  で許可する方向性は採らない (F5)。merge は agent の外、merger-cli
  のプロセスで実行する。
- **`external-state-adapter.ts` の `githubPrMerge` ハンドラ追加**: F7
  の未実装スタブは放置する。LLM → boundary hook → `gh pr merge`
  の経路そのものを排除するため、ハンドラを足す必要がない。
- **reviewer-agent の tool 追加**: `gh pr view/diff/checks` は既に read-only
  として許可済み (F8)、`github_read` MCP も注入済み (F9)。reviewer-agent
  への新規 tool 追加は不要。
- **finalizeWorktreeBranch パターンの流用**: `gh pr create` を parent
  プロセスで実行する既存パターン (F10) は参考にするが、merger-cli は独立した CLI
  として起動する。

## 用語集

| 用語                               | 定義                                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **reviewer-agent**                 | PR を評価する LLM エージェント (既存)。承認判定と verdict 相当の情報を出力する。本設計ではプロンプトを変更しない。                                                                                                                                             |
| **merger-cli**                     | `agents/scripts/merge-pr.ts`。verdict と GitHub API 事実から merge 実行可否を決定論的に判定し、`gh pr merge` を呼ぶ CLI。LLM 非介在。                                                                                                                          |
| **verdict-store**                  | `tmp/climpt/orchestrator/emits/<pr-number>.json` 配下の verdict 永続化領域。reviewer-agent が書き、merger-cli が読む。                                                                                                                                         |
| **前提ゲート (precondition gate)** | `gh pr view --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup` の戻り値を純関数で評価するブール合成。全て真のときのみ merge を許可する。                                                                                                      |
| **workflow-merge**                 | `.agent/workflow-merge.json`。既存 `workflow.json` (本設計では `workflow-impl` と呼ぶ) と並走する新規 workflow 定義。                                                                                                                                          |
| **workflow-impl**                  | 既存の implementation / review 用 workflow。本設計では変更しない。                                                                                                                                                                                             |
| **verdict**                        | reviewer-agent が出す JSON 契約。`verdict` フィールド ∈ {`approved`, `rejected`} を持ち、merger-cli が GitHub 事実と合成して canonical outcome ∈ {`merged`, `ci-pending`, `approvals-missing`, `conflicts`, `rejected`} を決定する。詳細は `03-data-flow.md`。 |
| **Deterministic path**             | LLM 呼び出しを一切含まない実行経路。merger-cli, 前提ゲート, `gh pr merge` の一連を指す。                                                                                                                                                                       |
| **LLM path**                       | reviewer-agent の評価から verdict 出力までの経路。ここから Deterministic path へのハンドオフは verdict JSON ファイルのみで行う。                                                                                                                               |

## スコープ境界の明示 (境界線上の事項)

スコープ内外の判定が曖昧になりやすい項目を明示する。

| 項目                                                               | スコープ                                  | 理由                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| reviewer-agent が出す生データ → verdict JSON の変換層              | **内**                                    | 本設計の「verdict 契約」の一部。ただし reviewer プロンプト本体は不変。 |
| `.agent/climpt/tmp/issues-merge` の issue-store 実装               | **内** (既存コード流用)                   | F3 の `issueStore.path` 指定で対応。新規コード不要。                   |
| GitHub label `merge:ready` / `merge:blocked` / `merge:done` の定義 | **内**                                    | workflow-merge.json の `labelPrefix` と phase から自動導出 (F4)。      |
| merge method (squash/merge/rebase) の選定                          | **内** (05-implementation-plan.md で決定) | merger-cli の CLI option として持つ。                                  |
| merge 失敗時のリトライ戦略                                         | **内**                                    | maxCycles による CI 待ちのみ許容。conflicts は即 blocking。            |
| reviewer-agent のツールに `gh pr merge` を追加                     | **外**                                    | Design Principle 2 に反する。F5/F7 の事実を踏まえて排除。              |
| Slack/Discord 等への通知                                           | **外**                                    | 本設計のスコープではない。将来の拡張。                                 |
| ブランチ保護ルール (GitHub settings)                               | **外**                                    | GitHub 側の運用設定。コード側は関与しない。                            |

## 関連ドキュメント

- **`agents/docs/builder/06_workflow_setup.md` の「並走」節**: 複数
  workflow.json の並走運用パターン。本設計はこのパターンに `labelPrefix` と
  `issueStore.path` の分離を追加して適用する (F1, F2, F3)。
- **`00-design-decisions.md` の Established Facts**: F1-F10
  は本設計の前提事実。特に F5 (BOUNDARY は global block) と F7 (`githubPrMerge`
  ハンドラ未実装) が「LLM を merge パスから排除する」設計判断の根拠。
- **`docs/internal/pr-merger-design/02-architecture.md`**:
  コンポーネント責務、LLM 境界、非干渉証明。
- **`docs/internal/pr-merger-design/03-data-flow.md`**: verdict JSON
  スキーマとシーケンス図。
- **`docs/internal/pr-merger-design/04-state-machine.md`**: workflow-merge.json
  の phase 遷移と label 対応。
- **`docs/internal/pr-merger-design/05-implementation-plan.md`**:
  追加ファイル一覧と実装順序。
- **`docs/internal/pr-merger-design/06-workflow-examples.md`**:
  `.agent/workflow-merge.json` の具体例。

## 設計原則の再確認 (00-design-decisions.md より)

1. **責務分離**: AI (reviewer) は評価のみ、機械 (merger) は実行のみ。
2. **LLM を merge path から排除**: `gh pr merge` の前段に LLM
   呼び出しを入れない。
3. **既存に非干渉**: iterator/reviewer の BOUNDARY_BASH_PATTERNS や boundary
   hook は触らない。
4. **並走モデル活用**: merger は独立 workflow/CLI、orchestrator の既存 run
   と並走 (F1)。
5. **前提ゲートは純関数**: mergeable / reviewDecision / statusCheckRollup
   のブール合成。

これらは全ての後続ドキュメント (02〜06) が従う。

## 主要設計判断の要約

以下は本設計が採用する主要判断。根拠は F1-F10 と Design Principles に帰する。

| 判断                         | 採用                                  | 不採用案                                         | 根拠                                                                                                                                |
| ---------------------------- | ------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| merge の実行場所             | 親プロセス (merger-cli)               | agent の closure step 内で `gh pr merge` 実行    | F5: BOUNDARY_BASH_PATTERNS は global block で per-agent override 不可。agent 内実行のためには global 変更が必要で、副作用が大きい。 |
| reviewer と merger の接続    | verdict JSON ファイル (verdict-store) | プロセス内共有 / HTTP / stdin pipe               | F1, F3 の並走モデルに合致。ファイル経由なら非同期かつプロセス独立。                                                                 |
| workflow 分離                | 独立 `workflow-merge.json`            | 既存 `workflow.json` に merge phase を追加       | F1, F2, F3 の既存分離機構を活かす。workflow-impl を汚染しない。                                                                     |
| `githubPrMerge` ハンドラ実装 | 実装しない                            | F7 のスタブを埋める                              | Design Principle 2: LLM → adapter 経路を排除する。ハンドラ実装は LLM 経由 merge を認めることになる。                                |
| 前提ゲートの評価者           | merger-cli (純関数)                   | reviewer-agent が verdict に書いたブール値を信用 | Design Principle 5: 事実は GitHub API から毎回取得する。LLM の報告値を信用しない。                                                  |
| maxCycles (CI 待ち)          | 3 (= 最大 3 分)                       | 無制限 / 1                                       | `04-state-machine.md` 参照。climpt CI は通常 2 分以内。                                                                             |
| merge method                 | `--squash` (デフォルト想定)           | merge commit / rebase                            | 実装計画 (05-implementation-plan.md) で確定。リポジトリ方針に合わせる。                                                             |

### トレードオフの受容

- **リアルタイム性の低下**: verdict JSON 経由のため、reviewer 承認から merge
  までにポーリング間隔分の遅延がある。これは「責務分離と既存非干渉」のために受容する。
- **verdict JSON の整合性リスク**: reviewer-agent が書いてから label
  を付けるまでの間に merger-cli が走ると verdict
  不在になる。`04-state-machine.md` の書き込み順序約束で回避する。
- **merger-cli の起動コスト**: Deno プロセスの起動が毎回発生するが、CI 待ち
  cycle 以外は頻度が低いため許容。

## ドキュメント間の依存関係

```
01-overview.md (本書)
  ├─ 前提: 00-design-decisions.md の F1-F10 と Design Principles
  ├─ 定義: 用語, スコープ, 原則
  │
  ├→ 02-architecture.md     (構造: コンポーネント, LLM 境界, 非干渉)
  ├→ 03-data-flow.md        (契約: verdict JSON schema, シーケンス)
  ├→ 04-state-machine.md    (動作: phase 遷移, label, maxCycles)
  ├→ 05-implementation-plan.md (実装: 追加ファイル, テスト方針)
  └→ 06-workflow-examples.md   (具体: workflow-merge.json の実体)
```

読む順序は上記の通り。01 で語彙を掴み、02 で構造を、03 で契約を、04
で動作を、05-06 で実体に降りる。

## Done Criteria (本ドキュメント単独)

本ドキュメント (01-overview.md) が満たすべき条件。

- [x] 目的が一文で表現されている (「AI 判断と機械実行の責務分離」)。
- [x] スコープ 3 項目 (merger-cli, verdict 契約, workflow-merge.json)
      が列挙されている。
- [x] 非スコープに F7 の `githubPrMerge` ハンドラ追加が明示されている。
- [x] 用語集に全 canonical 名 (reviewer-agent, merger-cli, verdict-store,
      workflow-merge) が含まれる。
- [x] 関連ドキュメントへのリンクが張られている。
- [x] 設計判断の要約表が設計原則 (Design Principles 1-5) と対応している。
- [x] 既存ファイル F1-F10 の事実に反する記述がない。

## 注意事項

- **本ドキュメントは設計のみ**: 実装コード (TS, Deno)
  は一切含まない。擬似コードも Data Flow / Implementation Plan 側に置く。
- **既存ファイルへの参照**: F1-F10 は 00-design-decisions.md
  からの転記なので、line 番号が実装進展でずれても 00-design-decisions.md
  側を更新して本書は更新しない (00-design-decisions.md を source of truth
  とする)。
- **Mermaid スタイル統一**: 02/03/04 の Mermaid で色指定は `#fde68a` (LLM path,
  黄) / `#bbf7d0` (Deterministic path, 緑) / `#e5e7eb` (既存・不変, 灰)
  を共通で用いる。

## Canonical 名の統一

全成果物 (01-06) で以下の名前を統一する。別名の提案やエイリアスは作らない。

| カテゴリ                                     | Canonical 名                                                             | 使用箇所                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| コンポーネント                               | `reviewer-agent`                                                         | LLM 評価側の役割名                                                                                                                 |
| コンポーネント                               | `merger-cli`                                                             | 決定論実行側の役割名                                                                                                               |
| コンポーネント                               | `verdict-store`                                                          | JSON ファイルストア                                                                                                                |
| ファイル                                     | `agents/scripts/merge-pr.ts`                                             | merger-cli の実体 (新規)                                                                                                           |
| ファイル                                     | `.agent/workflow-merge.json`                                             | workflow 定義 (新規)                                                                                                               |
| ファイル                                     | `tmp/climpt/orchestrator/emits/<pr-number>.json`                         | verdict 永続化 (runtime 生成)                                                                                                      |
| Phase                                        | `merge-ready` / `merge-blocked` / `merged`                               | workflow-merge.json の phase 名                                                                                                    |
| Label                                        | `merge:ready` / `merge:blocked` / `merge:done`                           | GitHub label 名                                                                                                                    |
| Verdict outcome (canonical, merger-cli 内部) | `merged` / `ci-pending` / `approvals-missing` / `conflicts` / `rejected` | merger-cli の canonical outcome (verdict JSON の `verdict` フィールドは `approved` / `rejected` の 2 値のみ — 03 JSON Schema 参照) |

これらの名前は `03-data-flow.md` の型定義や `06-workflow-examples.md`
の設定ファイルでも文字列として使用される。typo
による不整合を防ぐため、実装時は定数化を推奨する (実装計画
05-implementation-plan.md で扱う)。
