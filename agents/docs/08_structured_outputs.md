# Closer - 完了判定サブシステム

AI の structured output を中核とした完了判定機構。

## 概要

### 階層ループ構造

Agent の完了処理は階層的なループ構造を持つ。

```
┌─────────────────────────────────────────────────────────────┐
│  メインループ（Agent）                                       │
│  ────────────────────────────────────────────────────────── │
│  while (!agentComplete) {                                   │
│    prompt = resolvePrompt()                                 │
│    response = queryLLM()                                    │
│                                                             │
│    ┌───────────────────────────────────────────────────┐   │
│    │  サブループ（Closer）                             │   │
│    │  ──────────────────────────────────────────────── │   │
│    │  while (!stepComplete) {                          │   │
│    │    checklist = generateChecklist(structuredOutput)│   │
│    │    verification = verifyCompletion(checklist)     │   │
│    │    stepComplete = verification.allComplete        │   │
│    │  }                                                │   │
│    └───────────────────────────────────────────────────┘   │
│                                                             │
│    agentComplete = closer.result.complete                   │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

**メインループ**: Agent 全体のタスク遂行 **サブループ（Closer）**:
ステップごとの完了検証

### 設計原則

```
AI structured output → Closer prompt → AI checklist 生成 → 完了判定
```

**Closer が行うこと**:

- AI の structured output を入力として受け取る
- C3L プロンプトで完了チェックリスト生成を依頼
- AI に structured output で検証を依頼
- 完了状態を報告

**Closer が行わないこと**:

- テストランナー出力の直接パース
- シェルコマンドの実行
- 外部状態（git, GitHub 等）の直接チェック

## AI Structured Output

### 入力と出力

```
┌──────────────────────┐      ┌──────────────────────┐
│  CloserInput         │      │  CloserResult        │
│  ──────────────────  │      │  ──────────────────  │
│  structuredOutput    │  →   │  complete: boolean   │
│  stepId              │      │  output: {...}       │
│  c3l: { c2, c3 }     │      │  promptUsed?: string │
│  context?: {...}     │      │  error?: string      │
└──────────────────────┘      └──────────────────────┘
```

### Closer の出力スキーマ

AI は以下のスキーマに従った JSON を返す。

```typescript
interface CloserStructuredOutput {
  /** 完了に必要なタスクのチェックリスト */
  checklist: ChecklistItem[];

  /** すべてのタスクが完了したか */
  allComplete: boolean;

  /** 完了状態の要約 */
  summary: string;

  /** 未完了時の残作業 */
  pendingActions?: string[];

  /** 確信度（0-1） */
  confidence: number;
}

interface ChecklistItem {
  /** タスク識別子 */
  id: string;

  /** タスクの説明 */
  description: string;

  /** 完了フラグ */
  completed: boolean;

  /** 根拠または理由 */
  evidence?: string;
}
```

### 完了判定ロジック

```typescript
const complete = output.allComplete && output.confidence >= 0.8;
```

両方の条件を満たす場合のみ完了とみなす:

1. AI がすべてのチェック項目を完了と判定
2. AI の確信度が 80% 以上

## C3L 連携

### パス構造

```
.agent/{agentId}/prompts/steps/{c2}/{c3}/

c2 = "complete"  # 完了処理
c3 = "issue"     # 対象タイプ（例: issue, pr, task）
```

### ファイル構造例

```
.agent/iterator/prompts/
└── steps/
    └── complete/
        └── issue/
            ├── f_default.md           # デフォルトプロンプト
            └── f_default_retry.md     # リトライ用
```

### プロンプト例

**`steps/complete/issue/f_default.md`**

```markdown
---
params:
  - step_id
---

## 完了判定

以下の structured output を分析し、タスクの完了状態を検証してください。

### 入力データ

{{input}}

### チェック項目

1. コード実装が完了しているか
2. テストが通過しているか
3. 変更がコミットされているか

各項目について completed: true/false と evidence を出力してください。
```

## 実装

### Closer クラス

```typescript
import { Closer, createCloser } from "./closer.ts";

const closer = createCloser({
  workingDir: Deno.cwd(),
  agentId: "iterator",
  logger: console,
});

