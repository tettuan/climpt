# 20 — State Hierarchy (Realistic 拡張: Layer 4 を 5 input で物理化)

To-Be `20-state-hierarchy.md` の **4 層モデル (Layer 1 External / Layer 2 Mirror
/ Layer 3 Decision / Layer 4 Policy)** と「1 writer / N
readers」の所有関係、Persistent vs Volatile のライフサイクル区分は
**不可侵で継承** し、Realistic で導入された 5 個の Boot input (WorkflowConfig /
AgentBundle list / StepRegistry / SO Schemas / IssueQueryTransport) を Layer 4
にどう位置付けるかだけを追記する。

**Up:** [00-index](./00-index.md), [10-system-overview](./10-system-overview.md)
**Inherits (不可侵):**
[tobe/20-state-hierarchy §A〜§E](./tobe/20-state-hierarchy.md) — 4 層モデル /
責務 / 単一 writer / MergeCloseAdapter / 値域 ADT / persistence **Refs:**
[12-workflow-config](./12-workflow-config.md),
[13-agent-config](./13-agent-config.md),
[14-step-registry](./14-step-registry.md),
[16-flow-completion-loops](./16-flow-completion-loops.md)

---

## A. 拡張範囲

To-Be 20 §A 4 層図 / §B 1 writer / N readers / §C MergeCloseAdapter / §D 値域
ADT / §E Persistence は **そのまま継承** し、本章では
**再記述しない**。Realistic で追加されるのは **Layer 4 (Policy + Transport)
の物理化** と、Step / Phase / SubjectRef / IssueRef / Verdict の **層配置**
を確定することだけ。Layer 1 / Layer 2 / Layer 3 の責務と書込権限は To-Be
のまま不変。

**Why**: To-Be 4 層分離は close 経路の整合 (R5) と疎結合 (P3)
の構造基盤。Realistic 拡張は Boot 入力増だけで 4 層モデル自体を変えない。Layer 4
だけが Realistic 入力を吸収する場所として選ばれているのは、**Run 中 immutable**
の保証 (§E 継承) が R6 (verifiable / controllable) の前提となるため。

---

## B. Layer 4 (Policy + Transport) の Realistic 構成

```mermaid
stateDiagram-v2
    direction TB

    state "Layer 4 — Policy + Transport (Boot frozen, Run immutable)" as L4 {
        state "To-Be 既存 (不可侵)" as Inh {
            T_Pol  : Policy { storeWired, ghBinary, applyToSubprocess }
            T_CTx  : CloseTransport ∈ {Real, File}
            T_ATx  : AgentTransport ∈ {Real, Mock, Replay}
        }
        state "Realistic 追加 (本章で凍結)" as Add {
            R_W   : WorkflowConfig (12 §B)
            R_A   : AgentBundle list + AgentRegistry (13 §B + §H)
            R_S   : StepRegistry per agent (14 §A)
            R_So  : SO Schemas (.agent/<id>/schemas/*.schema.json) (14 §D)
            R_IQT : IssueQueryTransport ∈ {Real, Mock, File} (12 §C)
        }
    }

    L4 --> Frozen[Boot completion で凍結 → Run 中は読取専用]
    Frozen --> Sub[subprocess (merge-pr) も同 Layer 4 を継承]

    classDef inh fill:#e8f0ff,stroke:#3366cc;
    classDef add fill:#fff0d0,stroke:#cc8833;
    class Inh inh
    class Add add
```

**5 個の Realistic 入力の Layer 4 配置理由**:

| input               | Layer 4 配置の根拠                                                            |
| ------------------- | ----------------------------------------------------------------------------- |
| WorkflowConfig      | Run 中に reload しない → immutable (12 §G anti-list)                          |
| AgentBundle list    | AgentRegistry が Boot frozen lookup table を持つ (13 §A)                      |
| StepRegistry        | step graph の動的変更禁止 (14 §I anti-list)                                   |
| SO Schemas          | Boot V5 で全 schema 解決を validate 済 (13 §G / 14 §G)                        |
| IssueQueryTransport | gh listing seam が Run 中 swap しないことが R5 mode invariance の前提 (12 §C) |

