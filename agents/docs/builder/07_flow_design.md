# 07. Flow 設計ガイド

**位置付け**: docs-writing 5-level framework の **Level 1 (設計判断の根拠)**。

- `06_workflow_setup.md` は workflow.json の **書き方** (how / Level 2)
- `02_agent_definition.md` は agent 定義の **書き方** (how / Level 2)
- 本ガイドは一段上の「**どう設計するか**」(why / which) を扱う

扱う論点:

1. Agent role (`transformer` / `validator`) の選び方
2. Cycle の意味論と収束保証
3. 典型 Flow Pattern のカタログ (JSON snippet 付き)

---

## 1. Role の選び方

### 1.1 分岐能力の正確な仕様

`role` は「この agent の後続 phase が固定か、agent の判断で変わるか」を宣言する
項目である (`agents/orchestrator/workflow-types.ts`)。

| Role          | 成功経路              | 失敗経路 (optional)         | 総分岐数     |
| ------------- | --------------------- | --------------------------- | ------------ |
| `transformer` | `outputPhase` (1 本)  | `fallbackPhase` (0 or 1 本) | 1 または 2   |
| `validator`   | `outputPhases` (N 本) | `fallbackPhase` (0 or 1 本) | N または N+1 |

- `fallbackPhase` は **両 role 共通**のオプショナルフィールド
  (`BaseAgentDefinition`)
- transformer の成功判定は「outcome === "success"」の二値判定
  (`phase-transition.ts:23-33`)
- validator の成功判定は「outcome が `outputPhases` のキーに存在するか」を
  lookup で判定 (`phase-transition.ts:36-44`)

**重要な throw 挙動**: `fallbackPhase` を定義しない agent が該当経路
(transformer の非 success / validator の未知 outcome) に落ちると、
`computeTransition` は `Error` を throw する。「迷ったら transformer で
fallbackPhase は後回し」は罠 — **fallbackPhase は最初から定義すること**。

### 1.2 verdict とは (validator が分岐キーを emit する仕組み)

validator が多値分岐するには、agent が closure step で **`verdict` を structured
output として emit** する必要がある。emit された verdict は dispatcher により
outcome として伝播し、orchestrator が `outputPhases[outcome]`
で遷移先を解決する。

```
agent closure step
  └─ structured output: { "verdict": "approved", ... }
        ↓
  dispatcher: verdict → outcome
        ↓
  orchestrator: outputPhases["approved"] → 次 phase
```

- 詳細手順: [06_workflow_setup.md](./06_workflow_setup.md) の 「Verdict
  伝搬フロー」
- 出力契約: [09_closure_output_contract.md](./09_closure_output_contract.md)
- transformer は verdict を emit する必要なし (outcome は success / failed の
  二値のみ見られる)

### 1.3 判断フロー

```
Q1. この agent は「変換」か「判定」か？
    ├─ 変換 (唯一の正解出力を生成)          → transformer
    └─ 判定 (複数の結論を区別する)           → validator

Q2. 成功の "種類" は 1 つで足りるか？
    ├─ はい (done 一択)                      → transformer
    └─ いいえ (approved / rejected 等)       → validator

Q3. 失敗の "種類" で別処理が必要か？
    ├─ いいえ (全失敗を同じ fallback へ)     → transformer
    └─ はい  (transient / permanent 等)      → validator 化を検討
```

### 1.4 経験則: 迷ったら transformer で始める

- transformer は書くものが少ない (verdict emit 不要、`outputPhase` 単数、
  payload 設計不要)
- ただし **`fallbackPhase` は初期から定義**すること (§1.1 の throw 回避)
- 要件が固まって「失敗の種類で分岐したい」「成功の判定が複数ある」と明確に
  なってから validator に昇格する方が、推測で書いた空の
  `outputPhases: { "success": "..." }` を抱えるより健全

### 1.5 validator 昇格のサイン

以下が起きたら transformer の限界。validator 化を検討する:

- `fallbackPhase` を outcome の種類で複数分岐させたくなる
- agent prompt が IF-THEN ルーティングロジックを内部で表現している
- 成功の意味が複数種類に分かれる (approved / conditionally-approved / rejected
  など)

---

## 2. Cycle とは何か

### 2.1 Cycle の定義

Orchestrator は 1 issue を複数回の「cycle」に分けて処理する
(`agents/orchestrator/orchestrator.ts`)。各 cycle は以下の 1 周:

