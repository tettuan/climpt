# Design — Legacy (frozen)

このディレクトリは v1.14.x まで `agents/docs/design/` 配下にあった汎用 Agent
設計文書 14 件の **凍結 snapshot** である。`agents/docs/design/realistic/`
(継承源 `tobe/` を内包) への前置換に伴い、ここへ移動した (2026-04-26)。

## Status

- **Frozen as of**: v1.14.x
- **新規参照**: 不可。Active design は `../design/realistic/` (継承源
  `realistic/tobe/` を内包)。
- **保管目的**: (1) 設計判断の **WHY** を史的に追えるようにする。 (2) realistic
  に移植されなかった概念 (worktree bind、思考実験ログ、数値 success metric 等)
  のリファレンス。
- **修正方針**: このディレクトリ内の `.md` は **編集しない**。誤りを見つけても
  Active design 側 (realistic / realistic/tobe) で対処する。

## Migration mapping (legacy → active)

下表は本 swap 時に行ったコア哲学の移植判定結果である (詳細分析:
`tmp/design-swap/migration-analysis.md`)。

| Legacy file                        | Verdict        | 移植先 (active design)                                                               | 補足                                                                            |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `01_philosophy.md`                 | **light-port** | `realistic/00-index.md` §「Realistic 設計の根本姿勢」                                | Agent 三項式 + planet model のみ移植。数値 metric / 思考実験ログは history-only |
| `02_core_architecture.md`          | no-port        | `realistic/16-flow-completion-loops.md` (Flow/Completion 構造) + `tobe/` 5 原則      | Verdict / Validation / Closure 命名は realistic で再定義済                      |
| `03_concept_tree.md`               | no-port        | `realistic/00-index.md` §「依存マップ」                                              | 概念階層は realistic で再構築                                                   |
| `04_step_flow_design.md`           | no-port        | `realistic/14-step-registry.md` §B-§E (Step ADT / TransitionTable)                   | strict gate / handoff は realistic ADT に昇格                                   |
| `05_structured_outputs.md`         | no-port        | `realistic/14-step-registry.md` §D (StructuredOutputSchemaRef + StructuredGate)      | FormatValidator / retry は SO single hinge + C3L overlay へ統合                 |
| `06_runner.md`                     | no-port        | `realistic/10-system-overview.md` (Boot/Run) + `realistic/16` §A (AgentRuntime)      | worktree / 権限制御は realistic scope 外 (実装関心)                             |
| `07_prompt_system.md`              | no-port        | `realistic/14-step-registry.md` §C (C3LAddress 5-tuple two-tier)                     | pathTemplate は C3L overlay rule に統合                                         |
| `08_model_selection.md`            | no-port        | `realistic/14-step-registry.md` §B (`model: ModelRef?`)                              | 解決優先順位は ADT field の任意性で表現                                         |
| `09_contracts.md`                  | **light-port** | `realistic/14-step-registry.md` §B 末尾 + `realistic/16-flow-completion-loops.md` §C | StepInput.uvVariables 解決 rule + Run 時 error 3 分類のみ移植                   |
| `10_extension_points.md`           | no-port        | `realistic/00-index.md` §Anti-list + `13/14 §I Anti-list` + `tobe/` 5 原則           | 拡張ガイドより構造禁則の方が realistic 方針に整合                               |
| `11_blueprint_language.md`         | no-port        | `realistic/13-agent-config.md` §A (AgentBundle) + Boot rules `A* / W* / S*` (3 set)  | Blueprint 統合 file は導入せず、3 file を Boot で integrity validate            |
| `12_orchestrator.md`               | no-port        | `realistic/12-workflow-config.md` (WorkflowConfig ADT) + `realistic/11` (3 mode)     | Label 駆動状態機械は WorkflowConfig + EventBus 連鎖で再定義                     |
| `13_project_orchestration.md`      | no-port        | `realistic/12-workflow-config.md` §C (IssueSource.GhProject)                         | gh project 連携は IssueSource ADT に昇格                                        |
| `13_project_orchestration_flow.md` | no-port        | `realistic/15-dispatch-flow.md` + `realistic/30-event-flow.md`                       | 実行フローは event chain で再表現                                               |
| `14_project_verification.md`       | no-port        | `realistic/01-requirements.md` §E + `realistic/90-traceability.md`                   | 検証視点は 7 MUST × 設計要素 traceability に統合                                |

## 移植せず history-only で残した概念

以下は legacy 固有のメモワール的価値を持つが、active design (realistic) には移
植しない。必要時に本 README から該当 legacy file を辿る。

| 概念                                              | 出典                       | 移植しない理由                                                              |
| ------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| 思考実験ログ (Gecko / Rudder / Saucier / Welder)  | `01_philosophy.md`         | 思想史的価値。realistic は freeze 後の構造論なので level-mixing を避ける    |
| 成功の数値 metric (10 分 / 3 分 / プロンプト予測) | `01_philosophy.md`         | design freeze の対象外 (運用 KPI として後段で扱う)                          |
| Phase 遷移 unit-atomic / TransactionScope         | `09_contracts.md`          | OutboxAction + EventBus chain (P3) を選んだので transactional view は方向違 |
| Issue-Branch-Worktree-Instance 1:1:1:1            | `09_contracts.md`          | worktree は実装 / runtime 関心。R5 close 経路 hard gate には触れない        |
| Blueprint 統合 file 案                            | `11_blueprint_language.md` | 3 file を Boot integrity rule で validate する道を選んだ                    |

## なぜ凍結したか

`realistic/01-requirements.md` の 7 MUST 凍結 (R1-R7) と、`tobe/` の 5 原則
(Uniform Channel / Single Transport / CloseEventBus / Fail-fast Factory / Typed
Outbox) を Active design の二本柱に据える設計判断による。Legacy 14 文書は v1
(自動 step 生成) → v2 (step 直書き + cross-file integrity) の中間形態であり、
realistic はその到達点として 7 MUST + ADT-first で再構築している。

## Builder

`agents/docs/builder/` 配下は本 swap では未着手。realistic-charts の AgentBundle
ADT が実装に landed するまでは v1.14.x 実装向けガイドのまま残し、別タスクで
refresh する。
