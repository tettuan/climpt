# 契約

境界における約束事。この契約に従う限り、内部実装は自由に変更できる。

## 契約の形式

```
入力:    何を受け取るか
出力:    何を返すか
副作用:  何が変わるか
エラー:  何が失敗するか
```

## 設定の契約

### 読み込み

```
load(path) → AgentDefinition | Error

入力:    存在するディレクトリパス
出力:    パース済みの Agent 定義
副作用:  なし（読み取りのみ）
エラー:  NotFound, ParseError
```

### 検証

```
validate(definition) → ValidationResult

入力:    load() の戻り値
出力:    { valid: boolean, errors: Error[] }
副作用:  なし
保証:    valid=true ⇔ errors=[]
```

## 実行の契約

### 開始

```
start(options) → void | Error

入力:    実行オプション（cwd, args）
出力:    なし
副作用:  状態を「準備」から「実行中」へ
前提:    状態が「準備」
エラー:  AlreadyStarted
```

### 実行

```
run() → AgentResult

入力:    なし
出力:    実行結果
副作用:  ループ実行、状態更新
前提:    start() 完了済み
保証:    必ず Result を返す（例外で終わらない）
```

### 停止

```
stop() → AgentResult

入力:    なし
出力:    最終結果
副作用:  リソース解放
保証:    冪等（何度呼んでも安全）
```

## 判定の契約

### 完了判定

```
check(context) → CompletionResult

入力:    現在のイテレーション情報
出力:    { complete: boolean, reason?: string }
副作用:  内部フラグ更新
保証:    complete=true ⇒ reason が設定される
```

### 遷移判定

```
transition(result) → string | "complete"

入力:    ステップ実行結果
出力:    次のステップ ID または完了
副作用:  なし
```

## 接続の契約

### LLM 問い合わせ

```
query(prompt, options) → QueryResult | Error

入力:    プロンプト文字列、セッションオプション
出力:    LLM 応答
副作用:  API 呼び出し
エラー:  ConnectionError（回復可能）
         RateLimitError（回復可能）
         SessionExpired（新規セッションで継続可能）
```

### プロンプト解決

```
resolve(ref, variables) → string | Error

入力:    C3L 参照、置換変数
出力:    解決済みプロンプト文字列
副作用:  ファイル読み込み
エラー:  NotFound
保証:    空文字は返さない
```

## データの契約

### AgentResult

```typescript
interface AgentResult {
  success: boolean;
  reason: string; // 完了/エラーの理由
  iterations: number; // 実行回数
}

// 不変条件:
// success=true  ⇒ reason は完了理由
// success=false ⇒ reason はエラー内容
```

### StepContext

```typescript
interface StepContext {
  outputs: Record<stepId, Record<key, value>>;
}

// 操作:
// set(stepId, data)  - ステップ出力を登録（上書き）
// get(stepId, key)   - 出力を取得（なければ undefined）
// toUV(inputs)       - UV 変数形式に変換
```

### InputSpec

```typescript
interface InputSpec {
  [stepId.key]: {
    required?: boolean; // デフォルト: true
    default?: value; // required=false の場合
  };
}

// 解決規則:
// required=true  かつ欠損 ⇒ Error
// required=false かつ欠損 ⇒ default を使用
```

## エラーの契約

### 分類

```
AgentError（基底）
├── ConfigurationError（回復不能）
│     設定が不正。起動しない。
│
├── ExecutionError（状況による）
│     実行中のエラー。リトライで回復可能な場合あり。
│
└── ConnectionError（回復可能）
      外部接続のエラー。リトライ/フォールバック。
```

### 回復

```
回復可能:
  1. リトライ（最大 N 回）
  2. フォールバック（代替リソース）
  3. スキップ（オプション機能のみ）

回復不能:
  1. 即座に停止
  2. Result.reason に記録
  3. 呼び出し元に伝播
```

## 外部連携の契約

### 派生元ブランチ解決

```
優先順位:
1. コマンドライン引数 --origin
2. Issue のカスタムフィールド
3. Project のカスタムフィールド
4. 設定ファイル

すべて未設定 ⇒ エラー（暗黙のデフォルトなし）
```

### Issue-Branch-Worktree-Instance

```
1:1:1:1 対応

Issue #N
  └── branch: feature/issue-N
        └── worktree: .worktrees/issue-N/
              └── instance: agent-N-{timestamp}

違反:
- 同一ブランチで複数 Agent ⇒ 起動エラー
```

## 互換性の契約

### バージョン

```
{ "version": "1.0", ... }

メジャー変更 ⇒ 後方互換なし
マイナー変更 ⇒ 後方互換
未指定       ⇒ "1.0" として扱う
```

### 非推奨化

```
1. 警告出力（1 マイナーバージョン）
2. エラーに変更（次メジャーバージョン）
3. 削除（その次のメジャーバージョン）
```
