# channels/00 — Realistic Channel Binding (To-Be 41-46 を realistic 文脈で再 link)

To-Be `tobe/channels/41-46` の 6 channel doc は **不可侵で継承** する。本 doc
は各 channel に対し「Realistic 文脈で **どう trigger され、どこから decide
が呼ばれ、AgentBundle.closeBinding とどう結びつくか**」を 1 表で再 link
するだけの thin extension doc。

**Up:** [00-index](../00-index.md),
[10-system-overview](../10-system-overview.md) **Inherits (不可侵):**
[tobe/channels/41-channel-D](../tobe/channels/41-channel-D.md),
[42-channel-C](../tobe/channels/42-channel-C.md),
[43-channel-E](../tobe/channels/43-channel-E.md),
[44-channel-M](../tobe/channels/44-channel-M.md),
[45-channel-cascade](../tobe/channels/45-channel-cascade.md),
[46-channel-U](../tobe/channels/46-channel-U.md) **Refs:**
[11-invocation-modes §C/E](../11-invocation-modes.md),
[13-agent-config §F](../13-agent-config.md),
[16-flow-completion-loops §G](../16-flow-completion-loops.md),
[30-event-flow §C](../30-event-flow.md)

---

## A. 6 Channel × Realistic 経路 早見表

`closeBinding.primary` 列 = AgentBundle が **agent の primary close 経路**
として宣言する `CloseCondition.kind`。`Cpost` / `Cascade` は他 Channel の
publish に chain する **framework subscriber** で、agent declare に出ない (30
§C)。

| Channel (To-Be doc)                                                  |        declare on closeBinding.primary         | Subscribe (To-Be 30 §B 不可侵)                                                 | Realistic 経路で trigger される source                                                        |
| -------------------------------------------------------------------- | :--------------------------------------------: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **DirectClose (D)** [41](../tobe/channels/41-channel-D.md)           |                    `direct`                    | `TransitionComputed`                                                           | TransitionRule (FlowLoop または CompletionLoop の DispatchCompleted を受けて)                 |
| **OutboxClose-pre (C-pre)** [42](../tobe/channels/42-channel-C.md)   |                  `outboxPre`                   | `OutboxActionDecided` (filter `action.kind == PreClose`)                       | OutboxActionMapper (Closure step SO の handoffFields → CreateIssue / Comment)                 |
| **OutboxClose-post (C-post)** [42](../tobe/channels/42-channel-C.md) |        (framework — agent declare 不要)        | `OutboxActionDecided` (filter `action.kind == PostClose`) + `IssueClosedEvent` | 他 Channel の close 完了に chain する自動 subscriber                                          |
| **BoundaryClose (E)** [43](../tobe/channels/43-channel-E.md)         |                   `boundary`                   | `ClosureBoundaryReached`                                                       | **CompletionLoop のみ** (16 §C) — Closure step 内の verdict 後に publish                      |
| **MergeClose (M)** [44](../tobe/channels/44-channel-M.md)            |   (declare 不要 — merge-pr subprocess 専用)    | (publish のみ、subscribe 無し)                                                 | merge-pr CLI 起動 (11 §D)、結果は MergeCloseAdapter.refresh が IssueClosedEvent(M) を publish |
| **CascadeClose** [45](../tobe/channels/45-channel-cascade.md)        |        (framework — agent declare 不要)        | `IssueClosedEvent` ∧ `SiblingsAllClosedEvent`                                  | 他 Channel の IssueClosedEvent に chain。SiblingTracker (To-Be 45 §B service) が集計          |
| **CustomClose (U)** [46](../tobe/channels/46-channel-U.md)           | `custom` + `customChannel: ContractDescriptor` | `ClosureBoundaryReached` + ContractDescriptor.subscribesTo                     | CompletionLoop publish + Boot で injected 済 ContractDescriptor.decide                        |

> **読み方**: 1 行 = 1 channel。AgentBundle.closeBinding.primary が `kind` で
> declare できる値は **5 variant: `direct` / `boundary` / `outboxPre` / `custom`
> / `none`** (13 §F)。それぞれが対応する channel は D / E / C-pre / U / (close
> 経路なし、handoff のみ agent)。M は subprocess 専用で declare 対象外。**C-post
> / Cascade は framework subscriber** で AgentBundle で declare
> 不要。Channel.subscribesTo 自体は **全 mode・全 agent に対し固定** (P1 Uniform
> Channel)。

