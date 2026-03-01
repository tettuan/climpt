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
    ├── stepMachine       → StepMachineVerdictHandler
    ├── externalState     → ExternalStateVerdictAdapter
    ├── iterationBudget   → IterationBudgetVerdictHandler
    ├── keywordSignal     → KeywordSignalVerdictHandler
    ├── structuredSignal  → StructuredSignalVerdictHandler
    ├── checkBudget       → CheckBudgetVerdictHandler
    ├── composite         → CompositeVerdictHandler
    └── custom            → (動的ロード)
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

Agent の仕事を終わらせる。三段構成で完了を判定し、Flow Loop に結果を返す。
「Completion Loop」は概念名であり、内部の識別子には使わない。

```
Completion Loop
├── Stage 1: Closure 機構
│   何をするか: Completion Loop を起動し、AI に最終確認を促す
│   識別子:     ClosureManager, hasClosingSignal(), closurePrompt
│
├── Stage 2: Validation
│   何をするか: Step 成果物が条件を満たしたかを機械的に検証する
│   識別子:     ValidationChain, StepValidator, validationSteps,
│              validationConditions, ValidationCondition
│
└── Stage 3: Verdict
    何をするか: 検証結果に基づき Agent 完了の最終判定を下す
    識別子:     VerdictHandler, isFinished(), done / retryPrompt
```

### 三段の境界

```
Closure → closureResult (AI の自己申告)
            │
            ▼
Validation → validation.allPassed (外部検証の合否)
            │
            ▼
Verdict → { done: true } or { done: false, retryPrompt }
```

- Closure は AI に問いかけるだけで、合否を判定しない。
- Validation は外部コマンドで検証するだけで、Agent 完了を決めない。
- Verdict は Validation の結果を受け取るだけで、自ら検証しない。

各段は単一の責務だけを持ち、隣の段の仕事を代行しない。

## Verdict Strategy

VerdictType に応じて VerdictHandler を差し替える Strategy パターン。 Flow Loop
の動作は VerdictType に依存しない。

```
Verdict Strategy (VerdictType)
├── stepMachine
│   何をするか: Step 状態機械が終端に到達したかを判定する
│
├── externalState
│   何をするか: 外部リソースが目標状態に到達したかを判定する
│
├── iterationBudget
│   何をするか: N 回の iteration を消化したかを判定する
│
├── keywordSignal
│   何をするか: LLM 出力に特定キーワードを検出したかを判定する
│
├── structuredSignal
│   何をするか: LLM 出力に特定 JSON 構造を検出したかを判定する
│
├── checkBudget
│   何をするか: N 回のステータスチェックを消化したかを判定する
│
├── composite
│   何をするか: 上記を AND/OR/FIRST で組み合わせて判定する
│
└── custom
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
