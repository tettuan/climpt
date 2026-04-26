# 14. Project Verification Criteria

> Status: draft. Level: 2 (Structure / Contract) per `/docs-writing` framework.
> Companion to `13_project_orchestration.md` — defines **how** Goal 達成 (= AC
> 充足) is verified, orthogonal to **what** each project's AC is.

## 0. Context

本 doc は、ソフトウェア開発の **release 受け入れ基準 (Acceptance Criteria)
を判定するための universal な検証観点** を定義する。 Project / feature / release
単位を問わず適用可能で、climpt では `13_project_orchestration.md` が定義する
project orchestration 機構 (phase / hook / outbox) の上で、project-evaluator
agent が本 doc の検証観点を機械的に適用する。

機構と判定基準を分離する目的:

- 機構変更 (orchestrator hook の追加 / phase 名変更)
  と判定変更を独立に進化させる
- climpt 以外のプロジェクトでも本 doc を参照し、同一の release AC framework
  を再利用できるようにする

### 用語定義

| 用語                                | 定義                                                                                | 記述場所                  |
| ----------------------------------- | ----------------------------------------------------------------------------------- | ------------------------- |
| Goal                                | 到達したい状態 (one-line)                                                           | project README            |
| AC (Acceptance Criteria)            | Goal 達成を判定する predicate (project 固有)                                        | project README            |
| Verification Axes (検証観点)        | AC 充足を判定する universal lens (project 横断)                                     | 本 doc §2.1               |
| Process (gh issues, PR, commit etc) | Goal → AC 充足 までの開発活動の痕跡。AC enumerate には使わず、live query で参照する | GH issues / PRs / commits |

## 1. Principle (Level 1 要約)

| 原則               | 内容                                                           |
| ------------------ | -------------------------------------------------------------- |
| P1 AC clear = Done | 全 AC が全 検証観点で clear した時点で release 可              |
| P2 Universal axes  | 検証観点は project に依存しない普遍 lens、本 doc に集約        |
| P3 AND combine     | 検証観点は AND で結合 (1 軸でも未充足 → AC 未 clear)           |
| P4 Evidence-based  | 各軸の合否は observable artifact で判定。主観的 assertion 不可 |
| P5 Anti-bloat      | 検証観点は scope 拡大 / 実装肥大化を防ぐ品質ゲートを内包する   |

## 2. Structure / Contract

### 2.1 Verification Axes

Release evaluator (climpt では project-evaluator agent) は以下 7 軸で各 AC を
check する。**全軸 pass = AC clear**。

| ID | 観点                | Predicate                                                                 | 観測手段 (climpt 例)                                                                                         |
| -- | ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| V1 | 自動検査 green      | CI / lint / type check / unit + integration test 全 green                 | `deno task ci` exit code 0、CI run の summary log                                                            |
| V2 | 機能性検証          | Goal 宣言の動作が実環境 / fixture で end-to-end に再現可能                | orchestrator を 1 セッション走らせ、宣言された phase chain がエラーなく完走 (golden path + edge case)        |
| V3 | 実行証跡            | 実行 log が "実際に動いた" ことを後追い可能な形で残す                     | `tmp/logs/` の session JSONL に対象 phase / hook / agent の発火痕跡が timestamp 付きで存在                   |
| V4 | 独立監査            | コンテキスト未引継ぎの fresh sub-agent が批判的 check で **3 回連続合格** | `Agent(subagent_type, prompt)` を fresh context で 3 回起動、全回 pass (§2.4 protocol)                       |
| V5 | 設計整合 (top-down) | 設計意図 / 設計原則との整合性 — scope 拡大 / 設計逸脱の防止               | `/docs-consistency` 差分ゼロ + 設計原則 (全域性 / Core-first / 後方互換不要 / fallback最小限) との review    |
| V6 | 構造健全性          | 単一責務 / 境界明確 / 循環依存なし / godclass・godfile なし               | module 単位の責務分離 review、dependency graph 検査、複雑度 metric (cyclomatic / file-size) が threshold 内  |
| V7 | ドキュメント反映    | 変更が user-facing / internal docs に反映済 (code → docs の bottom-up)    | README / `--help` / CHANGELOG / 関連 design doc の差分が implementation と一致 (`/update-docs` 実行で no-op) |

### 2.2 Combine rule

- 全 AC × 全 検証観点 = AND
- 1 軸でも未充足の AC があれば evaluator は `verdict: incomplete` を返す
- 全 AC 全軸 pass → `verdict: complete` → orchestrator が `closeProject` を発火
- AC 間の優先度・順序付けは行わない (フラットな AND)

### 2.3 Evidence requirement (P4 detail)

各軸の判定は次のいずれかの **observable artifact** に基づく必要がある:

- exit code (process / CI step)
- file content / file diff (commit, log file, generated output)
- structured query result (gh API, log search)
- fresh sub-agent の判定 (V4)

不可:

- 「動くと思う」「概ね問題ない」等の主観的 assertion
- artifact 提示なしの "pass" 宣言
- 過去 cycle の cached 判定 (release window 内で再観測する)

### 2.4 V4 sub-agent audit protocol

V4 (独立監査) は universal protocol。

