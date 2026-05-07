# To-Be 設計 Q&A

新しく作成した To-Be 設計 (tobe-charts/) に対する質疑応答。As-Is
実装と混ぜずに、新設計の範囲のみで回答する。

---

## Q1. orchestrator は workflow.json を使う設計か？

**A:** 否。

- To-Be に **Orchestrator は存在しない**。As-Is の god object は 4 component
  (SubjectPicker / AgentRuntime / TransitionRule / OutboxActionMapper)
  に解体されている (15 §A, §F)。
- **workflow.json への参照は新設計のどこにも無い**。Phase / 遷移は
  `TransitionRule: (currentPhase, outcome) → (nextPhase, isTerminal)` の **pure
  function** として表現されており、入出力 table のみで定義される (15 §H, 30
  §C)。
- 仮に phase 定義を外部 file から load するとしても、それは **Boot の input**
  であり Run 中は immutable (Layer 4 Policy と同格)。設定 source が JSON
  か否かは設計の関心事ではない。

---

## Q2. Orchestrator の代わりに何がいるのか？

**A:** 4 component (Bus 経由で繋がる) + CycleLoop (driver) + 6 Channel + 2
service。

### 4 component (As-Is `Orchestrator.cycle()` の責務分解)

| Component                 | 入力 event          | 出力 event                                       | 責務                                         |
| ------------------------- | ------------------- | ------------------------------------------------ | -------------------------------------------- |
| **SubjectPicker**         | (CycleLoop.tick)    | `DispatchPlanned`                                | 次の subject + step を決める                 |
| **AgentRuntime**          | `DispatchPlanned`   | `DispatchCompleted` (+ `ClosureBoundaryReached`) | 1 step を AgentTransport 経由で実行          |
| **TransitionRule** (pure) | `DispatchCompleted` | `TransitionComputed`                             | `(phase, outcome) → (nextPhase, isTerminal)` |
| **OutboxActionMapper**    | `DispatchCompleted` | `OutboxActionDecided`                            | SO → OutboxAction ADT                        |

### Driver

- **CycleLoop**: `SubjectPicker.tick → Bus drain → 次 tick`。Halt 条件は
  SubjectPicker.empty() のみ (15 §G)。

### Channel (close decision authority)

- DirectClose / BoundaryClose / OutboxPreClose / OutboxPostClose / CascadeClose
  / CustomClose / MergeClose

### Service

- **SiblingTracker**: `IssueClosedEvent` 集計 → `SiblingsAllClosedEvent`
- **MergeCloseAdapter**: Layer 1 ↔ Layer 2 bridge。MergeClose の close を
  `IssueClosedEvent` に翻訳

### 重要な構造的差異

- 全 component / channel / service は **Bus 経由のみ** で繋がる (direct call
  ゼロ、15 §E)
- 各 component は **1 入力 event + 1 出力 event** に責務固定
- god object は class 分割ではなく **event 型を design hub に据えた契約分割**
  で排除される (15 §F note)

---

## Q3. orchestrator → agent runner dispatch 構造は維持しているか？

**A:** 概念は維持、構造は非維持。

### 維持されている (概念)

- 「**選択する側** と **実行する側** を分ける」という分業は残る。
- 選択側: **SubjectPicker** (As-Is の prioritizer + cycle scheduling 部分)
- 実行側: **AgentRuntime** (As-Is の R1.dispatch / runner)

### 維持されていない (構造)

| 観点     | As-Is                                                                       | To-Be                                                                               |
| -------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 結合方式 | **direct call** (`Orchestrator.cycle()` から `R1.dispatch(agent)` を直呼び) | **Bus 経由** (`DispatchPlanned` を publish → AgentRuntime が subscribe)             |
| 起動者   | Orchestrator が runner を **能動的に呼ぶ**                                  | SubjectPicker は event を出すだけ。誰が consume するか知らない                      |
| 戻り値   | Runner の return value を Orchestrator が受け取る                           | AgentRuntime が `DispatchCompleted` を **publish** (return しない)                  |
| 同期性   | 同期 (call-return)                                                          | 非同期 (event publish)                                                              |
| 責務範囲 | Orchestrator が dispatch 後の transition / outbox / close まで連続実行      | dispatch 後の処理は別 subscriber (TransitionRule / OutboxActionMapper) が独立に拾う |

### 帰結

- AgentRuntime は **「誰が依頼してきたか」を知らない**。`DispatchPlanned`
  を受領するだけ。
- SubjectPicker は **「実行結果を待たない」**。次 tick まで何もしない (CycleLoop
  が Bus drain を待つ、15 §G)。