**Why**: Realistic 5 入力すべてが Layer 4 に置かれるのは「Run 中 reconfig
しない」という共通性質 (To-Be 20 §E 継承) を持つため。これが R6 (verifiable) の
**構造的根拠** であり、validation を Boot 1 回に集中できる (To-Be P4 Fail-fast
Factory)。

---

## C. 各層に居る ADT の対応表

| Layer           | 値域 (To-Be 既存)                                                                         | 値域 (Realistic 追加)                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1 External** | `IssueState ∈ {Open, Closed}` / `PRState ∈ {Open, Merged, Closed}`                        | (追加なし — server-owned のまま)                                                                                                                               |
| **L2 Mirror**   | `OutboxAction ∈ {PreClose, PostClose, Comment, CreateIssue, ...}` (To-Be 20 §D)           | `OutboxAction.kind` に handoff 由来 (12 §D `handoffTemplate`) の `Comment(template, fields)` / `CreateIssue(parent, body)` を継承利用。**新 variant 追加なし** |
| **L3 Decision** | `Decision ∈ {ShouldClose, Skip}` / `Result ∈ {Done, Failed}` / `SkipReason` (To-Be 20 §D) | `Verdict` (16 §D, 8 variant) — Completion loop が closure step 内で生成 / `Outcome` (To-Be 15 §D, Realistic では Pass / Fail / Defer に明示)                   |
| **L4 Policy**   | Policy / CloseTransport / AgentTransport (To-Be 20 §D)                                    | WorkflowConfig / AgentBundle list / StepRegistry / SO Schemas / IssueQueryTransport (本章 §B)                                                                  |

**Verdict は Layer 3 (Decision)**:

- Verdict は **cycle 寿命** (To-Be 20 §E 継承) で、CompletionLoop が closure
  step 内で生成し、その cycle 内に Channel が消費する (BoundaryClose /
  DirectClose の入力)。
- Verdict 自体が close を起こすのではない (Channel が Decision ADT
  に変換)。これにより Layer 3 内に閉じる (16 §D)。

**Why**: Realistic で増えた値域は **Verdict だけ** で、これも Layer 3 の cycle
寿命に閉じる。Layer 1 / Layer 2 の値域は不変 (close 経路を mode
で割らないため)。R5 整合の状態側根拠。

---

## D. SubjectRef / IssueRef / Step / Phase / Verdict の層配置

| identity / value                                     | 層配置                                                                                                                               | 寿命                                          | 由来                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------ |
| `SubjectRef` (12 §E)                                 | **Layer 3 / Layer 2 hybrid** — dispatch 文脈 identity (cycle 内で AgentRuntime 入力)、ただし `handoffPayload` は Layer 2 Outbox 由来 | cycle (主) / Outbox 持ち越し時は Layer 2 持続 | SubjectPicker が Layer 4 (WorkflowConfig + IssueQueryTransport) から構築 |
| `IssueRef`                                           | **Layer 1 primary key** — Layer 2 mirror の lookup key としても流用                                                                  | persistent (Layer 1 server-owned)             | gh issue number / repo (immutable identity)                              |
| `StepId` / `PhaseId`                                 | **Layer 4 declarative reference** — registry frozen                                                                                  | process 寿命 (Layer 4)                        | StepRegistry / WorkflowConfig 内 string                                  |
| `AgentId`                                            | **Layer 4 declarative reference**                                                                                                    | process 寿命 (Layer 4)                        | AgentRegistry の key (13 §B)                                             |
| `Verdict`                                            | **Layer 3** — Completion loop が cycle 内で生成                                                                                      | cycle (volatile)                              | 16 §D ADT                                                                |
| `Outcome` (Pass/Fail/Defer)                          | **Layer 3** — TransitionRule 入力                                                                                                    | cycle (volatile)                              | DispatchCompleted の payload (To-Be 15 §D)                               |
| `Intent` (next/repeat/handoff/closing/jump/escalate) | **Layer 3** — FlowLoop が SO から抽出                                                                                                | cycle (volatile)                              | StructuredGate の intentField (14 §D / 16 §F)                            |

