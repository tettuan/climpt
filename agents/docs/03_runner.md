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
   - CompletionHandler（完了判定）
   - PromptResolver（プロンプト解決）
   - ActionExecutor（アクション実行、省略可）

3. ループ実行
   while (!complete) {
     prompt = 解決()
     response = LLM 問い合わせ()
     actions = 検出・実行()
     complete = 判定()
   }

4. 結果返却
   { success, reason, iterations }
```

## コンポーネント

### CompletionHandler

完了判定を行う。

```
check(context) → { complete, reason? }

入力:    イテレーション情報、レスポンス
出力:    完了状態と理由
副作用:  内部フラグ更新
```

### PromptResolver

プロンプトを解決する。

```
resolve(stepId, variables) → string

入力:    ステップ ID、変数
出力:    解決済みプロンプト
副作用:  ファイル読み込み
```

### ActionExecutor

アクションを実行する（省略可）。

```
execute(actions) → ActionResult[]

入力:    検出されたアクション
出力:    実行結果
副作用:  外部操作（Issue 作成等）
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