const result = await closer.check(
  {
    structuredOutput: previousAIResponse,
    stepId: "complete.issue",
    c3l: { c2: "complete", c3: "issue" },
    context: { issueNumber: 123 },
  },
  queryFn,
);

if (result.complete) {
  // 完了処理
} else {
  // リトライまたは残作業処理
  console.log(result.output.pendingActions);
}
```

### QueryFn インターフェース

```typescript
type CloserQueryFn = (
  prompt: string,
  options: { outputSchema: Record<string, unknown> },
) => Promise<{
  structuredOutput?: Record<string, unknown>;
  error?: string;
}>;
```

Closer は AI への問い合わせを `queryFn` に委譲する。これにより:

- SDK の詳細を Closer から分離
- テスト時のモック注入が容易
- 異なる LLM バックエンドへの対応が可能

## フロー

### 完了判定フロー

```
Step 実行
  │
  ├─ LLM ループ（タスク遂行）
  │
  ├─ structuredOutput 取得
  │
  └─ Closer.check()
       │
       ├─ C3L プロンプト解決
       │   └─ steps/complete/{c3}/f_default.md
       │
       ├─ AI に検証依頼（structured output）
       │   └─ outputSchema: CLOSER_OUTPUT_SCHEMA
       │
       ├─ 応答パース・検証
       │
       └─ 完了判定
            ├─ allComplete && confidence >= 0.8 → 完了
            └─ それ以外 → 未完了（pendingActions 参照）
```

### リトライフロー

```
未完了判定
  │
  ├─ pendingActions から残作業を抽出
  │
  ├─ 次の iteration へ渡す
  │   └─ formatIterationSummary() で要約
  │
  └─ LLM に残作業を指示
       │
       └─ 再度 Closer.check()
```

## Runner との統合

### CompletionHandler としての統合

```typescript
class CloserCompletionHandler implements CompletionHandler {
  private closer: Closer;
  private lastResult?: CloserResult;

  async isComplete(): Promise<boolean> {
    return this.lastResult?.complete ?? false;
  }

  async checkCompletion(
    summary: IterationSummary,
    queryFn: CloserQueryFn,
  ): Promise<void> {
    this.lastResult = await this.closer.check(
      {
        structuredOutput: summary.structuredOutput ?? {},
        stepId: this.stepConfig.stepId,
        c3l: {
          c2: this.stepConfig.c2,
          c3: this.stepConfig.c3,
        },
      },
      queryFn,
    );
  }

  getCompletionDescription(): string {
    if (!this.lastResult) return "Not checked";
    return this.lastResult.output.summary;
  }
}
```

### 無限ループ防止

1. **確信度閾値**: `confidence >= 0.8` で低確信の完了宣言を防止
2. **チェックリスト検証**: 個別項目の `completed` フラグで部分的進捗を追跡
3. **pendingActions**: 未完了時の具体的な残作業を AI が明示
4. **iteration 間の継承**: 前回の判定結果を次 iteration に伝達

## 型定義

```typescript
// 入力
interface CloserInput {
  structuredOutput: Record<string, unknown>;
  stepId: string;
  c3l: {
    c2: string;
    c3: string;
  };
  context?: Record<string, unknown>;
}

// 結果
interface CloserResult {
  complete: boolean;
  output: CloserStructuredOutput;
  promptUsed?: string;
  error?: string;
}

// オプション
interface CloserOptions {
  workingDir: string;
  agentId: string;
  logger?: CloserLogger;
}
```

## まとめ

| 観点       | 設計方針                                   |
| ---------- | ------------------------------------------ |
| 完了判定   | AI structured output による自己検証        |
| 外部状態   | 直接チェックしない（AI の報告を信頼）      |
| 階層ループ | メインループ内のサブループとして完了を検証 |
| C3L 連携   | steps/{c2}/{c3}/ でプロンプト解決          |
| 確信度     | 0.8 以上で完了（低確信は未完了扱い）       |
| 残作業     | pendingActions で次 iteration に引き継ぎ   |
| 拡張性     | queryFn 注入で SDK から分離                |