> **境界の核**: `SubjectRef` は **dispatch 文脈** の identity、`IssueRef` は
> **close 文脈** の identity。To-Be 用語境界 (`_meta/tobe-inventory §横断`) を
> Realistic でも保持。`SubjectRef.issue: IssueRef` という **包含関係**
> で表現し、両者を string 化で混同させない (12 §E 既述)。

**Why**: Step / Phase / Agent の id は **Layer 4 で凍結** されるため、Run
中に新規 stepId が生成されることは無い (R6 / 14 §G V8)。Verdict と Intent は
cycle 内で消える Layer 3 値で、event payload にしか乗らない (Layer 4 / Layer 2
に書き戻されない)。これが「Run state は次 cycle に持ち越せない」原則 (To-Be 20
§E) の Realistic での再確認。

---

## E. Layer 4 immutable と subprocess 継承

To-Be 20 §E の核 — 「Layer 4 は process 寿命中 immutable、subprocess も同 Layer
4 を継承」 — は Realistic でも **完全に維持** される。具体的には:

- `merge-pr` subprocess (To-Be 44) は親 process の Layer 4 (Policy /
  CloseTransport / AgentTransport / IssueQueryTransport / WorkflowConfig /
  AgentBundle / StepRegistry) を **起動引数 / env 経由で継承** する。subprocess
  内で再 load / 再 validate しない (Boot は親で 1 回だけ)。
- `workflow.json` の Run 中 reload は **構造的に禁止** (12 §G)。
  `--reload-config` 等の flag は Realistic に存在しない。
- AgentBundle の hot-swap は禁止 (13 §I)。
- StepRegistry の動的 step 追加は禁止 (14 §I)。
- `failurePatterns` の Boot 後追加は禁止 (14 §I)。
- IssueQueryTransport の Run 中 swap は禁止 (mode invariance 違反、R5 §C)。

**Why**: 「Run 中の動的 reconfig 禁止」は **R5 (close 経路整合) と R6
(verifiable) の同時前提**。reconfig を許すと、ある cycle で close が走る前後で
Layer 4 が変わり、Channel.subscribesTo / Decision logic / Transport
副作用の整合が崩れる。Boot で 1 回 validate して凍結する設計が、両 R
を構造的に保証する唯一の方法。

---

## F. To-Be 20 との差分まとめ

- **追加**: Layer 4 を Realistic 5 入力 (WorkflowConfig / AgentBundle /
  StepRegistry / SO Schemas / IssueQueryTransport) で物理化 (§B)。Verdict を
  Layer 3 値域に追加 (§C)。
- **不変**: 4 層モデル / 1 writer / N readers / MergeCloseAdapter / Layer 1 /
  Layer 2 値域 / Persistence / subprocess 継承 (To-Be 20 §A〜§E)。
- **禁止維持**: Run 中の Layer 4 reconfig / Layer 1 を Mirror から close する /
  Layer 3 Decision を別 channel が読む。

---

## G. 1 行サマリ

> **「Realistic 20 は To-Be 4 層モデルを不可侵で継承し、Layer 4 を 5 個の Boot
> 入力で物理化する。Verdict だけが Layer 3 に新規追加され、それも cycle
> 寿命に閉じる。Layer 1 / Layer 2 / Persistence / subprocess
> 継承は全て不変。」**

- Layer 4 物理化 → §B 5 入力すべてが Run immutable (R6 構造的根拠)
- Verdict 配置 → §C Layer 3 cycle 寿命 (close は Channel が Decision に変換、16
  §D)
- 用語境界 → §D SubjectRef vs IssueRef は **包含関係** (To-Be 用語境界 継承)
- subprocess 継承 → §E Layer 4 全体が起動引数で渡る (R5 mode invariance
  の状態側根拠)
