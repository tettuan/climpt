# Agents ドキュメント

汎用 Agent ランタイムは「Active design (realistic) — 内部に継承源 (tobe) を
archive 包含」と「凍結された前世代 (legacy)」の 2 層に整理されている。tobe は
realistic に解消されたため独立 layer ではなく `realistic/tobe/` として nest
する。新規参照は **realistic** から始める。

## Active design (realistic) — 現在の設計

issue-close 経路の整合性を構造的に保証する system-level 再設計。7 MUST 凍結
(R1-R7) と 5 原則 (tobe 継承) を二本柱とする ADT-first 設計。`run-workflow` /
`run-agent` / `merge-pr` の 3 invocation mode が同じ Boot を共有し close 経路を
一致させる。

| ファイル                                                                                                   | 内容                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`design/realistic/00-index.md`](./design/realistic/00-index.md)                                           | TOC + 5 原則 + 7 MUST + 依存マップ + Anti-list + 設計の根本姿勢                               |
| [`design/realistic/01-requirements.md`](./design/realistic/01-requirements.md)                             | 7 MUST 凍結 (R1-R7) + To-Be 5 原則関係 + Anti-requirement                                     |
| [`design/realistic/10-system-overview.md`](./design/realistic/10-system-overview.md)                       | Boot/Run、5 入力、2 sub-driver、3 invocation mode                                             |
| [`design/realistic/11-invocation-modes.md`](./design/realistic/11-invocation-modes.md)                     | R5 close 経路整合の 5 段証明 (Boot 共有 → AR 不問 → subscribe 固定 → Transport 唯一 → 6 値閉) |
| [`design/realistic/12-workflow-config.md`](./design/realistic/12-workflow-config.md)                       | WorkflowConfig ADT、IssueSource 3 variant、IssueQueryTransport 独立 seam、W* Boot rule        |
| [`design/realistic/13-agent-config.md`](./design/realistic/13-agent-config.md)                             | AgentBundle ADT、FlowSpec / CompletionSpec disjoint kind、closeBinding、A* Boot rule          |
| [`design/realistic/14-step-registry.md`](./design/realistic/14-step-registry.md)                           | Step ADT、C3LAddress 5-tuple two-tier、SO + StructuredGate、Intent ADT、S* Boot rule          |
| [`design/realistic/15-dispatch-flow.md`](./design/realistic/15-dispatch-flow.md)                           | SubjectPicker 入力契約、phase versioning による sequential dispatch                           |
| [`design/realistic/16-flow-completion-loops.md`](./design/realistic/16-flow-completion-loops.md)           | FlowLoop / CompletionLoop 各 4 段、VerdictKind 8 variant、Run 時 error 3 分類                 |
| [`design/realistic/20-state-hierarchy.md`](./design/realistic/20-state-hierarchy.md)                       | 4-layer state model 拡張、Layer 4 を 5 入力で物理化                                           |
| [`design/realistic/30-event-flow.md`](./design/realistic/30-event-flow.md)                                 | 8 EventBus event 不変、publish source 精緻化、channel id 6 値閉                               |
| [`design/realistic/90-traceability.md`](./design/realistic/90-traceability.md)                             | 7 MUST × 設計要素 双方向 + Hard gate + 5 原則 × MUST 整合                                     |
| [`design/realistic/channels/00-realistic-binding.md`](./design/realistic/channels/00-realistic-binding.md) | 6 channel × kind 早見表、mode invariance 根拠、Decision 契約                                  |

### Inheritance source archive (`realistic/tobe/`) — 解消済み哲学的祖先

realistic に解消された To-Be 設計の一次資料。5 原則 (Uniform Channel / Single
Transport / CloseEventBus / Fail-fast Factory / Typed Outbox)、4-layer state
model、6 channel の到達点。**realistic から `./tobe/...` で参照される**。直接の
active design ではなく realistic の継承源 archive として nest。5 原則 / channel
詳細 / Result.Failed ADT 等の WHY を辿る際に開く。

