# 契約

各層の境界における約束事。この契約に従う限り、実装を自由に変更できる。

## 契約の原則

```
契約 = 入力 + 出力 + 副作用 + エラー

入力:    何を受け取るか（型と前提条件）
出力:    何を返すか（型と事後条件）
副作用:  何が変わるか（状態変更、外部影響）
エラー:  何が失敗するか（種類と意味）
```

## 構成層の契約

### load

```typescript
/**
 * @input  agentPath: 存在するディレクトリパス
 * @output AgentDefinition: パース済み定義
 * @副作用  なし（読み取りのみ）
 * @error  NotFound: agent.json が存在しない
 * @error  ParseError: JSON が不正
 */
load(agentPath: string): Promise<AgentDefinition>
```

### validate

```typescript
/**
 * @input  definition: load() の戻り値
 * @output ValidationResult: 検証結果
 * @副作用  なし
 * @保証   valid=true ⇔ errors.length=0
 */
validate(definition: AgentDefinition): ValidationResult
```

### build

```typescript
/**
 * @input  definition: validate() で valid=true の定義
 * @output Execution: 実行可能なインスタンス
 * @副作用  依存オブジェクト生成
 * @error  DependencyError: 依存解決失敗
 */
build(definition: ValidatedDefinition): Execution
```

## 実行層の契約

### start

```typescript
/**
 * @input  options: 実行オプション（cwd, args）
 * @output void
 * @副作用  状態を Created → Started に遷移
 * @前提   状態が Created
 * @error  AlreadyStarted: 2回目以降の呼び出し
 */
start(options: StartOptions): Promise<void>
```

### run

```typescript
/**
 * @input  なし（内部状態を使用）
 * @output AgentResult: 実行結果
 * @副作用  ループ実行、状態更新、外部呼び出し
 * @前提   start() 完了済み
 * @保証   停止後は必ず Result を返す
 */
run(): Promise<AgentResult>
```

### stop

```typescript
/**
 * @input  なし
 * @output AgentResult: 最終結果
 * @副作用  リソース解放、状態を Stopped に遷移
 * @前提   start() 完了済み
 * @保証   2回呼んでも安全（冪等）
 */
stop(): Promise<AgentResult>
```

## 判定層の契約

### 完了判定 (Completion)

```typescript
/**
 * @input  context: 現在のイテレーション情報
 * @output CompletionResult: 完了かどうか
 * @副作用  内部状態更新（完了フラグ、理由）
 * @保証   complete=true ⇒ reason が設定
 */
check(context: CompletionContext): Promise<CompletionResult>

/**
 * @output 最後の check() 結果
 * @副作用  なし（参照のみ）
 */
isComplete(): boolean
getReason(): string
```

### 遷移判定 (StepCheck)

```typescript
/**
 * @input  context: ステップ実行結果
 * @output StepCheckResult: 通過/失敗
 * @副作用  チェックタイプによる（prompt型は LLM 呼び出し）
 */
check(context: StepCheckContext): Promise<StepCheckResult>

/**
 * @input  result: check() の戻り値
 * @output 次のステップ ID（または完了）
 * @副作用  内部位置更新
 */
transition(result: StepCheckResult): string | "complete"
```

## 接続層の契約

### LLM 接続 (SdkBridge)

```typescript
/**
 * @input  prompt: 空でない文字列
 * @input  options: セッション ID、ツール許可など
 * @output QueryResult: LLM 応答
 * @副作用  API 呼び出し、セッション ID 更新
 * @error  ConnectionError: 接続失敗
 * @error  RateLimitError: 制限超過（回復可能）
 * @error  SessionExpired: セッション切断（新規セッションで継続可能）
 */
query(prompt: string, options: QueryOptions): Promise<QueryResult>
```

### プロンプト解決 (PromptResolver)

```typescript
/**
 * @input  ref: パス参照または C3L 参照
 * @input  variables: 置換変数（オプション）
 * @output 解決済みプロンプト文字列
 * @副作用  ファイル読み込み
 * @error  NotFound: ファイルが存在しない
 * @保証   空文字は返さない（NotFound になる）
 */
resolve(ref: PromptReference, variables?: Variables): Promise<string>
```

## データ契約

### AgentResult

```typescript
interface AgentResult {
  success: boolean;
  completionReason: string; // success=true なら完了理由
  error?: string; // success=false ならエラー内容
  iterations: number; // 実行イテレーション数
  summaries: IterationSummary[]; // 各イテレーションの記録
}

// 不変条件:
// - success=true ⇒ completionReason が空でない
// - success=false ⇒ error が空でない
// - iterations === summaries.length
```

### ContextCarry

```typescript
interface ContextCarry {
  previousResponse?: string; // 前イテレーションの LLM 応答
  accumulatedContext?: Record<string, unknown>; // 蓄積データ
}

// 更新契約:
// - 各イテレーション終了時に実行層が更新
// - 判定層は参照のみ（更新しない）
```

### StepContext（ステップ間引き継ぎ）

```typescript
interface StepContext {
  /** 全ステップの出力を蓄積 */
  outputs: Record<string, Record<string, unknown>>;
}

// 操作契約:
// - get(): 存在しないキーは undefined を返す（エラーにしない）
// - set(): 同一ステップの再実行時は上書き（履歴は保持しない）
// - toUvVariables(): 必須入力の欠損時は MissingRequiredInput エラー
```

### OutputSchema（出力スキーマ）

```typescript
interface OutputSchema {
  $namespace: string; // ステップ ID（自動プレフィックス）
  [key: string]: OutputFieldSchema | string;
}

interface OutputFieldSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean; // デフォルト: true
  description?: string;
  default?: unknown; // required=false の場合のデフォルト値
}

// 検証契約:
// - required=true かつ欠損 ⇒ ValidationError
// - 型不一致 ⇒ ValidationError（型変換は行わない）
// - required=false かつ欠損 ⇒ default を使用（default 未設定なら undefined）
```

