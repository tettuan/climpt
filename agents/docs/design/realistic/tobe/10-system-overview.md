# 10 — System Overview (Uniform Channel shape)

To-Be では **6 channel が同じ shape** を持つ。Boot で Policy / Transport
を一度凍結し、Run では channel が `decide → execute(Transport)` だけを行う。

**Up:** [00-index](./00-index.md) **Down:** [41-D](./channels/41-channel-D.md),
[42-C](./channels/42-channel-C.md), [43-E](./channels/43-channel-E.md),
[44-M](./channels/44-channel-M.md),
[45-cascade](./channels/45-channel-cascade.md),
[46-U](./channels/46-channel-U.md) **Refs:**
[20-state-hierarchy](./20-state-hierarchy.md),
[30-event-flow](./30-event-flow.md)

---

## A. Uniform Channel interface

```mermaid
stateDiagram-v2
    direction LR

    state "CloseChannel<C>" as Iface {
        Decide : decide(ctx: C) → Decision
        Execute : execute(d, t: Transport) → Result
        Subscribe : subscribesTo(EventType[])?
    }

    state "Decision (ADT)" as DAdt {
        ShouldClose : { kind: \"ShouldClose\", target: IssueRef, reason: ChannelId }
        Skip        : { kind: \"Skip\", reason: SkipReason }
    }

    state "Result (ADT)" as RAdt {
        Done   : { kind: \"Done\", target: IssueRef, via: ChannelId }
        Failed : { kind: \"Failed\", error: TransportError }
    }

    Iface --> DAdt : decide returns
    DAdt --> RAdt  : execute returns
```

**Why**: As-Is の guard 連鎖は channel ごとに散在 (W8) し、`closure_action` が
hard-default で `"close"` に倒れる (W3) など silent fallback
が混ざっていた。To-Be では各 channel が **明示的に** `Decision` ADT
を返し、`Skip` の場合も理由を持つ。silent な分岐は許さない。

---

## B. Boot vs Run の責務分離

```mermaid
stateDiagram-v2
    direction TB
    [*] --> Boot

    state Boot {
        [*] --> LoadConfig
        LoadConfig --> ValidateConfig
        ValidateConfig --> RejectInvalid : config 不整合
        ValidateConfig --> SelectTransport
        SelectTransport --> SelectPolicy
        SelectPolicy --> ConstructChannels

        state ConstructChannels {
            [*] --> ForEachChannel
            ForEachChannel --> Channel_D
            ForEachChannel --> Channel_C
            ForEachChannel --> Channel_E
            ForEachChannel --> Channel_M
            ForEachChannel --> Channel_CascadeClose
            ForEachChannel --> Channel_U_Maybe
        }

        ConstructChannels --> Frozen : Boot 完了
        RejectInvalid --> [*]
    }

    Boot --> Run

    state Run {
        [*] --> CycleLoop
        CycleLoop --> Channel_decide  : 各 channel
        Channel_decide --> Channel_execute : Decision=ShouldClose
        Channel_decide --> Channel_skipped : Decision=Skip
        Channel_execute --> EmitEvent : Result=Done
        Channel_execute --> EmitFail   : Result=Failed
        EmitEvent --> CycleLoop
        EmitFail --> CycleLoop
        Channel_skipped --> CycleLoop
    }

    Run --> [*]
```

**Why**:

- Boot で **invalid config を拒否** することで W1 (factory が enabled=false でも
  adapter 構築) を排除。silent fallback の余地が消える。
- Boot で Transport を 1 つに確定することで W2 (V2 が gh 直叩き) を排除。Run
  中に transport 切替不可。
- `Channel_U_Maybe` は user が contract を declare した場合のみ Frozen に入る
  (W7 の修復)。

---

## C. Transport 単一化 (副作用 switch を 1 enum に集約)

```mermaid
stateDiagram-v2
    direction LR
    [*] --> SelectTransport

    state SelectTransport {
        [*] --> ReadConfigKey
        ReadConfigKey --> Real : transport=\"real\"
        ReadConfigKey --> File : transport=\"file\"
        ReadConfigKey --> RejectMissing : key 欠落 (silent default 禁止)
    }

    SelectTransport --> Frozen
    RejectMissing --> [*]

    state Frozen {
        Real_Trans : Real → gh CLI / GitHub API (production)
        File_Trans : File → Layer 2 mirror のみ書く (test / verification)
    }

    note right of Frozen
        全 channel (D / C / E / Cascade / U) が
        この 1 つの Transport を共有する。
        MergeClose だけは GitHub server を
        executor とするため Transport を持たない
        (代わりに Transport=Real を gate に読む。44 §B)。
    end note
```

