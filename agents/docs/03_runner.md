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
   - PromptResolver（プロンプト解決）
   - RetryHandler（リトライプロンプト生成）

3. ループ実行
   while (!complete) {
     prompt = 解決()
     response = LLM 問い合わせ()
     validation = 完了条件検証()
     if (validation.valid) {
       complete = true
     } else {
       retryPrompt = リトライプロンプト生成(validation.pattern)
     }
   }

4. 結果返却
   { success, reason, iterations }
```

## コンポーネント

### CompletionValidator

完了条件を検証する。詳細は `08_structured_outputs.md` を参照。

```
validate(conditions) → ValidationResult

入力:    完了条件の配列（steps_registry.json の completionConditions）
出力:    検証結果（成功 or 失敗パターン + パラメータ）
副作用:  コマンド実行（git status, deno task test 等）
```

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

## SDK 接続

Claude Agent SDK を使用。

```
query(prompt, options) → response

options:
  - sessionId: セッション継続
  - tools: 許可ツール
  - permissionMode: 権限モード
```

## エラー処理

```
回復可能:
  - 接続タイムアウト → リトライ
  - レート制限 → 待機してリトライ
  - セッション期限切れ → 新規セッション

回復不能:
  - 設定エラー → 即座に停止
  - ハード上限超過 → 即座に停止
```

## 使用例

```bash
# CLI
deno run -A agents/iterator/mod.ts --issue 123

# タスク
deno task agent:iterator --issue 123
```