**IssueClosedEvent.channel id の閉じ性 (R5 hard gate)**: D / C / E / M / Cascade
/ U の **6 値** (To-Be 30 §F / 46 §F)。`C` は OutboxClose の単一 ChannelId
で、Cpre / Cpost は publisher component の区別 (subscribe filter は
`OutboxAction.kind` で行う) であり ChannelId は共通。

---

## B. mode invariance (R5 整合) の channel 別根拠

| Channel | run-workflow 経由  |   run-agent 経由   | mode 不変式                                                                  |
| ------- | :----------------: | :----------------: | ---------------------------------------------------------------------------- |
| D       |         ✓          |         ✓          | TransitionComputed payload に mode が乗らない (To-Be 15 §D)                  |
| C-pre   |         ✓          |         ✓          | OutboxActionDecided payload (action.kind=PreClose filter) に mode が乗らない |
| C-post  |         ✓          |         ✓          | IssueClosedEvent.channel id ∈ 6 値で閉 (30 §E、ChannelId="C")                |
| E       |         ✓          |         ✓          | ClosureBoundaryReached は CompletionLoop のみ (16 §C) — mode 不問            |
| Cascade |         ✓          |      ✓ (rare)      | SiblingsAllClosedEvent.binding に mode が乗らない                            |
| U       | ✓ (declare あれば) | ✓ (declare あれば) | ContractDescriptor は Boot frozen で mode 非依存                             |
| M       |         —          |         —          | merge-pr subprocess 専用 (11 §D) — mode 比較対象外                           |

**Why**: R5 hard gate は「mode が channel の Decision
に影響しない」ことで成立する (11 §C 5 段証明)。本表は 6 channel 各々について
**その不変式の根拠 event** を 1 行で示す再確認。Realistic で channel の Decision
logic を mode 由来の分岐で書き換える経路は構造的に存在しない。

---

## C. Channel Decision の mode 共通契約

各 Channel の `decide(ctx) → Decision` 契約は To-Be channel doc で全文定義済 (41
§A〜§F / 42 §A〜§F / 43 §A〜§F / 44 §A〜§F / 45 §A〜§F / 46 §A〜§G)。Realistic
で
**追加変更なし**。`Decision = ShouldClose(IssueRef, ChannelId) | Skip(SkipReason)`
の値域 (To-Be 20 §D) は AgentBundle.closeBinding のどの kind 経由でも同一。

**特に重要な不変式**:

- **DirectClose**: `closeOnComplete=true` ∧ `terminal phase` ∧ guard pass で
  `ShouldClose(D)`。run-workflow / run-agent 共通 (To-Be 41 §A 継承)。
- **BoundaryClose**: ClosureBoundaryReached の SO 内 verdict が
  `closeOnComplete=true` 整合なら `ShouldClose(E)`。CompletionLoop
  の出力に依存し mode 非依存。
- **CustomClose**: ContractDescriptor.decide が pure function (副作用禁止、46
  §A) で、Realistic 文脈でも user code は AgentBundle 経由でのみ inject される
  (13 §F)。

**Why**: Channel.decide が pure function (副作用禁止、To-Be P1)
として定義されているため、mode / WorkflowConfig / AgentBundle
のいずれが変わっても同 ctx で同 Decision が返る (referential transparency)。R5
整合の論理的根拠。

---

## D. To-Be channel doc 群との差分まとめ

- **追加**: AgentBundle.closeBinding.kind と To-Be channel の対応 mapping
  (§A)、mode invariance の channel 別根拠 (§B)、Decision 契約の Realistic
  文脈での再確認 (§C)。
- **不変**: To-Be 41 §A〜§F / 42 §A〜§F / 43 §A〜§F / 44 §A〜§F / 45 §A〜§F / 46
  §A〜§G の **全文**。Channel ADT / decide / execute / Transport 経路 /
  Compensation すべて改変なし。
- **禁止維持**: Channel が AgentBundle / WorkflowConfig / mode を読む (P1 + R5
  違反) / channel id 7 値の増設 (10 §F + 30 §E) / Channel から gh CLI 直叩き
  (P2) / mode による Channel 有効化分岐 (11 §E)。

---

## E. 1 行サマリ

> **「To-Be 6 channel doc は 1 字も変えない。Realistic は
> AgentBundle.closeBinding.kind 経由で『どの channel が agent ごとに active
> か』を Boot で declare するだけ。Channel ADT は agent / mode / WorkflowConfig
> を読まず、decide 契約の pure 性で R5 整合を保つ。」**

- §A 6 channel × kind × subscribe の 1 表
- §B mode invariance の channel 別根拠 (R5 構造証明)
- §C Channel Decision 契約の不変
- §D 差分 (追加: 3 / 不変: 6 doc 全文 / 禁止維持: 4 違反)
