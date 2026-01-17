# Step Flow Design

Flow ループが扱う Step の鎖を「単純だが堅牢な状態遷移」に落とし込むための設計。
What/Why を中心に記述し、How は設定例に留める。

## Why: 単方向と引き継ぎ

- Flow ループは「進む」以外をしない。Step Flow は遷移図を明文化し、戻る必要が
  ある場合でも Step 自身が `transitions` を宣言する。
- 各 Step は次の Step に渡す `handoffFields` を定義し、暗黙依存を排除する。
- ループに分岐ロジックや検証ロジックを埋め込まないことで、AI の局所最適化
  志向（哲学ドキュメント参照）による複雑化を防ぐ。

## What: Step の要素

| 要素                           | 説明                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `stepId`                       | `initial.<c3>` や `continuation.<c3>` 形式で識別                          |
| `c2`, `c3`, `edition`          | C3L パス構成要素。Completion Handler が PromptResolver を介して解決に使う |
| `fallbackKey`                  | 組み込みプロンプトへのフォールバックキー                                  |
| `structuredGate`               | AI 応答から intent を抽出し、遷移を決定するための設定                     |
| `transitions`                  | intent から次の Step を決定するマッピング                                 |
| `structuredGate.handoffFields` | 次の Step に渡すデータのパス（JSON path 形式）                            |

## Step Flow のレイアウト

```
initial.<domain> ──> continuation.<domain>
       │                      │
       ▼                      ▼
   complete.<domain>    (repeat or complete)
```

- `<domain>` は `issue` や `externalState` など、Completion Type に対応する c3
  で 置き換える。Flow は常に **3 段 (initial / continuation / complete)**
  を揃えて 宣言することで、構造を単純に保つ。
- `handoffFields` で指定したデータは StepContext に蓄積され、Completion ループ
  へ橋渡しされる。
- completion 判定は `structuredGate.allowedIntents` に `complete` を含め、 AI が
  `next_action.action: "complete"` を返すことで signal を送る。**complete intent
  は必ず `complete.<domain>` に遷移し、Flow 側で “完了なのに同じ Step を回す”
  状態 を作らない。**

## Schema 例

```jsonc
{
  "$schema": "https://.../steps_registry.schema.json",
  "steps": {
    "initial.issue": {
      "stepId": "initial.issue",
      "name": "Issue Initial Prompt",
      "c2": "initial",
      "c3": "issue",
      "edition": "default",
      "fallbackKey": "issue_initial_default",
      "outputSchemaRef": {
        "file": "issue.schema.json",
        "schema": "#/definitions/initial.issue"
      },
      "structuredGate": {
        "allowedIntents": ["next", "repeat", "complete"],
        "intentField": "next_action.action",
        "targetField": "next_action.details.target",
        "fallbackIntent": "next",
        "handoffFields": [
          "analysis.understanding",
          "analysis.approach",
          "issue"
        ]
      },
      "transitions": {
        "next": { "target": "continuation.issue" },
        "repeat": { "target": "initial.issue" },
        "complete": { "target": "complete.issue" }
      }
    },
    "continuation.issue": {
      "stepId": "continuation.issue",
      "name": "Issue Continuation Prompt",
      "c2": "continuation",
      "c3": "issue",
      "outputSchemaRef": {
        "file": "issue.schema.json",
        "schema": "#/definitions/continuation.issue"
      },
      "structuredGate": {
        "allowedIntents": ["next", "repeat", "complete"],
        "intentField": "next_action.action",
        "fallbackIntent": "next",
        "handoffFields": ["progress.completed_files", "progress.pending_tasks"]
      },
      "transitions": {
        "next": { "target": "continuation.issue" },
        "repeat": { "target": "continuation.issue" },
        "complete": { "target": "complete.issue" }
      }
    }
  }
}
```

## 厳格な Step 定義要件

**すべての Flow Step は `structuredGate` と `transitions`
を定義しなければならない。** 暗黙のフォールバックは一切許可されない。

### Entry Step の設定

