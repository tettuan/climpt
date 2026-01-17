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

| 要素                           | 説明                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| `stepId`                       | `initial.<c3>` や `continuation.<c3>` 形式で識別              |
| `c2`, `c3`, `edition`          | C3L パス構成要素。PromptResolver が prompt ファイルを解決する |
| `fallbackKey`                  | 組み込みプロンプトへのフォールバックキー                      |
| `structuredGate`               | AI 応答から intent を抽出し、遷移を決定するための設定         |
| `transitions`                  | intent から次の Step を決定するマッピング                     |
| `structuredGate.handoffFields` | 次の Step に渡すデータのパス（JSON path 形式）                |

## Step Flow のレイアウト

```
initial.issue ──> continuation.issue
     │                   │
     ▼                   ▼
  complete.issue   (repeat or complete)
```

- `handoffFields` で指定したデータは StepContext に蓄積される
- completion 判定は `structuredGate.allowedIntents` に `complete` を含め、 AI が
  `next_action.action: "complete"` を返すことで signal を送る

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
        "schema": "initial.issue"
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

- すべての Step は C3L 形式で参照する
- Runner は docs/05_prompt_system.md
  の規則に従い、`prompts/<c1>/<c2>/<c3>/f_<edition>.md` を読み込むのみ
- ユーザーは docs/ 以下を編集するだけで Step の内容を差し替えられる

## handoff の契約

| ルール                         | 理由                                   |
| ------------------------------ | -------------------------------------- |
| Step ごとに handoffFields 宣言 | 暗黙共有をやめ、再利用可能性を高める   |
| StepContext に蓄積             | Key 衝突を防ぎ、参照元を即時に追跡可能 |
| Completion でも読み取る        | 最終報告で必要な情報を欠かさないため   |

## Flow ループでの使われ方

```typescript
// 1. 現在の Step 定義を取得
const stepDef = registry.steps[currentStepId];

// 2. プロンプト解決と AI 呼び出し
const prompt = resolver.resolve(stepDef, handoff);
const response = sdk.complete(prompt);

// 3. Structured Gate による遷移判定
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

Runner は Step が宣言したルール以外は知らず、Flow
ループが複雑になる余地を残さない。

## 完了との関係

- Step Flow は Completion Loop
  へ「完了シグナル」「handoff」「エビデンス」を渡す役目のみ
- 完了処理が必要な場合でも Flow 側にロジックを書かず、Completion Loop に C3L
  プロンプトと schema で任せる

Step Flow Design は、二重ループの中の Flow 部分を視覚化した契約であり、機能美
を壊さないための最小限の図面である。