| ファイル                                                                                                         | 内容                                            |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`design/realistic/tobe/00-index.md`](./design/realistic/tobe/00-index.md)                                       | TOC + 5 原則 + 3 軸 (責務 / 疎結合 / interface) |
| [`design/realistic/tobe/10-system-overview.md`](./design/realistic/tobe/10-system-overview.md)                   | システム全体図、component / Transport 列挙      |
| [`design/realistic/tobe/15-dispatch-flow.md`](./design/realistic/tobe/15-dispatch-flow.md)                       | TransitionRule pure、AgentTransport seam        |
| [`design/realistic/tobe/20-state-hierarchy.md`](./design/realistic/tobe/20-state-hierarchy.md)                   | 4 layer (External / Mirror / Decision / Policy) |
| [`design/realistic/tobe/30-event-flow.md`](./design/realistic/tobe/30-event-flow.md)                             | 8 event ADT、Result.Failed、OutboxAction        |
| [`design/realistic/tobe/channels/41-channel-D.md`](./design/realistic/tobe/channels/41-channel-D.md)             | DirectClose 詳細                                |
| [`design/realistic/tobe/channels/42-channel-C.md`](./design/realistic/tobe/channels/42-channel-C.md)             | OutboxClose 詳細 (Cpre / Cpost component)       |
| [`design/realistic/tobe/channels/43-channel-E.md`](./design/realistic/tobe/channels/43-channel-E.md)             | BoundaryClose 詳細                              |
| [`design/realistic/tobe/channels/44-channel-M.md`](./design/realistic/tobe/channels/44-channel-M.md)             | MergeClose 詳細 (subprocess、PR merge)          |
| [`design/realistic/tobe/channels/45-channel-cascade.md`](./design/realistic/tobe/channels/45-channel-cascade.md) | CascadeClose 詳細                               |
| [`design/realistic/tobe/channels/46-channel-U.md`](./design/realistic/tobe/channels/46-channel-U.md)             | CustomClose 詳細                                |
| [`design/realistic/tobe/QA.md`](./design/realistic/tobe/QA.md)                                                   | 想定 FAQ                                        |

## Frozen (legacy) — 前世代の参照のみ

v1.14.x まで `design/` 直下にあった汎用 Agent 設計文書 14 件の凍結 snapshot。
**新規参照不可**、修正禁止。realistic への前置換に伴い 2026-04-26 に移動。

- [`design-legacy/README.md`](./design-legacy/README.md) — frozen 宣言 + legacy
  → active への移植 mapping table
- 各 legacy file (`01_philosophy.md` 〜 `14_project_verification.md`) は history
  / motivation 参照用。設計判断の WHY を辿るときのみ開く。

## Builder ガイド (pending refresh)

`agents/docs/builder/` 配下は **v1.14.x 実装向け**
の状態のまま。realistic-charts の AgentBundle ADT が実装に landed
していないため、本 swap では未着手。実装 完了後に refresh
する別タスクで置き換える予定。Active design (realistic) と v1.14.x builder
ガイドの間には **scheme drift がある** 点に注意。

| ファイル                                                                           | 内容 (v1.14.x 前提)                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`builder/01_quickstart.md`](./builder/01_quickstart.md)                           | 具体的なディレクトリ構成と必須パラメータの手順         |
| [`builder/02_agent_definition.md`](./builder/02_agent_definition.md)               | `agent.json` のスキーマ詳細                            |
| [`builder/03_builder_guide.md`](./builder/03_builder_guide.md)                     | 設定 → 実行 → プロンプト連鎖を What/Why で俯瞰         |
| [`builder/04_config_system.md`](./builder/04_config_system.md)                     | デフォルト / ユーザー / CLI のマージ規則               |
| [`builder/05_troubleshooting.md`](./builder/05_troubleshooting.md)                 | よくある問題と解決方法                                 |
| [`builder/06_workflow_setup.md`](./builder/06_workflow_setup.md)                   | workflow.json の書き方                                 |
| [`builder/07_flow_design.md`](./builder/07_flow_design.md)                         | Flow step 設計の判断根拠 (intent / handoff / stepKind) |
| [`builder/08_github_integration.md`](./builder/08_github_integration.md)           | GitHub Issues/Projects との結線と label 運用           |
| [`builder/09_closure_output_contract.md`](./builder/09_closure_output_contract.md) | Closure step が返す output の契約と検証                |
| [`builder/10_archetypes.md`](./builder/10_archetypes.md)                           | `.agent/` 実例を 3 原型に分類                          |
| [`builder/reference/agent.yaml`](./builder/reference/agent.yaml)                   | agent.json 全 field YAML reference                     |
| [`builder/reference/steps_registry.yaml`](./builder/reference/steps_registry.yaml) | steps_registry.json 全 field YAML reference            |
| [`builder/reference/workflow.yaml`](./builder/reference/workflow.yaml)             | workflow.json field reference                          |

## 読む順 (推奨)

1. `design/realistic/00-index.md` — Active design の TOC と 7 MUST
2. `design/realistic/01-requirements.md` — 7 MUST の凍結条文
3. `design/realistic/10-system-overview.md` — Boot/Run と 3 mode
4. `design/realistic/11-invocation-modes.md` — close 経路整合の証明 (R5 hard
   gate)
5. 個別関心 (workflow / agent / step) に応じて 12 / 13 / 14 を開く
6. inheritance を辿りたいときに `design/realistic/tobe/` を開く
7. 史的 WHY を辿りたいときに `design-legacy/README.md` から該当 legacy file へ
