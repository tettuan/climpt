# 90 — Requirements Traceability (7 MUST × 設計要素 × 出典)

7 MUST 要件 (R1〜R6) が `realistic-charts/` の **どの file §section**
で物理化されているかを双方向にマッピングする。Done Criteria の hard gate
であり、未充足要件の検出 / 設計レビュー時の網羅確認に使う。

**Up:** [00-index](./00-index.md), [01-requirements](./01-requirements.md)
**Refs:** all docs in `realistic-charts/`

---

## A. 7 MUST × 設計要素 マトリクス

| ID      | 要件 (確定文 01 §B)                                                 | 主担当 file §section                                     | 補助 file §section                                                                                                                                                                                                                                                                                                          | 検証点 (01 §E より)                                                                                                            |
| ------- | ------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **R1**  | workflow.json + gh project / gh repo issues 一覧取得                | [12 §C IssueSource ADT](./12-workflow-config.md)         | [12 §B WorkflowConfig](./12-workflow-config.md), [12 §E SubjectPicker pipeline](./12-workflow-config.md), [15 §B 入力契約](./15-dispatch-flow.md)                                                                                                                                                                           | `IssueSource ADT` に `GhProject` + `GhRepoIssues` 2 variant 含                                                                 |
| **R2a** | orchestrator から複数 agent 呼び出し (異種 / 同 agent 異タイミング) | [12 §D AgentInvocation](./12-workflow-config.md)         | [15 §C multi-agent dispatch](./15-dispatch-flow.md), [13 §H mode 利用差](./13-agent-config.md)                                                                                                                                                                                                                              | `AgentInvocation list` で multi-agent 表現                                                                                     |
| **R2b** | agent 単独起動                                                      | [11 §B run-agent mode](./11-invocation-modes.md)         | [15 §E run-agent SubjectQueue](./15-dispatch-flow.md), [13 §E ParamSpec](./13-agent-config.md)                                                                                                                                                                                                                              | SubjectPicker を **同 instance で経由しつつ** input source を argv に切替える path (= bypass ではなく input 切替、B(R2)6 修復) |
| **R3**  | 1 agent は steps を定義                                             | [13 §B AgentBundle.steps](./13-agent-config.md)          | [14 §B Step ADT](./14-step-registry.md), [14 §E TransitionTable](./14-step-registry.md)                                                                                                                                                                                                                                     | AgentDefinition が `steps: StepList` field、Step ADT が定義                                                                    |
| **R4**  | dual loop (Flow + Completion) + C3L + Structured Output 哲学        | [16 §A AgentRuntime 内部](./16-flow-completion-loops.md) | [13 §D FlowSpec/CompletionSpec](./13-agent-config.md), [14 §B Step kind](./14-step-registry.md), [14 §C C3LAddress](./14-step-registry.md), [14 §D SO + StructuredGate](./14-step-registry.md), [16 §E C3L resolver](./16-flow-completion-loops.md), [16 §F SO single hinge](./16-flow-completion-loops.md)                 | Flow loop / Completion loop の 2 sub-loop が示され、Step が両方の hook                                                         |
| **R5**  | orchestrator-startup と agent-standalone で close 経路一致          | [11 §C close path uniform 図](./11-invocation-modes.md)  | [10 §E 3 mode shared Boot](./10-system-overview.md), [11 §E reachability matrix](./11-invocation-modes.md), [13 §H AgentBundle mode invariance](./13-agent-config.md), [30 §E channel id 閉じ性](./30-event-flow.md), [channels/00 §B mode invariance](./channels/00-realistic-binding.md)                                  | 全 mode が同一 Channel + Transport + Bus を共有する証明図                                                                      |
| **R6**  | agent config の自明 / 制御 / 命名 / 依存 / 検証可能                 | [13 §G A1〜A8](./13-agent-config.md)                     | [12 §F W1〜W10](./12-workflow-config.md), [14 §G S1〜S8](./14-step-registry.md), [10 §B 5 input](./10-system-overview.md), [13 §A 1 bundle 1 概念](./13-agent-config.md), [14 §H 用語 re-anchoring](./14-step-registry.md), [13 §I anti-list](./13-agent-config.md), [12 §D2 prioritizer pre-pass](./12-workflow-config.md) | Boot 時 schema validation Decision (Accept / Reject)                                                                           |

---

## B. 逆引き — file §section から MUST へ

