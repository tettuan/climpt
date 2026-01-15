# Runner

Agent 実行エンジン。定義を読み込み、ループを実行する。

## 契約

### 読み込み

```
load(agentName, cwd) → AgentDefinition | Error

入力:    Agent 名、作業ディレクトリ
出力:    パース済み定義
副作用:  なし
エラー:  NotFound, ParseError, ValidationError
```

### 実行

```
run(options) → AgentResult

入力:    { cwd, args, plugins? }
出力:    実行結果
副作用:  LLM 呼び出し、ファイル操作
前提:    定義が有効
```

### 結果

```typescript
interface AgentResult {
  success: boolean;
  reason: string;
  iterations: number;
}
```

## 実行フロー

```
1. 定義読み込み
   load(name) → definition

2. コンポーネント初期化
   - CompletionValidator（完了条件検証）
   - FormatValidator（出力形式検証、オプション）
   - PromptResolver（プロンプト解決）
   - RetryHandler（リトライプロンプト生成）

3. ループ実行
   while (!complete && iteration < maxIterations) {
     prompt = 解決()
     response = LLM 問い合わせ()
     summary = サマリー生成(response)

     // 完了宣言の検出
     if (hasCompletionSignal(response)) {
       // 形式検証（responseFormat が設定されている場合のみ）
       if (step.check.responseFormat) {
         formatResult = FormatValidator.validate(response)
         if (!formatResult.valid && formatRetryCount < maxFormatRetries) {
           formatRetryCount++
           retryPrompt = 形式エラープロンプト生成()
           continue
         }
       }

       // Structured Output を CompletionHandler に渡す
       completionHandler.setCurrentSummary(summary)

       // 完了条件検証
       validation = CompletionValidator.validate(conditions)
       if (validation.valid) {
         complete = true
       } else {
         retryPrompt = RetryHandler.buildRetryPrompt(validation.pattern)
       }
     }
   }

4. 結果返却
   { success, reason, iterations }
```

> **注**: FormatValidator は `steps_registry.json` で `responseFormat`
> が定義されている ステップでのみ実行される。`complete.issue` ステップには
> `responseFormat` が設定されており、Issue 完了時に JSON 形式の検証が行われる。

## コンポーネント

### CompletionValidator

完了条件を検証する。詳細は `08_structured_outputs.md` を参照。

```
validate(conditions) → ValidationResult

入力:    完了条件の配列（steps_registry.json の completionConditions）
出力:    検証結果（成功 or 失敗パターン + パラメータ）
副作用:  コマンド実行（git status, deno task test 等）
```

### CompletionHandler と Structured Output 連携

`CompletionHandler` は `setCurrentSummary()` メソッドで現在の iteration の
structured output を受け取る。これにより：

1. AI の宣言（`status`, `next_action`）を完了判定に活用
2. AI 宣言と外部条件の乖離を検出
3. 次 iteration への継続情報として伝達

```
setCurrentSummary(summary) → void

入力:    IterationSummary（structuredOutput 含む）
出力:    なし
副作用:  内部状態の更新
```

詳細は `08_structured_outputs.md` の「Structured Output
の完了判定への統合」を参照。

### FormatValidator（オプション）

LLM 出力の形式を検証する。`steps_registry.json` で `responseFormat`
が定義されている ステップでのみ実行される。

```
validate(summary, format) → FormatValidationResult

入力:    IterationSummary（検出アクション・応答含む）、ResponseFormat（形式指定）
出力:    { valid: boolean, error?: string, extracted?: unknown }
副作用:  なし
前提:    step.check.responseFormat が定義されている
```

**検証タイプ**:

| タイプ         | 説明                        |
| -------------- | --------------------------- |
| `action-block` | agent-action コードブロック |
| `json`         | JSON スキーマ準拠           |
| `text-pattern` | テキストパターンマッチ      |

> **設定例**: `complete.issue` ステップでは `responseFormat` に `json` タイプが
> 設定されており、`action` と `validation` フィールドの検証が行われる。

### PromptResolver

プロンプトを解決する。

```
resolve(stepId, variables) → string

入力:    ステップ ID、変数
出力:    解決済みプロンプト
副作用:  ファイル読み込み
```

### RetryHandler

失敗パターンに応じたリトライプロンプトを生成する。

```
buildRetryPrompt(pattern, params) → string

入力:    失敗パターン名、抽出パラメータ
出力:    C3L で解決されたリトライプロンプト
副作用:  なし
```

## リトライ制御

### 形式リトライ

LLM 出力が期待形式に合致しない場合のリトライ。

```
設定:
  step.check.onFail.maxRetries (デフォルト: 3)

動作:
  formatRetryCount < maxRetries → リトライプロンプトで続行
  formatRetryCount >= maxRetries → 警告ログを出力し、エラーを記録して続行
                                    （中断はしない）
```

### 完了条件リトライ

外部検証（テスト、lint 等）が失敗した場合のリトライ。

```
設定:
  step.onFailure.maxAttempts (デフォルト: 3)

動作:
  失敗パターンに応じた C3L プロンプトで修正を指示
  maxAttempts 超過 → 中断
```

## Worktree 連携

設計上、各 Agent インスタンスは独立した worktree で動作する。

```
1 Issue = 1 Branch = 1 Worktree = 1 Agent Instance

動作:
  Agent 定義で worktree.enabled = true の場合
  → setupWorktree() で作業ディレクトリを自動作成
  → --branch 未指定時はブランチ名を自動生成（例: feature/docs-20260105-143022）
  → run({ cwd: worktreePath }) で worktree 内で実行
  → 成功時は cleanupWorktree() で worktree をローカルマージ後削除

オプション:
  --branch <name>       使用するブランチ名（省略時は自動生成）
  --base-branch <name>  派生元ブランチ（省略時は現在のブランチ）
```

> **制限**: 現在の実装はローカルのみ。リモート push や PR
> 作成は手動で行う必要がある。 失敗時（`result.success = false`）は worktree
> が残存するため、手動クリーンアップが必要。 詳細は `11_core_architecture.md`
> の「ライフサイクル制限」を参照。

## 依存性注入

builder.ts で依存性を注入する。

```typescript
interface RunnerDependencies {
  logger: Logger;
  completionHandler: CompletionHandler;
  promptResolver: PromptResolver;
  actionFactory?: ActionSystemFactory;
  completionValidator?: CompletionValidator;
  retryHandler?: RetryHandler;
}

// カスタム依存性での実行
const runner = new AgentRunner(definition, {
  logger: customLogger,
  completionValidator: mockValidator,
});
```

## SDK 接続

Claude Agent SDK を使用。

```
query(prompt, options) → response

options:
  - sessionId: セッション継続
  - tools: 許可ツール
  - permissionMode: 権限モード
  - outputFormat: 構造化出力スキーマ
```

## エラー処理

```
回復可能:
  - 接続タイムアウト → リトライ
  - レート制限 → 待機してリトライ
  - セッション期限切れ → 新規セッション
  - 形式エラー → 形式リトライ
  - 完了条件失敗 → 条件リトライ

回復不能:
  - 設定エラー → 即座に停止
  - ハード上限超過 → 即座に停止
  - リトライ上限超過 → 即座に停止
```

## 使用例

```bash
# 統一 Agent Runner
deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123

# GitHub Project から Issue を処理
deno run -A agents/scripts/run-agent.ts --agent iterator --project 5 --label docs

# Worktree 指定（worktree.enabled = true の場合）
deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123 --branch feature/issue-123

# 利用可能な Agent 一覧
deno run -A agents/scripts/run-agent.ts --list
```
