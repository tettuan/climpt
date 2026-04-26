# 概念ツリー

Agent Runner を構成する概念の階層構造。
識別子は「何をするか」で命名する（02_core_architecture.md「命名規則」参照）。

## 全体構造

```
Agent Runner
├── Flow Loop
│   ├── Step 遷移 (FlowOrchestrator, WorkflowRouter)
│   ├── Step 完了 (intent routing)
│   └── Structured Gate (StepGateInterpreter)
│
├── Completion Loop (概念名)
│   ├── Closure 機構 (ClosureManager, hasClosingSignal)
│   ├── Validation (ValidationChain, StepValidator, validationSteps)
│   └── Verdict (VerdictHandler.isFinished → done / retryPrompt)
│
└── Verdict Strategy (VerdictType)
    ├── detect:graph      → StepMachineVerdictHandler
    ├── poll:state        → ExternalStateVerdictAdapter
    ├── count:iteration   → IterationBudgetVerdictHandler
    ├── detect:keyword    → KeywordSignalVerdictHandler
    ├── detect:structured → StructuredSignalVerdictHandler
    ├── count:check       → CheckBudgetVerdictHandler
    ├── meta:composite    → CompositeVerdictHandler
    └── meta:custom       → (動的ロード)
```

## Flow Loop

Agent の仕事を前に進める。Step を順番に実行し、handoff で情報を引き継ぐ。
完了の判断はしない。

```
Flow Loop
├── Step 遷移
│   何をするか: intent に基づいて次の Step を決定する
│   識別子:     FlowOrchestrator, WorkflowRouter
│
├── Step 完了
│   何をするか: Step の作業が終わったことを示す
│   識別子:     intent (next / repeat / jump / handoff)
│
└── Structured Gate
    何をするか: LLM 出力から intent と handoff を抽出する
    識別子:     StepGateInterpreter
```

- Step 完了は Agent 完了ではない。Flow Loop は Agent を終了させない。
- `closing` intent は Completion Loop の起動トリガーであり、 Flow Loop
  の責務は制御を渡すことだけである。

## Completion Loop

Agent の仕事を終わらせる。四段構成で完了を判定し、Flow Loop に結果を返す。
「Completion Loop」は概念名であり、内部の識別子には使わない。

```
Completion Loop
├── Phase 1: Pre-flight State Validation
│   何をするか: LLM 呼び出し前に外部状態（git clean, type-check, tests 等）を検証する
│   識別子:     ValidationChain, StepValidator, validationSteps,
│              validationConditions, ValidationCondition
│   失敗時:     LLM を呼ばずに retry
│
├── Phase 2: Closure 機構
│   何をするか: AI に最終確認を促し、証跡を構造化する
│   識別子:     ClosureManager, hasClosingSignal(), closurePrompt
│
├── Phase 3: Format Validation
│   何をするか: LLM の構造化出力を outputSchema に対して検証する
│   識別子:     FormatValidator, outputSchemaRef
│   失敗時:     format retry prompt を生成
│
└── Phase 4: Verdict
    何をするか: 検証結果に基づき Agent 完了の最終判定を下す
    識別子:     VerdictHandler, isFinished(), done / retryPrompt
```

### 四段の境界

```
Pre-flight State Validation → stateCheck (外部状態の合否)
            │ 失敗時は LLM を呼ばずに retry
            ▼
Closure → closureResult (AI の自己申告)
            │
            ▼
Format Validation → formatCheck (構造化出力の合否)
            │
            ▼
Verdict → { done: true } or { done: false, retryPrompt }
```

- Pre-flight State Validation は外部コマンドで状態を検証するだけで、LLM
  を呼ばない。
- Closure は AI に問いかけるだけで、合否を判定しない。
- Format Validation は outputSchema で出力を検証するだけで、Agent
  完了を決めない。
- Verdict は検証結果を受け取るだけで、自ら検証しない。

各段は単一の責務だけを持ち、隣の段の仕事を代行しない。

## Verdict Strategy

VerdictType に応じて VerdictHandler を差し替える Strategy パターン。 Flow Loop
の動作は VerdictType に依存しない。