- **コンテキスト未引継ぎ**: 各監査回は fresh sub-agent (前回の prompt /
  結論を引き継がない) を起動する
- **批判的 check**: 監査 prompt は「pass を前提とせず、欠陥を能動的に探す」
  立場で書かれる
- **3 回以上連続合格**: 連続 3 回が全て pass。途中 1 回でも fail → カウンタ
  reset、再度連続 3 回を要求 (累積 pass ではない)
- **観測手段**: 各監査の出力 (fresh log) と pass / fail 判定が evaluator
  から参照可能

### 2.5 AC entry template (project README から本 doc を参照)

各 project README は AC list の冒頭で本 doc を参照する:

```markdown
## Acceptance Criteria

Goal 達成の判定条件。検証観点 (V1-V7) は
`agents/docs/design/14_project_verification.md` §2.1 を参照。 全 AC × 全軸 が
pass した時点で release 可 (P1 / P3)。

- AC-1: <project-specific predicate>
- AC-2: <project-specific predicate>
- ...
```

AC 文の書き方:

- 1 AC = 1 verifiable statement (複数条件を `AND` で 1 文に詰めない)
- 主体・対象・成立条件を明示 (passive voice 避ける)
- 観測手段が判明する程度に具体的にする

### 2.6 Project-specific extensions

V1-V7 は floor (最小集合)。 project は次のように追加できる:

- **軸の追加 (V8+)** 可: project 固有の非機能要件 (e.g. 性能 SLA、互換性
  matrix、 migration 検証)。追加軸も §2.2 AND combine に組み込む
- **軸の弱化 / 削除 不可**: V1-V7 は universal floor。project が opt-out すると
  release AC framework としての保証が崩れる
- **観測手段の差し替え** 可: 例えば V1 を `npm test` に置換するなど。 predicate
  (= 何を保証するか) は変更しない

## 3. Invariants

| ID | Invariant                                                                                            |
| -- | ---------------------------------------------------------------------------------------------------- |
| I1 | AC は project-specific、検証観点は universal — 検証観点は project ごとに変更しない (§2.6 拡張は除く) |
| I2 | AC × 検証観点 は AND — どの軸でも 1 件 fail なら AC 未 clear                                         |
| I3 | V4 (独立監査) は 3 回以上 **連続** 合格を要求 — 累積ではない                                         |
| I4 | 各軸の合否判定は observable artifact に基づく — 主観 assertion は判定根拠にならない                  |
| I5 | 検証観点を満たさない AC は `verdict: incomplete` を引き起こし、planner 再起動でループ継続            |
| I6 | release window 内で全軸が再観測される — 過去 cycle の pass 結果は cached 判定として持ち越さない      |

## 4. Boundary summary

| 責務                       | 担当                                                          |
| -------------------------- | ------------------------------------------------------------- |
| Goal 文の記述              | project README (user 執筆)                                    |
| AC predicate の記述        | project README (user 執筆)                                    |
| 検証観点 (V1-V7) の定義    | 本 doc (`14_project_verification.md`)                         |
| Project-specific 軸 (V8+)  | project README (user 執筆、本 doc §2.6 拡張規約に従う)        |
| AC × 検証観点 の判定実行   | project-evaluator agent                                       |
| `closeProject` 発火        | orchestrator (evaluator の `verdict: complete` を trigger に) |
| sub-agent 監査の起動       | project-evaluator (§2.4 V4 protocol に従う)                   |
| Observable artifact の保存 | CI / orchestrator / agent runner (`tmp/logs/`, CI artifacts)  |

## 5. Out of scope (本 doc が universal 軸として扱わないもの)

以下は **project が必要とする場合に §2.6 拡張で AC または追加軸として enumerate
する責務** とする。本 doc は universal floor のみ規定する:

| 項目                             | 扱い                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| 性能 / latency / throughput      | project が SLA を AC として記述 (e.g. "p95 latency < 200ms")          |
| Security audit / vulnerability   | project が `/security-review` 結果や CVE check を AC として記述       |
| Migration / upgrade path         | project が "v(N-1) → v(N) の data / config migration が成功" を AC に |
| Rollback plan                    | project が rollback 手順と検証を AC に記述                            |
| User-acceptance / usability test | project が UX 検証手順を AC に記述                                    |
| Operational alerting / runbook   | project が SRE 観点 (alert / runbook / on-call) を AC に記述          |

理由: これらは project ごとに必要性・閾値・観測手段が大きく異なり、universal
floor に組み込むと P5 (Anti-bloat) と矛盾する。 project が必要に応じて軸を
追加することで、universal floor の保証を崩さずに拡張できる。

## 6. 関連

- `13_project_orchestration.md` — phase / hook / outbox の機構定義
- `02_core_architecture.md` — Stateless 原則
- `01_philosophy.md` — 全域性 / Core-first / 後方互換不要 / fallback 最小限
- `agents/docs/builder/` — agent builder guide
- `/docs-consistency` skill — V5 観測手段
- `/update-docs` skill — V7 観測手段
- `/test-design` skill — V1, V2 観測手段の品質
- `/refactoring` skill — V6 観測手段の品質
- CLAUDE.md — 設計原則