- これにより As-Is の god object 構造 (orchestrator が dispatch 結果に基づき
  transition / close を逐次実行) は **構造的に崩される**。

---

## Q4. orchestrator 起動に相当する endpoint はどれか？

**A:** **3 つの invocation mode** (10 §F)。すべて同一の Boot + CycleLoop
に入る。

| invocation mode    | 役割                                                 | SubjectPicker の挙動             |
| ------------------ | ---------------------------------------------------- | -------------------------------- |
| **`run-workflow`** | multi-cycle (As-Is の `orchestrator` 起動に最も近い) | subject queue を継続的に補給     |
| **`run-agent`**    | single-step                                          | 1 subject 1 step で empty に倒す |
| **`merge-pr`**     | one-shot                                             | MergeClose のみ (PR 1 件)        |

### 構造

```
CLI entry (run-workflow / run-agent / merge-pr)
    ↓
SharedBoot (Transport 凍結, Channel 構築, Bus subscribe)
    ↓
CycleLoop.start (tick → drain → next)
```

### 重要点

- **invocation mode は SubjectPicker の input に閉じ込められる** (10 §F note)。
- AgentRuntime / TransitionRule / Channels は **invocation mode
  を知らない**。すべて同じ event 契約で動く。
- 3 endpoint で **Boot は同一**。Transport / Policy も同じ枠組みで凍結される。
- 「orchestrator 起動に最も近い」のは `run-workflow` だが、To-Be では **mode
  の差は subject 供給の仕方だけ**。本体構造は同一。

---

## Q5. GitHub project を指定した起動は可能か？

**A:** 設計上は **未規定** (silent)。SubjectPicker の input
契約として後付けで定義する余地がある。

### 現状の設計範囲

- 30 §A の `SiblingsAllClosedEvent.binding: ProjectBinding` で
  **`ProjectBinding`** という型名は登場するが、これは **sentinel-cascade
  用の集計単位** (sibling 全 closed の判定 boundary) であり、起動時の subject
  filter ではない。
- SubjectPicker の責務は「次の subject + step を決める」 (15 §H)
  と書かれているのみ。**subject 集合の source (issue list / gh project / label
  query 等) は設計に明記されていない**。

### 設計位置づけ

| 関心事                                    | 場所                                  |
| ----------------------------------------- | ------------------------------------- |
| 起動 mode (workflow / agent / merge-pr)   | **CLI entry** (10 §F)                 |
| 起動時 filter (project / label / repo 等) | **SubjectPicker の input** (= 未規定) |
| 結果の subject queue                      | SubjectPicker → `DispatchPlanned`     |

### 帰結

- GitHub project 指定起動を加える場合、**SubjectPicker の input 契約に「subject
  source descriptor」を追加** する形になる。Channel / AgentRuntime /
  TransitionRule には影響しない (10 §F の不可視性原則)。
- 例: `run-workflow --project=<id>` → SubjectPicker が gh project から subject
  queue を作る。Transport を経由するか別経路かは要追加設計。
- **Boot で凍結される対象** (Transport / Policy) には属さず、**Run 時 input**
  に分類される (= 1 cycle ごとの dynamic な絞り込みも可能)。

---

## Q6. subject とは何か？

**A:** 設計上は「**workflow を進める単位**」を指す参照型 (`SubjectRef`)。issue
とは **別レイヤの概念** で対応関係を持つが同一ではない。

### 設計に登場する箇所

| 出現                                                                  | 意味                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `SubjectRef` 型                                                       | event payload (DispatchPlanned / DispatchCompleted / ClosureBoundaryReached / TransitionComputed) の subject identifier (15 §D) |
| `SubjectStore` (Layer 2)                                              | Issue.state の local mirror を subject 単位で持つ store (20 §A)                                                                 |
| `ClosureBoundaryReached: { subject: SubjectRef, …, issue: IssueRef }` | **subject と issue が別 field** (30 §A, 15 §D)                                                                                  |

### 帰結

- subject は **「phase / step を持つ workflow の進行単位」** であり、関連する
  issue (IssueRef) を **副次的 attribute** として持つ。
- 1 subject ↔ 1 issue とは限らない (sentinel / sibling 関係を考えると 1 subject
  が複数 issue に関係する余地がある)。
- SubjectPicker の責務は「次に dispatch する **subject + step**」を決めること
  (15 §H)。issue 直接ではない。

### 設計上の不足 (正直)

- **SubjectRef の構造 (id / name / ProjectBinding 内の位置 等)
  は明示定義されていない**。Layer 2 の SubjectStore に格納されるが schema
  が未規定。