**Why**:

- W2 (V2 が GitHubClient bypass で gh 直叩き) を直す。BoundaryClose も同じ
  Transport を経由する。
- W11 (github.enabled flag が 2 役) を直す。flag を **transport 選択**
  という単一 enum に置き換え、kill switch との混同を断つ。
- W10 (S0.1/S1.1 conflation) を直す。File Transport は明示的に「Layer 2 mirror
  only」と契約する。
- **W6 (dryRun 二重 flag) も同時に消滅**。Run 時の dryRun flag を持たず、Boot
  時の Transport 選択 1 つで「副作用の有無」を決める。「dryRun したい」=
  `Transport=File` を選べば、cascade event 流路まで完走する **より強いテスト**
  になる。

---

## D. Policy (Boot で凍結する 3 値)

```mermaid
stateDiagram-v2
    direction LR

    state "Policy (Boot で凍結)" as Pol {
        Store  : storeWired: bool
        Gh     : ghBinary: \"present\" | \"absent\"
        SubProc : applyToSubprocess: bool (= true)
    }

    Pol --> Channel_D
    Pol --> Channel_C
    Pol --> Channel_E
    Pol --> Channel_M
    Pol --> Channel_CascadeClose
    Pol --> Channel_U

    note right of Pol
        Policy は \"環境前提\" のみ持つ
        (副作用の有無は §C Transport 側に集約)。
        全 process が同一 Policy を継承し、
        subprocess (merge-pr) も同じ前提で走る。
    end note
```

**Why**:

- W9 (gh binary 不在 silent no-op) を直す。`ghBinary: "absent"` ∧
  `Transport=Real` を Boot で検出したら Reject。Run 中の silent failure
  を起こさない。
- Policy は **環境前提** (gh 存在 / store 配線) のみを保持し、**何をするか** は
  Transport / Channel ADT に閉じる。「環境前提」と「副作用方針」の責務分離。

---

## E. Components (god object 排除)

To-Be は **process 単位ではなく component 単位** で責務を捉える。As-Is
`Orchestrator.cycle()` が抱えていた scheduling / dispatch / transition / close
を独立 component に分け、event のみで連携する。

```mermaid
stateDiagram-v2
    direction TB
    [*] --> Boot

    state Boot {
        BootKernel : Policy + CloseTransport + AgentTransport + EventBus を凍結
    }

    Boot --> Run

    state Run {
        state "Service components" as Svc {
            Sch : SubjectPicker
            AR : AgentRuntime
            TE : TransitionRule
            OE : OutboxActionMapper
            ST : SiblingTracker
            Oracle : MergeCloseAdapter
        }

        state "Channels (decide + execute)" as Chs {
            D : DirectClose
            C : OutboxClose (pre / post)
            E : BoundaryClose
            M : MergeClose
            Cas : CascadeClose
            U : CustomClose
        }

        Svc --> Chs : event publish/subscribe
    }

    Run --> [*]

    note right of Svc
        詳細: 15-dispatch-flow §A/B
        Service component は \"channel ではないが
        dispatch pipeline を構成する\" 役割。
    end note
```

**Why (W14)**:

- As-Is は host process (OrchestratorProc / RunnerProc / MergePrProc)
  を単位にしていたため、scheduling + dispatch + transition + close が **1
  process = 1 god object** に同居していた。
- To-Be は **component 単位**。1 process に何個 component が同居しても良いし、1
  component を別 process に分離しても良い (deployment 詳細)。Boot で凍結された
  EventBus が境界を担う。
- MergeClose (merge-pr) も component として扱う。subprocess かどうかは
  deployment 詳細であり、Channel 契約には現れない。

---

## F. Invocation modes (CLI entry point — 既存 As-Is との接合)

```mermaid
stateDiagram-v2
    direction LR

    state "invocation mode" as Mode {
        InvWorkflow : run-workflow (multi-cycle)
        InvAgent    : run-agent (single-step)
        InvMerge    : merge-pr (one-shot)
    }

    Mode --> SharedBoot : 同じ Boot
    SharedBoot --> ComponentsActive : Mode によって SubjectPicker の挙動を切替

    state ComponentsActive {
        Same_AR : AgentRuntime / TransitionRule / Channels は invocation mode 不問
        Sch_Diff : SubjectPicker のみ mode を読む
    }
```

**Why**:

- invocation mode は **SubjectPicker の入力** (= subject queue の作り方)
  に閉じ込める。Channel 側は mode を知らない。
- これにより DirectClose は run-workflow / run-agent のどちらの起動でも同じ
  contract で動く。As-Is は run-workflow と run-agent で別 path
  を持っていた箇所を 1 path に集約する。
