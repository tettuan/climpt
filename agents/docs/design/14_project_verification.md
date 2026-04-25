# 14. Project Verification Criteria

> Status: draft. Level: 2 (Structure / Contract) per `/docs-writing` framework.
> Companion to `13_project_orchestration.md` — defines **how** Goal達成 (= AC
> 充足) is verified, orthogonal to **what** each project's AC is.

## 0. Context

`13_project_orchestration.md` は project orchestration の機構 (phase 宣言 / hook
/ outbox) を定義する。本 doc は **その機構の上で project-evaluator が AC
充足を判定するための universal な検証観点** を定義する。

Project README は project 固有の Goal と AC を記述し、本 doc を参照する。

- **Goal** = 到達したい状態 (project README に記述、generic template)
- **AC (Acceptance Criteria)** = Goal 達成の判定 predicate (project README
  に記述、project-specific)
- **検証観点 (Verification Axes)** = AC 充足を判定する universal な lens (本 doc
  に記述、project 横断)
- **gh issues** = Goal → AC 充足 までの開発サイクルの process (live GH project
  membership、README 内には enumerate しない)

## 1. Principle (Level 1 要約)

| 原則               | 内容                                                         |
| ------------------ | ------------------------------------------------------------ |
| P1 AC clear = Done | 全 AC が全 検証観点で clear した時点で project は Done       |
| P2 Universal axes  | 検証観点は project に依存しない普遍 lens、本 doc に集約      |
| P3 AND combine     | 検証観点は AND で結合される (1 軸でも未充足 → AC 未 clear)   |
| P4 Anti-bloat      | 検証観点は scope 拡大 / 実装肥大化を防ぐ品質ゲートを内包する |

## 2. Structure / Contract

### 2.1 Verification Axes

project-evaluator は以下 6 軸で各 AC を check する。**全軸 pass = AC clear**。

| ID | 観点                 | Predicate                                                                 | 観測手段 (例)                                                                                                |
| -- | -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| V1 | CI 通過              | `deno task ci` が green                                                   | repo 上で `deno task ci` 実行、exit code 0                                                                   |
| V2 | Goal 実行の機能性    | Goal で目指した動作が fixture / 実環境で再現可能                          | orchestrator を 1 セッション走らせ、宣言された phase chain がエラーなく完走                                  |
| V3 | ログ証跡             | 実行 log が実際の実行を証明 (= 後追い可能な痕跡)                          | `tmp/logs/` の session JSONL に対象 phase / hook / agent の発火痕跡が残る                                    |
| V4 | 独立監査 (sub-agent) | コンテキスト未引継ぎ sub-agent による批判的 check が **3 回以上連続合格** | `Agent(subagent_type, prompt)` を fresh context で 3 回起動、全回 pass                                       |
| V5 | 設計整合             | 設計思想 / 設計方針 (CLAUDE.md, design doc) との整合性 — scope 拡大防止   | `/docs-consistency` skill 差分ゼロ + 設計原則 (全域性 / Core-first / 後方互換不要 / fallback最小限) との照合 |
| V6 | 責務分解             | refactoring を経て責務分離が成立 — 実装肥大化防止                         | 各 module の単一責務、boundary 明確、循環依存なし、godclass / godfile なし                                   |

### 2.2 Combine rule

- 全 AC × 全 検証観点 = AND
- 1 軸でも未充足の AC があれば → evaluator は `verdict: incomplete` を返す
- 全 AC 全軸 pass → `verdict: complete` → orchestrator が `closeProject` を発火

### 2.3 V4 sub-agent audit protocol

V4 (独立監査) は 3 回以上連続合格を要求する universal protocol。

- **コンテキスト未引継ぎ**: 各監査回は fresh sub-agent (前回の prompt /
  結論を引き継がない) を起動する
- **批判的 check**: 監査 prompt は「pass
  を前提とせず、欠陥を能動的に探す」立場で書かれる
- **3 回以上連続合格**: 連続 3 回が全て pass。途中 1 回でも fail → カウンタ
  reset、再度連続 3 回を要求
- **観測手段**: 各監査の出力 (fresh log) と pass / fail 判定が evaluator
  から参照可能

### 2.4 Project README からの参照

各 project README は AC list の冒頭または末尾で本 doc を参照する:

```markdown
## Acceptance Criteria

Goal 達成の判定条件。検証観点は `agents/docs/design/14_project_verification.md`
を参照。

- AC-1: ...
- AC-2: ...
```

## 3. Invariants

| ID | Invariant                                                                                 |
| -- | ----------------------------------------------------------------------------------------- |
| I1 | AC は project-specific、検証観点は universal — 検証観点は project ごとに変えない          |
| I2 | AC × 検証観点 は AND — どの軸でも 1 件 fail なら AC 未 clear                              |
| I3 | V4 (独立監査) は 3 回以上連続合格を要求 — 累積ではなく **連続**                           |
| I4 | 検証観点を満たさない AC は `verdict: incomplete` を引き起こし、planner 再起動でループ継続 |

## 4. Boundary summary

| 責務                     | 担当                                                          |
| ------------------------ | ------------------------------------------------------------- |
| Goal 文の記述            | project README (user 執筆)                                    |
| AC predicate の記述      | project README (user 執筆)                                    |
| 検証観点の定義           | 本 doc (`14_project_verification.md`)                         |
| AC × 検証観点 の判定実行 | project-evaluator agent                                       |
| `closeProject` 発火      | orchestrator (evaluator の `verdict: complete` を trigger に) |
| sub-agent 監査の起動     | project-evaluator (V4 protocol に従う)                        |

## 5. 関連

- `13_project_orchestration.md` — phase / hook / outbox の機構定義
- `02_core_architecture.md` — Stateless 原則
- `agents/docs/builder/` — agent builder guide
- CLAUDE.md — 設計原則 (全域性 / Core-first / 後方互換不要 / fallback 最小限)
