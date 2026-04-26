# 42 — OutboxClose channel (C-pre / C-post) — Outbox-driven close

Outbox に enqueue された `OutboxAction.PreClose` / `PostClose` を Outbox
subscriber が拾って close する経路。**Pre / Post は 2 つの独立 sub-channel**
として並列に存在し、互いに序列を持たない。

**Up:** [10-system-overview](../10-system-overview.md),
[30-event-flow](../30-event-flow.md) **Refs:**
[20-state-hierarchy](../20-state-hierarchy.md) (Layer 2 Outbox) **Subscribes:**
`OutboxActionDecided` (Pre, Post)、`IssueClosedEvent` (Post のみ) **Publishes:**
`IssueClosedEvent` / `IssueCloseFailedEvent`

---

## A. Pre / Post の独立性

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Channel_C

    state "OutboxClose (Outbox close)" as C {
        state "C-pre subscriber" as Cpre {
            Cpre_dec : decide(action: PreClose) → ShouldClose
            Cpre_exe : execute → Transport.closeIssue
        }

        state "C-post subscriber" as Cpost {
            Cpost_wait : wait IssueClosedEvent (D 由来)
            Cpost_dec  : decide(action: PostClose, ic: IssueClosedEvent) → ShouldClose
            Cpost_exe  : execute → Transport.closeIssue (idempotent)
        }
    }

    Channel_C --> [*]

    note right of C
        2 つは別 subscriber で別 decide。
        間に序列も依存も無い。
        Pre/Post は OutboxAction.kind が決定する。
    end note
```

**Why**:

- W4 (As-Is で C-pre→C-post が serial composite に見えた; critique B3)
  を直す。Pre と Post は **同じ channel の 2 つの subscriber**
  であり、互いに直接の依存は無い。
- Post が Pre を待つことは無い。Post は **`IssueClosedEvent` (D 由来)** を待つ。

---

## B. OutboxAction ADT

```mermaid
stateDiagram-v2
    direction LR

    state "OutboxAction (ADT)" as OA {
        PreClose : PreClose { issue: IssueRef }
        PostClose : PostClose { issue: IssueRef, requires: IssueClosedEvent }
        Comment : Comment { issue: IssueRef, body: string }
        CreateIssue : CreateIssue { ... }
    }

    state "OutboxActionDecided" as OAE {
        payload : { action: OutboxAction }
    }

    OA --> OAE : enqueue 時に publish

    note right of OA
        kind tag で discrimination。
        \"close-issue\" 等の string sentinel は
        ADT 採用で消滅する (W12 修復)。
    end note
```

**Why**:

- W12 (outbox `action: "close-issue"` が string sentinel) を直す。`OutboxAction`
  ADT に置き換え。`kind` tag で型保証。
- C-pre / C-post の責務分離が **payload の型** で表現される: PreClose は
  requires 不要 / PostClose は `requires: IssueClosedEvent` を payload
  内に保持。

---

## C. C-pre subscriber

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Sub
    Sub --> Recv : OutboxActionDecided
    Recv --> Filter : action.kind = ?
    Filter --> Skip_NotPre : kind ≠ PreClose
    Filter --> Decide : kind = PreClose

    Decide --> Skip_NoStore : ¬Policy.storeWired
    Decide --> ShouldClose

    ShouldClose --> Execute : Transport.closeIssue
    Execute --> Done : ok
    Execute --> Failed : err

    Done --> Pub_OK : publish IssueClosedEvent
    Failed --> Pub_NG : publish IssueCloseFailedEvent

    Skip_NotPre --> [*]
    Skip_NoStore --> [*]
    Pub_OK --> [*]
    Pub_NG --> [*]
```

**Why**:

- 起動契機が **Outbox の append** であり「workflow phase
  の到達」ではない。DirectClose の internal state を読まない (疎結合)。

---

## D. C-post subscriber

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Sub2

    Sub2 --> SubA : subscribe(OutboxActionDecided)
    Sub2 --> SubB : subscribe(IssueClosedEvent)

    SubA --> StagePost : PostClose 受領
    SubB --> StageIC : IssueClosedEvent 受領

    StagePost --> Match : 同じ IssueRef の対?
    StageIC --> Match

    Match --> Decide : 揃った
    Match --> Wait : 片方のみ → 待機

    Decide --> ShouldClose : 揃 + Policy ok
    Decide --> Skip_NoStore : ¬Policy.storeWired

    ShouldClose --> Execute
    Execute --> Done_Idem : Transport.closeIssue (server 既 closed = no-op)
    Execute --> Failed

    Done_Idem --> Pub_OK : IssueClosedEvent (channel: C-post)
    Failed --> Pub_NG    : IssueCloseFailedEvent

    Wait --> [*]
    Skip_NoStore --> [*]
    Pub_OK --> [*]
    Pub_NG --> [*]
```

**Why**:

- W5 (As-Is は `S2.11=T` を直接読む) を直す。Post は **2 つの event の合流**
  で発火する。状態 polling を持たない。
- C-pre / D-success の発生順は **どちらでもよい**。subscriber
  が両方を待ち、揃った時点で decide する。

---

## E. trigger / Decision / Transport / Effect 全表

| 観点                    | C-pre                                               | C-post                                                                      |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| **trigger (subscribe)** | `OutboxActionDecided`（kind=PreClose）              | `OutboxActionDecided`（kind=PostClose） + `IssueClosedEvent`（同 IssueRef） |
| **Decision 入力**       | `{ action: PreClose, Policy }`                      | `{ action: PostClose, ic: IssueClosedEvent, Policy }`                       |
| **Decision 出力**       | `ShouldClose(IssueRef, C-pre)` ∨ `Skip(reason)`     | `ShouldClose(IssueRef, C-post)` ∨ `Skip(reason)`                            |
| **Transport**           | Boot で凍結された 1 つ                              | 同左                                                                        |
| **Effect**              | Transport 経由で Issue.state=Closed                 | 同左 (server 側既 closed なら冪等)                                          |
| **Publish**             | `IssueClosedEvent(C-pre)` / `IssueCloseFailedEvent` | `IssueClosedEvent(C-post)` / `IssueCloseFailedEvent`                        |
| **Compensation**        | 失敗時 outbox file を保持 (再試行可能性)            | 同左                                                                        |

---

## F. C-pre と C-post の発火対象 (誰が enqueue するか)

```mermaid
flowchart TD
    Producer1[DirectClose 失敗時の Compensation]
    Producer2[外部 agent code]
    Producer3[DirectClose 成功時の post-action]

    Producer1 --> Q[OutboxAction]
    Producer2 --> Q
    Producer3 --> Q

    Q --> kind_pre[kind = PreClose]
    Q --> kind_post[kind = PostClose]

    kind_pre --> Cpre[C-pre subscriber]
    kind_post --> Cpost[C-post subscriber]

    classDef pre fill:#fff4e0,stroke:#cc7733;
    class kind_pre,kind_post pre
```

**Why**:

- enqueue 側 (Producer) と consume 側 (subscriber) を分離。Producer は consumer
  の存在を知らない。As-Is の「OutboxProcessor が trigger string
  で内部分岐」を、ADT による型分離 + subscriber 分離に置き換え。

---

## G. OutboxClose の責務 (1 行)

> **「Outbox から `PreClose` / `PostClose` を拾って Transport に渡す。Pre と
> Post は別 subscriber。」**

- Pre は Outbox 単独で発火
- Post は Outbox + `IssueClosedEvent` の合流で発火
- どちらも DirectClose の internal state を読まない
- Transport の中身を知らない
