# Closer - 完了判定サブシステム

> AI による完了判定を行うサブシステム。C3L プロンプトを使用してチェックリスト
> 形式で完了状態を検証する。

## 概要

### 階層ループ構造

Agent は 1 イテレーションごとに main loop を進める。Structured Output が
`status: "completed"` もしくは `next_action.action: "complete"` を返した時だけ、
完了サブループに移行する。

```
┌─────────────────────────────────────────────────────────────┐
│  メインループ（Agent）                                       │
│  ────────────────────────────────────────────────────────── │
│  while (!agentComplete) {                                   │
│    prompt  = buildPrompt()                                  │
│    result  = queryLLM()                                     │
│                                                             │
│    if (declaredComplete(result)) {                          │
│      validation = Closer.check(stepContext)                 │
│      if (!validation.complete) {                            │
│        pendingRetryPrompt = buildCloserRetryPrompt(result)  │
│        continue // 次の iteration で再実行                   │
│      }                                                      │
│    }                                                        │
│                                                             │
│    agentComplete = completionHandler.isComplete()           │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

「サブループ」は同期的な while ではなく、`Closer` が追加の SDK
問い合わせを挟み、失敗時は `pendingRetryPrompt` を次の iteration
の入力に使うことで 再試行サイクルを作っている (runner.ts:273-415)。

### 役割分担

- **AgentRunner**: Structured Output から完了宣言を検出し、`Closer` に移譲
- **Closer** (`agents/closer/closer.ts`): C3L プロンプトを使用した AI ベースの
  完了判定。チェックリスト形式で `allComplete` と `pendingActions` を返す
- **CompletionChain** (`agents/runner/completion-chain.ts`): ステップ ID 解決と
  コマンドベースの検証フォールバック
- **CompletionValidator**: `steps_registry.json` の `completionConditions`
  を順番に実行 (コマンド実行・ファイル存在チェック等) し、失敗パターンを抽出
- **RetryHandler**: 検出した `pattern` を C3L (steps/retry/*) に流し、LLM
  へ渡す再実行指示を生成

## データフロー

### Steps Registry と completion step

`.agent/{agentId}/steps_registry.json` に completion step が定義される。例
(抜粋):

```jsonc
{
  "completionSteps": {
    "complete.issue": {
      "c2": "retry",
      "c3": "issue",
      "completionConditions": [
        { "validator": "git-clean" },
        { "validator": "type-check" }
      ],
      "outputSchemaRef": {
        "file": "issue.schema.json",
        "schema": "complete.issue"
      }
    }
  }
}
```

- `c2/c3` は RetryHandler が C3L パスを解決する際に使用 (`steps/retry/issue/…`).
- `outputSchemaRef` があれば structured output 検証を優先し、なければ
  `completionConditions` を実行する。

### Structured Output スキーマ

`.agent/iterator/schemas/issue.schema.json#complete.issue`
は完了レスポンスを定義する。

```jsonc
{
  "required": ["stepId", "status", "summary", "validation"],
  "properties": {
    "status": { "type": "string" },
    "next_action": { "$ref": "common.schema.json#/$defs/nextAction" },
    "validation": {
      "type": "object",
      "required": ["git_clean", "type_check_passed"],
      "properties": {
        "git_clean": { "type": "boolean" },
        "type_check_passed": { "type": "boolean" },
        "tests_passed": { "type": "boolean" },
        "lint_passed": { "type": "boolean" },
        "format_check_passed": { "type": "boolean" }
      }
    },
    "evidence": {
      "properties": {
        "git_status_output": { "type": "string" },
        "type_check_output": { "type": "string" }
      }
    }
  }
}
```

Checklist/pendingActions
ではなく、実際のコマンド結果を構造化して返す設計になっている。

## 検証シーケンス

1. **完了宣言の検出**: `hasAICompletionDeclaration` が `status === "completed"`
   もしくは `next_action.action === "complete"` を見る (runner.ts:1032-1061)。
2. **Closer 呼び出し**: `Closer.check()` が C3L プロンプト
   (`steps/complete/issue/f_default.md`) をロードし、SDK query を実行。
   プロンプトは AI にテスト実行、型チェック、lint、git status、Issue クローズ
   の各項目を確認・実行させる。
3. **結果チェック**: Closer が `allComplete` と `checklist` を返す。
   未完了項目があれば `pendingActions` にまとめられ、`buildCloserRetryPrompt()`
   でリトライプロンプトを生成 (runner.ts:1053-1085)。
4. **フォールバック**: スキーマが未指定の場合は `CompletionValidator.validate()`
   が `completionConditions` の各 validator を
   順番に実行し、失敗パターンと抽出パラメータを返す
   (validators/completion/validator.ts:1-119)。
5. **リトライプロンプト生成**: Closer の場合は `buildCloserRetryPrompt()` が
   チェックリストの未完了項目から直接生成。フォールバック時は
   `RetryHandler.buildRetryPrompt()` が pattern をもとに C3L を読む。

## リトライ制御

- `pendingRetryPrompt` に格納された再実行プロンプトは次の iteration
  開始時にそのまま プロンプトとして使用される (runner.ts:273-290)。
- 再検証が未完了の間は `completionHandler.isComplete()` を呼ばずにスキップし、
  強制的にループを継続する (runner.ts:386-401)。
- rate limit 再試行とは独立しており、completion retry
  はエージェント内部の論理で完結。

## 実装参照

| 関心事                    | ファイル                                                     |
| ------------------------- | ------------------------------------------------------------ |
| 検出〜リトライ制御        | `agents/runner/runner.ts:273-415`                            |
| Closer 呼び出し           | `agents/runner/runner.ts:940-991`                            |
| Closer 本体               | `agents/closer/closer.ts`                                    |
| Closer プロンプト         | `.agent/iterator/prompts/steps/complete/issue/f_default.md`  |
| Closer リトライプロンプト | `agents/runner/runner.ts:1053-1085 (buildCloserRetryPrompt)` |
| 条件バリデータ (fallback) | `agents/validators/completion/validator.ts`                  |
| Retry 用 C3L (fallback)   | `agents/retry/retry-handler.ts`                              |

## まとめ

| 観点             | 現行の動き                                                                      |
| ---------------- | ------------------------------------------------------------------------------- |
| トリガー         | Structured Output の完了宣言 (`status`/`next_action`)                           |
| サブループ実体   | Closer が C3L プロンプトで AI に検証を依頼し、チェックリストを取得              |
| 外部状態チェック | Closer プロンプトが AI に `git status`, `deno check` 等の実行を指示             |
| 失敗時の伝播     | `retryPrompt` を `pendingRetryPrompt` に格納し、次 iteration のプロンプトへ注入 |
| C3L の使い所     | Closer プロンプト (`steps/complete/*`) で完了条件を定義                         |
| 将来拡張         | C3L プロンプトを編集して検証内容を強化可能                                      |
