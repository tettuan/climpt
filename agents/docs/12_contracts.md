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

### 実行

```
run(options) → AgentResult

入力:    { cwd: string, args: Record, plugins?: Plugin[] }
出力:    実行結果
副作用:  ループ実行、LLM 呼び出し、ファイル操作
前提:    定義が有効
保証:    必ず Result を返す（例外で終わらない）
```

## 判定の契約

### 完了判定

```
CompletionValidator.validate(conditions) → CompletionValidationResult

入力:    完了条件の配列
出力:    { valid: boolean, pattern?: string, params?: Record }
副作用:  コマンド実行（git status, deno task test 等）
保証:    valid=false ⇒ pattern が設定される
```

### 形式検証

```
FormatValidator.validate(summary, format) → FormatValidationResult

入力:    IterationSummary（assistantResponses・structuredOutput 含む）、ResponseFormat（形式指定）
出力:    { valid: boolean, error?: string, extracted?: unknown }
副作用:  なし
```

### CompletionHandler

```
CompletionHandler インターフェース

setCurrentSummary(summary) → void
入力:    IterationSummary（structuredOutput 含む）
出力:    なし
副作用:  内部状態の更新（lastSummary）
用途:    isComplete() 呼び出し前に現在の iteration 情報を渡す

isComplete() → Promise<boolean>
入力:    なし（内部状態を使用）
出力:    完了フラグ
副作用:  外部コマンド実行（git status, gh issue view 等）
保証:    AI 宣言と外部条件の両方を考慮
```

**Structured Output 統合**:

```
判定ロジック（IssueCompletionHandler）:

① getStructuredOutputStatus() で AI 宣言を取得
   - status === "completed"
   - next_action.action === "complete"

② 外部条件をチェック
   - GitHub Issue が CLOSED か
   - git working directory が clean か

③ 統合判定
   - AI 宣言 && !外部条件 → false（リトライへ）
   - 外部条件 → true
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

### CompletionValidationResult

```typescript
interface CompletionValidationResult {
  valid: boolean;
  pattern?: string; // 失敗パターン名
  params?: Record<string, unknown>; // 抽出パラメータ
}

// 不変条件:
// valid=true  ⇒ pattern は undefined
// valid=false ⇒ pattern は設定される
```

### FormatValidationResult

```typescript
interface FormatValidationResult {
  valid: boolean;
  error?: string; // エラーメッセージ（単一）
  extracted?: unknown; // 抽出されたデータ
}
```

## StepContext / InputSpec（データ契約）

Flow ループが渡すハンドオフを単なる Map ではなく契約として固定する。実装は
`agents/loop/step-context.ts` の `StepContextImpl` で提供され、AI 複雑性の増大を
防ぐために「宣言されたものだけが次工程へ進む」という秩序を保証する。

### StepContext

```typescript
interface StepContext {
  outputs: Map<string, Record<string, unknown>>;
  set(stepId: string, data: Record<string, unknown>): void;
  get(stepId: string, key: string): unknown | undefined;
  toUV(inputs: InputSpec): Record<string, string>;
}
```

- **What**: Step ごとの出力を `uv-<stepId>_<key>`
  にマッピングする単一の共有倉庫。
- **Why**: 暗黙共有を禁止し、Completion Loop
  や監査ログが「どこで生まれた値か」を
  即座にトレースできるようにする（`ai-complexity` のエントロピー対策）。

### InputSpec

```typescript
interface InputSpec {
  [variable: string]: {
    from?: string; // "stepId.key"
    required?: boolean; // デフォルト true
    default?: unknown; // required=false の場合のみ
  };
}
```

- **Resolution rules**:
  - required=true かつ値なし ⇒ Error（Flow が stop し原因を report）
  - required=false かつ値なし ⇒ default を使用
- **Why**: 参照元を `stepId.key` 形式で明示することで、Step Flow 設計図と実装を
  1:1 に保ち、手当たり次第の変数参照による複雑化を避ける。

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

worktree 機能は CLI と統合済み。詳細は `11_core_architecture.md` を参照。

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