```
Verdict Strategy (VerdictType)
├── detect:graph
│   何をするか: Step 状態機械が終端に到達したかを判定する
│
├── poll:state
│   何をするか: 外部リソースが目標状態に到達したかを判定する
│
├── count:iteration
│   何をするか: N 回の iteration を消化したかを判定する
│
├── detect:keyword
│   何をするか: LLM 出力に特定キーワードを検出したかを判定する
│
├── detect:structured
│   何をするか: LLM 出力に特定 JSON 構造を検出したかを判定する
│
├── count:check
│   何をするか: N 回のステータスチェックを消化したかを判定する
│
├── meta:composite
│   何をするか: 上記を AND/OR/FIRST で組み合わせて判定する
│
└── meta:custom
    何をするか: 外部ファイルから動的ロードしたハンドラで判定する
```

## 概念名と識別子の区別

```
概念名 (設計書の見出し・図中の名称):
  "Completion Loop"     ← ループ全体の名称
  "Completion Signal"   ← completionSignal の概念
  "completionSignal"    ← Completion Signal を表す変数

識別子 (型名・メソッド名・変数名):
  Verdict*     ← Agent 完了の判定
  Validation*  ← Step 成果物の検証
  Closure*     ← ループ機構の起動
```

「Completion」は概念名としてのみ生存し、識別子からは排除する。

## 設定ファイル結線図

設定 3 ファイル (`agent.json` / `steps_registry.json` / `workflow.json`) と
Runner コンポーネントの関係を 1 枚で示す。矢印は「読み取りの向き」。

```
              ┌──────────────────────────────────────────────┐
              │                    agent.json                │
              │  parameters.*      ← CLI --flag              │
              │  runner.verdict    ──┐                       │
              │  runner.boundaries ──┼──┐                    │
              │  runner.integrations─┘  │                    │
              └────────────┬─────────────│────────────────────┘
                           │             │
                    flow.prompts.registry│
                           ▼             ▼
              ┌──────────────────────────────────────────────┐
              │              steps_registry.json             │
              │  entryStepMapping   (verdictType → stepId)   │
              │  steps[*].structuredGate                     │
              │  steps[*].transitions     ──┐                │
              │  steps[*].outputSchemaRef ──┼── schemas/*.json
              │  validators / failurePatterns (archetype C)  │
              │  pathTemplate       ──┐                      │
              └───────────────────────│──────────────────────┘
                                      │
                              c1/c2/c3/edition
                                      ▼
                         prompts/steps/{c2}/{c3}/f_{edition}.md
                                      │
                                      │ resolved path
                                      ▼
              ┌──────────────────────────────────────────────┐
              │              AgentRunner (runtime)            │
              │   ┌─ FlowOrchestrator  ← structuredGate      │
              │   ├─ WorkflowRouter    ← transitions         │
              │   ├─ StepGateInterpreter ← allowedIntents    │
              │   ├─ ClosureManager    ← closure step        │
              │   ├─ ValidationChain   ← validators          │
              │   └─ VerdictHandler    ← runner.verdict.type │
              └──────────────────────────────────────────────┘

     (外側から) workflow.json — orchestrator 専用:
       labelMapping / prioritizer / phase-transition
       └─ Issue ラベルで agent.name を選択 → 上の agent.json を起動
```

**読み方**:

- `agent.json` は Runner 起動時の不変契約 (入力・出力境界・verdict)。
- `steps_registry.json` は Flow 内部の遷移グラフと prompt 解決パスを提供する。
- `workflow.json` は個別 agent の外側にあり、**どの agent をどの Issue
  で起動するか** を決める (label 駆動の Orchestrator が解釈)。agent.json
  を参照しない。
- `prompts/steps/...` は `pathTemplate` と `c2/c3/edition`
  の合成結果で解決される。 Runner が直接文字列を埋め込むことはない。

矢印が 1 本でも切れれば Runner は `FAILED_SCHEMA_RESOLUTION` や
`INTENT_NOT_FOUND` で fail-fast する。暗黙のフォールバックは存在しない。