1. issue の現在 label を読む
2. label → phase に解決
3. phase が `actionable` かつ agent 割り当てあり → dispatch
4. agent の outcome から次 phase を計算 (`computeTransition`)
5. label を swap (`computeLabelChanges`)
6. 次 phase の type を判定:
   - `terminal` → 完了して終了
   - `blocking` → 滞留状態として終了 (human/resolver 介入待ち)
   - `actionable` → (1) に戻り次 cycle へ

### 2.2 なぜ cycle が必要か

Flow が loop (例: reviewer → rejected → iterator → review) や多段 pipeline を
含む場合、**1 issue を 1 回の dispatch では最後まで運べない**。cycle は 「1
issue を terminal / blocking まで運ぶための orchestrator のループ機構」 である。

1 agent が 1 phase を担い、cycle が phase 間の遷移を駆動する — この役割分離
により agent 実装は workflow 全体を知らなくてよい。

### 2.3 収束の保証

`rules.maxCycles` は **無限ループ防止のガードレール**。phase graph が循環
していて terminal / blocking に辿り着けない場合、maxCycles 超過で
`status: "cycle_exceeded"` として停止する。

設計時に検証すべき項目:

- [ ] すべての経路が有限ステップで terminal または blocking に到達するか
- [ ] 最長経路の cycle 数は `maxCycles` 以下か
- [ ] loop を含む場合、loop を抜ける条件 (成功 verdict / 外部状態変化) が
      仕組みとして存在するか
- [ ] 同一 phase で stuck する病的ケースを `maxConsecutivePhases` で早期検知
      するか (§2.4)

**`maxCycles` の見積もり例** (Revision Loop):

```
writer → review → revision → writer → review → done  = 5 cycle
                                                    ↑ 余裕 +2
maxCycles: 7
```

最長経路を workflow.json の phase graph から手で辿り、その +1〜2 を設定する。

### 2.4 Phase Repetition Limit (`maxConsecutivePhases`)

`maxCycles` は **総遷移回数**の上限で、`revision` に 3 回連続で留まっても別
phase で 2 回まで消費できる設定では stuck pattern の検知が遅れる。
`maxConsecutivePhases` は「**同一 phase が N 回連続で出現**」という局所的な
stuck を、`maxCycles` より先に捕まえるためのガードである (`WorkflowRules`
`agents/orchestrator/workflow-types.ts`)。

| 観点     | `maxCycles` (既存)  | `maxConsecutivePhases` (新規)        |
| -------- | ------------------- | ------------------------------------ |
| 計測対象 | 全 phase 遷移の累計 | 直近末尾の同一 `to` phase の連続回数 |
| 目的     | 全体の暴走上限      | 局所 stuck の早期検知                |
| 評価順序 | 後                  | **先** (specific な判定を優先)       |
| status   | `cycle_exceeded`    | `phase_repetition_exceeded`          |
| event    | `cycle_exceeded`    | `consecutive_phase_exceeded`         |

- 型: `number`、`integer >= 0`、optional
- default: `0` (= **disabled**, 未指定時はチェックなし)
- 検知ロジック: history 末尾 N 件の `record.to` がすべて同一値なら trip (異
  phase が 1 件挟まると counter リセット)
- 推奨値: `maxCycles >= 5` の workflow では `3`、`maxCycles <= 3` の workflow
  では OFF のまま (`maxCycles` で十分)

**例** (limit=3):

```
revision → revision → revision  ← 3 回連続 → trip (phase_repetition_exceeded)
revision → revision → triage → revision → revision  ← triage で counter リセット
```

status / event の詳細は
[`design/12_orchestrator.md`](../design/12_orchestrator.md) 「Status
判定ロジック」参照。

### 2.5 `cycleDelayMs` の用途

cycle 間の待機時間 (ミリ秒)。

| 用途                                                        | 推奨値                                 |
| ----------------------------------------------------------- | -------------------------------------- |
| ユニットテスト (`examples/fixtures/workflow/workflow.json`) | `0`                                    |
| GitHub issue 操作を含む本番 workflow                        | `30000` (`.agent/workflow.json`)       |
| PR merge など外部状態の伝播が重い workflow                  | `60000` (`.agent/workflow-merge.json`) |

短すぎると GitHub API レート制限に触れたり、label 伝播が cycle 間で観測
されず誤判定の原因になる。**最低でも GitHub API の label 反映レイテンシ分 (数秒)
は確保すること**。