### InputSpec（入力仕様）

```typescript
interface InputSpec {
  from_step?: string; // 単一ステップからの入力
  from_steps?: string[]; // 複数ステップからの入力
  variables: InputVariableSpec;
}

interface InputVariableSpec {
  [stepDotKey: string]: {
    required?: boolean; // デフォルト: true
    default?: unknown;
    onMissing?: "error" | "default" | "skip"; // デフォルト: "error"
  } | boolean; // true = { required: true }
}

// 解決契約:
// - "measure.height" → stepContext.get("measure", "height")
// - required=true かつ欠損 かつ onMissing="error" ⇒ MissingRequiredInput
// - onMissing="default" ⇒ default 値を使用
// - onMissing="skip" ⇒ UV 変数に含めない
```

## ステップ間引き継ぎ契約

### 出力抽出 (OutputExtractor)

````typescript
/**
 * @input  response: LLM 応答文字列
 * @input  schema: 出力スキーマ定義
 * @output ExtractResult: 抽出結果
 * @副作用  なし
 * @error  ExtractionFailed: JSON ブロックが見つからない
 */
extract(response: string, schema: OutputSchema): ExtractResult

interface ExtractResult {
  ok: boolean;
  data?: Record<string, unknown>;
  errors?: ExtractError[];
}

// 抽出戦略（優先順位）:
// 1. ```json ... ``` ブロックを探す
// 2. 応答全体を JSON としてパース
// 3. キーワード抽出（"key: value" 形式）
// 4. 失敗
````

### 出力検証 (OutputValidator)

```typescript
/**
 * @input  data: 抽出されたデータ
 * @input  schema: 出力スキーマ定義
 * @output ValidationResult: 検証結果
 * @副作用  なし
 */
validate(data: Record<string, unknown>, schema: OutputSchema): ValidationResult

interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  coerced?: Record<string, unknown>; // 型変換後のデータ（将来）
}

// 検証ルール:
// - 必須フィールドの存在確認
// - 型の一致確認
// - 追加フィールドは無視（厳密モードで拒否可能）
```

### コンテキスト操作 (StepContext)

```typescript
/**
 * ステップ出力を登録
 * @input  stepId: ステップ識別子
 * @input  data: 検証済み出力データ
 * @副作用  outputs[stepId] を更新
 * @保証   既存データは上書きされる
 */
set(stepId: string, data: Record<string, unknown>): void

/**
 * ステップ出力を取得
 * @input  stepId: ステップ識別子
 * @input  key: 出力キー
 * @output 出力値（未設定なら undefined）
 * @副作用  なし
 */
get(stepId: string, key: string): unknown

/**
 * UV 変数として展開
 * @input  inputs: 入力仕様
 * @output UV 変数マップ { "uv-step_key": "value" }
 * @副作用  なし
 * @error  MissingRequiredInput: 必須入力が欠損
 */
toUvVariables(inputs: InputSpec): Record<string, string>

// 変換ルール:
// - stepId.key → uv-{stepId}_{key}
// - 値は文字列に変換（JSON.stringify for object/array）
```

### 完了タイプ

```typescript
type CompletionType =
  | "iterationBudget" // N 回で完了
  | "keywordSignal" // キーワード検出で完了
  | "composite"; // 複数条件の組み合わせ

// composite の評価契約:
// - mode="any": いずれか true で完了（OR、短絡評価）
// - mode="all": すべて true で完了（AND）
```

## エラー契約

### 層別エラー

```typescript
// 基底
class AgentError extends Error {
  recoverable: boolean;
}

// 構成層
class ConfigurationError extends AgentError {
  recoverable = false; // 常に致命的
}

// 実行層
class ExecutionError extends AgentError {
  // recoverable は状況による
}

// 判定層
class JudgmentError extends AgentError {
  recoverable = true; // リトライ可能
}

// 接続層
class ConnectionError extends AgentError {
  recoverable = true; // リトライ/フォールバック可能
}
```

### リカバリ契約

```
回復可能エラー:
  1. リトライ（最大 N 回）
  2. フォールバック（代替リソース）
  3. スキップ（オプション機能のみ）

回復不能エラー:
  1. 即座に Agent 停止
  2. Result.error に記録
  3. 上位（呼び出し元）に伝播
```

## 外部連携の契約

### 派生元ブランチ解決

```
優先順位:
1. explicit    - コマンドライン引数 --origin
2. issue_field - Issue のカスタムフィールド base_branch
3. project_field - Project のカスタムフィールド Target Branch
4. config      - 設定ファイルの originBranch

契約:
- すべて未設定 ⇒ エラー（暗黙のデフォルトなし）
- 指定されたブランチが存在しない ⇒ エラー
```

### Issue-Branch-Worktree-Instance マッピング

```
契約: 1:1:1:1 対応

Issue #N
  └── branch: feature/issue-N
        └── worktree: .worktrees/issue-N/
              └── instance: agent-issue-N-{timestamp}

違反:
- 同一ブランチで複数 Agent ⇒ 起動時エラー
- 同一 Issue で複数 Branch ⇒ 運用エラー（技術的には可能）
```

## 互換性契約

### バージョニング

```
構成ファイルに version フィールドを含む:
{ "version": "1.0", ... }

契約:
- メジャーバージョン変更 ⇒ 後方互換性なし
- マイナーバージョン変更 ⇒ 後方互換
- version 未指定 ⇒ "1.0" として扱う
```

### 非推奨化

```
1. 警告を出力（1マイナーバージョン）
2. エラーに変更（次メジャーバージョン）
3. 削除（その次のメジャーバージョン）
```