| file                               | §section                      | 該当 MUST         | 役割                                                                                                    |
| ---------------------------------- | ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `01-requirements.md`               | §A〜§F                        | R1〜R6 全         | 要件凍結                                                                                                |
| `10-system-overview.md`            | §A 全体図                     | R1, R3, R4, R6    | Boot 入力 + sub-driver                                                                                  |
| `10-system-overview.md`            | §B 5 input                    | R1, R3, R4, R6    | 5 input の Layer 4 配置                                                                                 |
| `10-system-overview.md`            | §E 3 mode                     | R2a, R2b, R5      | mode 共有 Boot                                                                                          |
| `11-invocation-modes.md`           | §A run-workflow               | R1, R2a           | orchestrator 起動                                                                                       |
| `11-invocation-modes.md`           | §B run-agent                  | R2b               | standalone 起動                                                                                         |
| `11-invocation-modes.md`           | §C close path uniform         | **R5 hard gate**  | 5 段証明                                                                                                |
| `11-invocation-modes.md`           | §E reachability matrix        | R5                | mode × channel 二値                                                                                     |
| `12-workflow-config.md`            | §B WorkflowConfig root        | R1, R6            | root ADT                                                                                                |
| `12-workflow-config.md`            | §C IssueSource ADT            | **R1 hard gate**  | gh project / gh issues                                                                                  |
| `12-workflow-config.md`            | §D AgentInvocation            | **R2a hard gate** | multi-agent                                                                                             |
| `12-workflow-config.md`            | §D2 PrioritizerDecl           | R1, R6            | pre-pass dispatch (B9 修復)                                                                             |
| `12-workflow-config.md`            | §F W1〜W11 (11 rule)          | R6                | Boot Fail-fast (W10 = Transport pair, B6 修復 / W11 = invocation phase-agent unique, B(R2)2 修復)       |
| `13-agent-config.md`               | §B AgentBundle root           | R3, R6            | 1 bundle 1 概念、field 名 `role` (B2 修復)                                                              |
| `13-agent-config.md`               | §D FlowSpec/CompletionSpec    | **R4 hard gate**  | dual loop spec                                                                                          |
| `13-agent-config.md`               | §F CloseBinding ADT (primary) | R5, R6            | Channel binding (1 primary kind, framework subscribers 自動, B12 修復)                                  |
| `13-agent-config.md`               | §G A1〜A8                     | **R6 hard gate**  | Boot Fail-fast (A8 = polling read-only, B8 修復)                                                        |
| `13-agent-config.md`               | §H mode 利用差                | R5                | bundle invariance                                                                                       |
| `14-step-registry.md`              | §B Step ADT                   | **R3 hard gate**  | Step kind / address / SO                                                                                |
| `14-step-registry.md`              | §C C3LAddress                 | R4                | address before content                                                                                  |
| `14-step-registry.md`              | §D SO + StructuredGate        | R4                | SO single hinge                                                                                         |
| `14-step-registry.md`              | §E TransitionTable            | R3                | intent routing                                                                                          |
| `14-step-registry.md`              | §G S1〜S8                     | R6                | Boot Fail-fast (S4 = schema 内容 valid、A5 と責任分界)                                                  |
| `14-step-registry.md`              | §H 用語 re-anchoring          | R6                | 命名明瞭                                                                                                |
| `15-dispatch-flow.md`              | §B 入力契約                   | R1                | SubjectPicker input                                                                                     |
| `15-dispatch-flow.md`              | §C multi-agent dispatch       | R2a               | fanout                                                                                                  |
| `15-dispatch-flow.md`              | §E run-agent SubjectQueue     | R2b               | argv lift                                                                                               |
| `16-flow-completion-loops.md`      | §A AgentRuntime 内部          | **R4 hard gate**  | sub-driver                                                                                              |
| `16-flow-completion-loops.md`      | §B FlowLoop                   | R4                | work / verification                                                                                     |
| `16-flow-completion-loops.md`      | §C CompletionLoop             | R4                | closure + verdict                                                                                       |
| `16-flow-completion-loops.md`      | §E C3L resolver               | R4                | two-tier                                                                                                |
| `16-flow-completion-loops.md`      | §F SO single hinge            | R4                | declarative gate                                                                                        |
| `20-state-hierarchy.md`            | §B Layer 4 構成               | R6                | 5 入力 frozen                                                                                           |
| `20-state-hierarchy.md`            | §E immutable + subprocess     | R5, R6            | Run 中 reconfig 禁止                                                                                    |
| `30-event-flow.md`                 | §B publish source 精緻化      | R4                | Flow/Completion source                                                                                  |
| `30-event-flow.md`                 | §C subscriber binding         | R5, R6            | AgentBundle.closeBinding                                                                                |
| `30-event-flow.md`                 | §E channel id 閉じ性 (6 値)   | **R5 hard gate**  | event 側根拠 (D / C / E / M / Cascade / U; ChannelId "C" は OutboxClose 単一値、B(R2)5 regression 修復) |
| `channels/00-realistic-binding.md` | §A 6 channel × kind           | R5                | trigger 経路                                                                                            |
| `channels/00-realistic-binding.md` | §B mode invariance            | R5                | channel 別根拠                                                                                          |

---

## C. Hard gate 早見表 (各 R に対する **これが無いと違反** な §)