---

## 3. Flow Patterns

Agent role と cycle 機構を組み合わせて実現される典型パターン。各パターンに 最小
JSON snippet を示す。

### 3.1 Linear Pipeline

```
A → B → C → done
```

```jsonc
"phases": {
  "a-pending": { "type": "actionable", "agent": "A" },
  "b-pending": { "type": "actionable", "agent": "B" },
  "c-pending": { "type": "actionable", "agent": "C" },
  "done":      { "type": "terminal" }
},
"agents": {
  "A": { "role": "transformer", "outputPhase": "b-pending", "fallbackPhase": "done" },
  "B": { "role": "transformer", "outputPhase": "c-pending", "fallbackPhase": "done" },
  "C": { "role": "transformer", "outputPhase": "done",      "fallbackPhase": "done" }
}
```

各 transformer が `outputPhase` で次 phase ID を指すだけ。最小構成。

### 3.2 Retry Loop

```
A (transformer) ─ success ─> done
                ╲ fail    ─> a-pending   ← 自分自身の phase ID
```

```jsonc
"agents": {
  "A": {
    "role": "transformer",
    "outputPhase": "done",
    "fallbackPhase": "a-pending"   // ← phase ID であり label ではない
  }
}
```

- `fallbackPhase` に指定するのは **phase ID** (labelMapping の値)
- `maxCycles` が停止条件
- agent が冪等でないと副作用が蓄積する
- retry する失敗とそうでない失敗を区別したいなら validator 化し、
  `outputPhases: { "transient": "a-pending", "permanent": "failed" }`
  のように分岐

### 3.3 Revision Loop

```
writer (transformer) → review-pending → reviewer (validator)
                                         ├─ approved ─> done
                                         └─ rejected ─> revision-pending → writer
```

```jsonc
"phases": {
  "write-pending":    { "type": "actionable", "agent": "writer" },
  "review-pending":   { "type": "actionable", "agent": "reviewer" },
  "revision-pending": { "type": "actionable", "agent": "writer" }, // 同じ writer
  "done":             { "type": "terminal" }
},
"agents": {
  "writer": {
    "role": "transformer",
    "outputPhase": "review-pending",
    "fallbackPhase": "done"
  },
  "reviewer": {
    "role": "validator",
    "outputPhases": {
      "approved": "done",
      "rejected": "revision-pending"
    },
    "fallbackPhase": "done"
  }
}
```

Validator による明示 verdict 分岐。`revision-pending` phase は **同じ writer
agent を再割り当て**する (別 agent を挟まない) ことで、writer が最新フィード
バックを受けて再実行する。

利点: loop を抜ける条件 (`approved` verdict) が agent の判定として明示される
(retry loop と違い「何回失敗したら諦めるか」ではなく「成功したら抜ける」)。

### 3.4 Fan-in / Diamond

```
A (transformer) ─ success ─> B ─> e-pending
                ╲ fail    ─> C ─> D ─> e-pending
e-pending → E (transformer) → done
```

```jsonc
"phases": {
  "a-pending": { "type": "actionable", "agent": "A" },
  "b-pending": { "type": "actionable", "agent": "B" },
  "c-pending": { "type": "actionable", "agent": "C" },
  "d-pending": { "type": "actionable", "agent": "D" },
  "e-pending": { "type": "actionable", "agent": "E" },   // 合流点
  "done":      { "type": "terminal" }
},
"agents": {
  "A": { "role": "transformer", "outputPhase": "b-pending", "fallbackPhase": "c-pending" },
  "B": { "role": "transformer", "outputPhase": "e-pending", "fallbackPhase": "done" },
  "C": { "role": "transformer", "outputPhase": "d-pending", "fallbackPhase": "done" },
  "D": { "role": "transformer", "outputPhase": "e-pending", "fallbackPhase": "done" },
  "E": { "role": "transformer", "outputPhase": "done",      "fallbackPhase": "done" }
}
```

複数 agent (B / D) が **同じ phase ID (`e-pending`) を outputPhase /
fallbackPhase で指す**ことで自然に合流する。専用の merge 機構は不要 — 合流 phase
は label として表現され、orchestrator は次 cycle で E を dispatch するだけ。

合流側で経路を区別したい場合:

- label に経路痕跡を残す (`via-b`, `via-d` など補助 label)
- handoff declaration (`workflow.json` の `handoffs[]`) で source agent が
  artifact を emit し、E が payload を読む
- E を validator 化し、label / payload を見て分岐

### 3.5 Recovery → Resume

```
A ─ fail ─> recovery-pending → recovery-agent → a-pending  (元に戻す)
```

```jsonc
"phases": {
  "a-pending":        { "type": "actionable", "agent": "A" },
  "recovery-pending": { "type": "actionable", "agent": "recovery" },
  "done":             { "type": "terminal" }
},
"agents": {
  "A": {
    "role": "transformer",
    "outputPhase": "done",
    "fallbackPhase": "recovery-pending"
  },
  "recovery": {
    "role": "transformer",
    "outputPhase": "a-pending",         // 元 phase に戻す
    "fallbackPhase": "done"
  }
}
```

`fallbackPhase` が recovery phase を指し、recovery agent が `outputPhase` で 元
phase を指す。auth 切れ再取得、lock 解放、cache 再構築などで使う。

### 3.6 Escalation (Human-in-the-loop)

```
A ─ fail ─> blocked   (type: "blocking" phase, human 介入待ち)
```

```jsonc
"phases": {
  "a-pending": { "type": "actionable", "agent": "A" },
  "blocked":   { "type": "blocking" },    // agent 割り当てなし + 専用 type
  "done":      { "type": "terminal" }
},
"agents": {
  "A": {
    "role": "transformer",
    "outputPhase": "done",
    "fallbackPhase": "blocked"
  }
}
```

`blocked` phase は `type: "blocking"` として宣言する (`PhaseType` の第 3 値)。
orchestrator はこの phase に到達すると cycle を抜け、human / resolver agent が
label を変更するまで滞留する。

- `.agent/workflow-issue-states.md` の `S4.blocked` がこれに該当
- `agent` フィールドは記述しない (blocking phase は dispatch 対象外)

**注**: `type: "actionable"` のまま `agent` を省略すると orchestrator は
`agent_unresolved` として異常終了する。滞留は必ず `blocking` で宣言する。

---

## 4. 設計の手順

新しい workflow を組むときの推奨順序:

1. **Done Criteria を定義** — どの phase に到達したら issue 完了か (terminal)。
   行き止まり (blocking) も合わせて列挙する。
2. **Happy path を書く** — start → ... → terminal の単線を transformer の
   連鎖で引く。各 agent に `outputPhase` を設定。
3. **失敗シナリオを列挙** — 各 agent が落ちる場面を書き出す。
4. **失敗経路を設計** — retry / revision / recovery / escalation のいずれで
   吸収するか決める。各 agent に `fallbackPhase` を設定 (§1.1 の throw 回避)。
5. **validator 昇格を判定** — 3 で挙げた失敗を種類別に分岐させる必要がある
   agent、成功の意味が複数ある agent を validator に昇格。
6. **`maxCycles` を算出** — 最長経路の cycle 数を workflow.json から手で辿り、
   +1〜2 を設定 (§2.3 の例を参照)。
7. **`maxConsecutivePhases` を検討** — `maxCycles >= 5` なら `3` を目安に設定
   し、stuck pattern を早期検知 (§2.4)。default は `0` (OFF)。
8. **`cycleDelayMs` を設定** — テスト時は 0、本番は 30000 以上を目安に (§2.5)。

---

## 関連ドキュメント

- [02_agent_definition.md](./02_agent_definition.md) — agent 定義の書式
- [06_workflow_setup.md](./06_workflow_setup.md) — workflow.json の書式、 Agent
  / Rules フィールド、Verdict 伝搬フロー
- [08_github_integration.md](./08_github_integration.md) — GitHub 連携の 3
  層アクセスモデル、label 操作の実装
- [09_closure_output_contract.md](./09_closure_output_contract.md) — closure
  step の出力契約、verdict emit 方法
- [.agent/workflow-issue-states.md](../../../.agent/workflow-issue-states.md) —
  Climpt 内部 workflow (Triage → Execute) の具体例、`S4.blocked` 実例
- 実装参照:
  - `agents/orchestrator/workflow-types.ts` (AgentRole, PhaseType, 型定義)
  - `agents/orchestrator/phase-transition.ts` (二値 / 多値分岐ロジック、 throw
    挙動)
  - `agents/orchestrator/orchestrator.ts` (cycle 機構、maxCycles 停止条件)