- 初回 iteration: `entryStepMapping[completionType]` または `entryStep` で Step
  を決定
- **どちらも未定義の場合はエラー**（暗黙の `initial.{completionType}`
  フォールバックは無効）

```
[StepFlow] No entry step configured for completionType "issue".
Define either "entryStepMapping.issue" or "entryStep" in steps_registry.json.
```

### ロード時検証

Runner は steps_registry.json をロードする際、すべての Flow Step（`section.*`
を除く）に `structuredGate` と `transitions` が定義されていることを検証する。
検証に失敗した場合はエラー:

```
[StepFlow] Flow validation failed. All Flow steps must define structuredGate and transitions.
Steps missing structuredGate: initial.issue, continuation.issue
Steps missing transitions: initial.issue
See agents/docs/design/08_step_flow_design.md for requirements.
```

### 実行時検証

- 2 回目以降: Structured Gate のルーティング結果 (`currentStepId`) を使用
- ルーティングが発生しない場合（`structuredGate` 未定義など）、次 iteration
  でエラー

```
[StepFlow] No routed step ID for iteration N.
All Flow steps must define structuredGate with transitions.
Check steps_registry.json for missing gate configuration.
```

これにより、設定ミスが即座に検出され、暗黙のフォールバックによる不正動作を防ぐ。

### No Intent ⇒ Abort ルール (R4)

Iteration > 1 で intent が生成されない場合（structured output がない、または
`next_action.action` が解析できない場合）、Flow は即座に中断する。これにより、
entry step を無限にリトライする状態を防ぐ。

```
[StepFlow] No intent produced for iteration 3 on step "continuation.issue".
Flow steps must produce structured output with a valid intent.
Check that the step's schema includes next_action.action and the LLM returns valid JSON.
```

**注意**: Schema 解決失敗（`schemaResolutionFailed`）の場合はこのチェックが免除
される。Schema 失敗は別途 2-strike ルールで処理される。

このルールは Fail-Fast Before Retry の原則に基づく。Retry は Schema が正しく
解決され、LLM が有効な JSON を返した上で行われるべきであり、無効な状態での retry
は設定ミスを隠蔽するだけである。

`section.*` プレフィックスの Step（例:
`section.projectcontext`）はテンプレートセクションであり、Flow Step ではないため
`structuredGate` は不要。

### Prompt / C3L の契約

- **すべての Flow Step は C3L プロンプトを持つ。** ディレクトリ構造は
  `.agent/<agent>/prompts/steps/{c2}/{c3}/f_{edition}[ _{adaptation} ].md`
  を必須とし、 `initial.externalState` なら
  `steps/initial/externalState/f_default.md` が存在する。
- `iterator-steps` など breakdown 設定の `layerType` には新しい `<c3>` 名称を
  必ず追加する。ここに列挙されない Step は `runBreakdown` が “no data” を返し、
  Flow 全体が fallback テンプレートへ戻ってしまう。設定ミスを設計で許容しない。
- Fallback プロンプトは開発初期の安全装置に過ぎず、Step Flow として完成した
  ルートでは **fallback 禁止** が原則。C3L 側で解決できなければ、その Step は
  存在しないものとして扱う。

### Schema Fail-Fast ルール

- すべての Flow Step は `outputSchemaRef` を持ち、`schema` には JSON Pointer
  (`#/definitions/<stepId>`) を指定する。Pointer とファイル上の `definitions`
  が一致しない場合、Iteration は開始されず即座にエラーになる。
- `stepId` プロパティには `const` もしくは `enum` 制約を付け、LLM が別 Step 名を
  返した瞬間に SchemaValidation が失敗するようにする。Flow が
  `initial.externalState` を実行しているのに `initial.issue`
  を返す、といった状態を仕様上許可しない。
- SchemaResolver が Pointer を解決できない場合、Step は
  `StructuredOutputUnavailable` として扱われ、同じ Step で 2
  回連続して失敗すると Flow 全体を `FAILED_SCHEMA_RESOLUTION` で停止する。