- subject ↔ issue の対応 cardinality (1:1 / 1:N / N:1) も明文化されていない。
- 必要なら 20 §D の ADT 表に `SubjectRef` / `SubjectStore` schema
  を追記するのが順当。

---

## Q7. gh issue を読んで対応することは可能か？

**A:** **部分的に可能** (state 読みは可、discovery は未規定)。

### 可能 — 既知 issue の state 読み

- 20 §C: `MergeCloseAdapter.readIssueState(IssueRef) → IssueState`
  が**唯一の経路**として定義されている。
- 全 channel は `decide(ctx)` で Oracle (= MergeCloseAdapter) 経由でしか Layer 1
  / Layer 2 を読めない。
- Transport=Real なら GitHub server から取得、File なら Layer 2 mirror を返す
  (差異は Adapter 内に隠蔽)。

### 未規定 — issue の discovery (listing / search)

- `listIssues` / `searchIssues` / `queryByLabel` 等の operation は
  **MergeCloseAdapter に定義されていない**。
- SubjectPicker が subject queue を作る source (gh issue list / gh project /
  label filter 等) も明示されていない (Q5 と同じ問題)。

### 帰結

| 操作                                       | 可否       | 場所                                    |
| ------------------------------------------ | ---------- | --------------------------------------- |
| 既知 issue (IssueRef 在中) の state 読み   | **可**     | MergeCloseAdapter.readIssueState        |
| 既知 issue への comment / close 等の副作用 | **可**     | CloseTransport (Channel.execute 経由)   |
| issue list の取得 (新規 subject 発見)      | **未規定** | SubjectPicker の input 契約として要追加 |
| label / project 条件で issue を絞り込む    | **未規定** | 同上                                    |

### 追加設計するなら

- **SubjectPicker の input source** に `IssueQuery` (label / project / state
  filter 等の ADT) を追加。
- gh issue 取得は **Transport (Real) 経由でのみ** 行う
  (副作用境界の単一性を維持。Custom code が gh を直叩きしない原則と整合、46
  §E)。
- Layer 1 → Layer 2 への投入は MergeCloseAdapter.refreshMirror に類する
  operation で吸収。
- これは **新 channel ではなく SubjectPicker の前段 (Boot 後 / Run 中の subject
  source layer)** に属する。Channel 契約には影響しない。

---

## Q8. AgentRuntime は step registry 定義を使うか？

**A:** **設計に明示なし** (1 箇所だけ間接言及)。AgentRuntime の input は
`DispatchPlanned (subject, phase, step, ctx)` のみ、registry
参照は定義されていない。

### 設計に登場する箇所

| 出現       | 内容                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 15 §D      | `DispatchPlanned.step: StepId` (型名のみ。schema 未定義)                                                                                     |
| 15 §D      | `ClosureBoundaryReached.stepKind: "closure"` (kind の literal)                                                                               |
| 43 §A note | 「BoundaryClose は Boot で valid config の場合のみ構築される (Transport が `Real`/`File` のいずれか + **closure step が registry に存在**)」 |

→ 「step registry」という語は **43 §A の Boot validation 文脈で 1 度だけ**
登場する。AgentRuntime / SubjectPicker / TransitionRule の責務記述には現れない。

### 帰結

| 観点                                | 状態                                            |
| ----------------------------------- | ----------------------------------------------- |
| AgentRuntime が registry を読むか   | **設計に書かれていない**                        |
| step 定義の load タイミング         | 不明 (Boot validation で参照される暗黙の存在)   |
| StepId / Step schema の構造         | 未定義                                          |
| TransitionRule が registry を読むか | 同じく未定義 (pure function とのみ書かれている) |

### 設計上の整合性 (推論)

- AgentRuntime は **AgentTransport.run(prompt) を呼ぶだけ** (15 §C)。step ごとの
  prompt / I/F 詳細は AgentTransport 側に隠蔽される設計と整合する。
- だが「prompt をどこから引くか」「step ごとの SO schema をどこで知るか」は
  AgentTransport の input 契約に押し込まれており、To-Be 側はそこを **black box**
  にしている。
- step registry を明示するなら **Boot input + 不変** (Layer 4 Policy と同格)
  として 20 §A / 10 §C に追加するのが順当。

### 補足 — 既存実装との関係

- ユーザ既知の steps_registry.json (memory 参照) は As-Is の概念。To-Be
  では「Boot input としての step 定義」 に相当するが、**形式 (JSON / TS const /
  他) は設計対象外**。