| ID  | Hard gate (この §section が無い / 矛盾すれば設計 reject)                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `12 §C IssueSource ADT` の `GhProject` + `GhRepoIssues` 2 variant                                                                                                                                                                                                                             |
| R2a | `12 §D AgentInvocation` を **list (`[]`)** で表現                                                                                                                                                                                                                                             |
| R2b | `11 §B run-agent` の SubjectPicker 経由 + argv lift path (= input source 切替、B(R2)6 修復)                                                                                                                                                                                                   |
| R3  | `13 §B AgentBundle.steps: StepList` + `14 §B Step ADT`                                                                                                                                                                                                                                        |
| R4  | `16 §A AgentRuntime 内部` の Flow/Completion 2 sub-driver + `14 §B step.kind ∈ Closure` boundary                                                                                                                                                                                              |
| R5  | `11 §C close path uniform` の 5 段証明 + `30 §E channel id 6 値閉じ性 (D / C / E / M / Cascade / U; ChannelId "C" は OutboxClose 単一値、Cpre/Cpost component の区別は subscribe filter`OutboxAction.kind`)` + `13 §H mode 利用差` の 4 row 同 (steps / closeBinding / terminalRule / AR以降) |
| R6  | `13 §G A1〜A8` + `12 §F W1〜W11` + `14 §G S1〜S8` の **3 file 計 27 rule** (file-prefix 付き、責任分界済、B7 修復) + `12 §D2 prioritizer pre-pass` で declarative dispatch 経路 (B9 修復)                                                                                                     |

> R5 / R6 は **複数 §** に分かれた hard gate を持つ。1 file
> の単独充足では足りず、複数 file の §section
> が同時に成立して初めて構造が閉じる。

---

## D. To-Be 5 原則 × Realistic MUST の整合 (anti-violation 表)

| To-Be 原則               | Realistic で破らないことを保証する MUST / §section                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 Uniform Channel**   | R5 (11 §C 5 段証明), channels/00 §C decide pure 性                                                                                                              |
| **P2 Single Transport**  | R5 + 12 §C `IssueQueryTransport` を CloseTransport から **独立 seam** で分離 (= P2 を読取で破らない) + 12 §F W10 で Transport pair 整合 Boot validate (B6 修復) |
| **P3 CloseEventBus**     | R2 (15 §C) + 30 §D handoff 連鎖 (agent 間直接呼出禁止)                                                                                                          |
| **P4 Fail-fast Factory** | R6 (12 §F + 13 §G + 14 §G の計 25 rule)                                                                                                                         |
| **P5 Typed Outbox**      | R6 + 14 §D SO single hinge (silent default 禁止) + 13 §I anti-list (inline schema 禁止)                                                                         |

---

## E. Done Criteria セルフチェック (plan.md より)

| 項目                                                       | 充足 file §section                                   |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| 7 MUST すべて 90 で双方向リンク                            | §A + §B                                              |
| `00-index.md` が TOC + 5 原則 + 7 MUST + 依存マップ        | [00-index](./00-index.md)                            |
| `01-requirements.md` が 7 MUST 凍結                        | [01](./01-requirements.md) §A〜§F                    |
| `10-system-overview.md` が 3 invocation mode と Boot 共有  | [10](./10-system-overview.md) §A + §E                |
| `11-invocation-modes.md` が close 経路整合証明             | [11](./11-invocation-modes.md) §C 5 段証明           |
| `12-workflow-config.md` が IssueSource ADT を ADT で定義   | [12](./12-workflow-config.md) §C                     |
| `13-agent-config.md` が AgentBundle ADT を定義             | [13](./13-agent-config.md) §B                        |
| `14-step-registry.md` が Step ADT を定義                   | [14](./14-step-registry.md) §B                       |
| `16-flow-completion-loops.md` が Flow / Completion 境界    | [16](./16-flow-completion-loops.md) §A〜§D           |
| `15-dispatch-flow.md` (拡張) で IssueQuery 追加            | [15](./15-dispatch-flow.md) §B                       |
| `20-state-hierarchy.md` (拡張) で step registry を Layer 4 | [20](./20-state-hierarchy.md) §B + §D                |
| `30-event-flow.md` (拡張) で Flow / Completion event       | [30](./30-event-flow.md) §B                          |
| `channels/41-46` が realistic 文脈で再 link                | [channels/00](./channels/00-realistic-binding.md) §A |
| `90-traceability.md` の MUST × 設計要素 全埋め             | 本 doc §A + §B                                       |

---

## F. 1 行サマリ

> **「7 MUST × 設計要素マトリクスは §A で埋め、逆引きは §B、hard gate は
> §C、To-Be 5 原則整合は §D、Done Criteria セルフチェックは §E。本 doc が 1 つの
> hard gate を満たさなかった時点で設計は reject。」**