- この挙動により、構造化出力が無いままのループは発生せず、設定ミスは
  初期段階で顕在化する。

## StructuredGate の仕組み

1. AI は structured output で `next_action.action` を返す
2. `StepGateInterpreter` が `intentField` のパスから intent を抽出
3. intent を `GateIntent` ("next" | "repeat" | "jump" | "complete" | "abort")
   にマッピング
4. `WorkflowRouter` が `transitions` から次の Step を決定
5. `handoffFields` のデータを StepContext に蓄積

```typescript
// StepGateInterpreter
const interpretation = interpreter.interpret(structuredOutput, stepDef);
// interpretation: { intent: "next", handoff: { understanding: "...", approach: "..." } }

// WorkflowRouter
const routing = router.route(stepId, interpretation);
// routing: { nextStepId: "continuation.issue", signalCompletion: false }
```

## Intent マッピング

AI 応答の `next_action.action` から GateIntent への変換:

| AI response | GateIntent |
| ----------- | ---------- |
| `continue`  | `next`     |
| `complete`  | `complete` |
| `retry`     | `repeat`   |
| `escalate`  | `abort`    |
| `wait`      | `repeat`   |

## Prompt 呼び出しルール

- すべての Step は C3L 形式で参照する。Flow ループはプロンプトを直接解決せず、
  Completion Handler (`StepMachineCompletionHandler`) が Step ID に基づいて
  PromptResolver を呼び出す。
- PromptResolver は `.agent/<agent>/prompts/steps/{c2}/{c3}/...`
  を探索し、見つから なければエラーとする。Fallback
  は開発時の安全策に限定し、運用時には無効化 して構造の一貫性を担保する。
- C3L 設定 (`.agent/climpt/config/<agent>-steps*.yml`) で `layerType` と
  `directiveType` を正しく設定することで、breakdown が Step Flow
  の構造をそのまま反映する。
- ユーザーは docs/ 以下を編集するだけで Step の内容を差し替えられる一方、
  ルートとなる C3L ファイルが無い Step は Flow に追加しない（設計の簡潔さを
  守るため）。

## handoff の契約

| ルール                         | 理由                                   |
| ------------------------------ | -------------------------------------- |
| Step ごとに handoffFields 宣言 | 暗黙共有をやめ、再利用可能性を高める   |
| StepContext に蓄積             | Key 衝突を防ぎ、参照元を即時に追跡可能 |
| Completion でも読み取る        | 最終報告で必要な情報を欠かさないため   |

## Flow ループでの使われ方

```typescript
// 1. Completion Handler が現在 Step ID をもとにプロンプトを構築
const prompt = iteration === 1
  ? await completionHandler.buildInitialPrompt()
  : await completionHandler.buildContinuationPrompt(iteration - 1, lastSummary);

// 2. LLM 実行
const response = sdk.complete(prompt);

// 3. Structured Gate による遷移判定
const stepDef = registry.steps[currentStepId];
const interpretation = stepGateInterpreter.interpret(
  response.structuredOutput,
  stepDef,
);
const routing = workflowRouter.route(currentStepId, interpretation);

// 4. Handoff データを蓄積
if (interpretation.handoff) {
  stepContext.set(currentStepId, interpretation.handoff);
}

// 5. 次の Step へ遷移または完了
if (routing.signalCompletion) {
  return complete();
}
currentStepId = routing.nextStepId;
```

Flow ループ自身は Step ID と handoff を管理するだけで、プロンプト解決は
Completion Handler に委譲される。これにより Runner は Step が宣言した遷移と
handoff にのみ 集中し、余計な複雑さを増やさない。

## 完了との関係

- Step Flow は Completion Loop
  へ「完了シグナル」「handoff」「エビデンス」を渡す役目のみ
- 完了処理が必要な場合でも Flow 側にロジックを書かず、Completion Loop に C3L
  プロンプトと schema で任せる

Step Flow Design は、二重ループの中の Flow 部分を視覚化した契約であり、機能美
を壊さないための最小限の図面である。
