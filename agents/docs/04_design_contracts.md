# Design Contracts

各レイヤー間の契約（インターフェース境界）を定義する。 抽象度:
**高**（実装非依存）

## 原則

### 契約の種類

1. **入力契約**: メソッドに渡す引数の型と前提条件
2. **出力契約**: メソッドが返す値の型と事後条件
3. **状態契約**: 呼び出し前後で満たすべき状態の不変条件
4. **エラー契約**: 発生しうるエラーの種類と意味

### 副作用の分類

```typescript
// Query: 状態を変更しない（参照透過）
interface Query<T> {
  (): T; // 同じ入力なら同じ出力
}

// Command: 状態を変更する
interface Command {
  (): void; // 戻り値なし、副作用あり
}

// Query-Command Separation の原則を適用
```

## Layer -1: Configuration

### ConfigurationLoader

```typescript
interface ConfigurationLoader {
  /**
   * @pre agentPath は存在するディレクトリ
   * @post 返り値の definition は valid
   * @throws ConfigurationNotFoundError - agent.json が存在しない
   * @throws ConfigurationParseError - JSON パースエラー
   * @side-effect none (Query)
   */
  load(agentPath: string): Promise<AgentDefinition>;

  /**
   * @pre definition は load() の戻り値
   * @post valid=true なら errors.length === 0
   * @side-effect none (Query)
   */
  validate(definition: AgentDefinition): ValidationResult;
}
```

### AgentFactory

```typescript
interface AgentFactory {
  /**
   * @pre definition は validated
   * @post 返り値は start() 呼び出し可能な状態
   * @throws DependencyResolutionError - 依存解決失敗
   * @side-effect 依存オブジェクトの生成
   */
  build(definition: AgentDefinition, options?: BuildOptions): Lifecycle;
}
```

### ValidationResult契約

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[]; // valid=false のとき length > 0
  warnings: string[]; // valid=true でも length > 0 の可能性あり
}

// 不変条件: valid === (errors.length === 0)
```

## Layer 0: Lifecycle

### Lifecycle

```typescript
interface Lifecycle {
  /**
   * @pre 初回呼び出しのみ許可（再startは禁止）
   * @post 全依存コンポーネントが初期化済み
   * @post stop() 呼び出し可能な状態
   * @throws AlreadyStartedError - 2回目以降の呼び出し
   * @side-effect 依存コンポーネントの初期化
   */
  start(options: StartOptions): Promise<void>;

  /**
   * @pre start() が正常完了している
   * @post 全リソースが解放済み
   * @post 再度の start() は禁止（インスタンス再利用不可）
   * @side-effect リソースの解放、ログのフラッシュ
   */
  stop(): Promise<AgentResult>;
}

// 状態遷移: Created → Started → Stopped (一方向)
```

## Layer 1: Loop

### Loop

```typescript
interface Loop {
  /**
   * @pre context.iteration === 0
   * @post result.success === true または result.error が設定
   * @side-effect セッション生成、ログ出力、外部ツール実行
   */
  run(context: RuntimeContext): Promise<AgentResult>;
}
```

### RuntimeContext契約

```typescript
interface RuntimeContext {
  sessionId: string | null; // null は新規セッション
  iteration: number; // >= 0、ループ内でインクリメント
  summaries: IterationSummary[]; // 前回までの履歴（readonly推奨）
  carry: ContextCarry; // 次イテレーションへの引き継ぎデータ
}

// 不変条件: summaries.length === iteration（ループ終了時）
```

### ContextCarry契約

```typescript
interface ContextCarry {
  previousResponse?: string; // 前イテレーションのLLM応答
  accumulatedContext?: Record<string, unknown>; // 蓄積コンテキスト
}

// 更新タイミング: 各イテレーション終了時
// 更新責務: Loop実装
```

## Layer 2: SDK Bridge

### SdkBridge

```typescript
interface SdkBridge {
  /**
   * @pre prompt.length > 0
   * @post sessionId は同一セッション内で一貫
   * @throws SdkConnectionError - API接続エラー
   * @throws SdkRateLimitError - レート制限
   * @side-effect API呼び出し、セッション状態更新
   */
  query(prompt: string, options: QueryOptions): Promise<QueryResult>;

  /**
   * @post query() 未実行なら null
   * @side-effect none (Query)
   */
  getSessionId(): string | null;
}
```

### セッション管理契約

```typescript
// セッション維持の条件
// 1. options.sessionId を渡す → そのセッションを継続
// 2. options.sessionId が null/undefined → 新規セッション
// 3. SDK側でセッション切断 → 新規セッションIDを返す

// 呼び出し側の責務: sessionIdを保持し、次回query()に渡す
// SdkBridge側の責務: SDK応答からsessionIdを抽出し返す
```

## Layer 3: Completion

### CompletionHandler

```typescript
interface CompletionHandler {
  /**
   * @pre context.iteration > 0
   * @post complete=true なら reason が設定
   * @side-effect 内部状態の更新
   *
   * Note: check() は副作用を持つ（状態更新）
   * isComplete() と分離することで、判定と照会を明確化
   */
  check(context: CompletionContext): Promise<CompletionResult>;

  /**
   * @post 最後のcheck()結果を反映
   * @side-effect none (Query)
   */
  isComplete(): boolean;

  /**
   * @post isComplete()=true なら空文字でない
   * @side-effect none (Query)
   */
  getReason(): string;
}
```

### 状態更新のタイミング

```
check() 呼び出し
    ↓
内部状態を更新（_isComplete, _reason）
    ↓
CompletionResult を返却
    ↓
isComplete() / getReason() は更新後の状態を返す
```

## Layer 4: Prompt

### PromptResolver

```typescript
interface PromptResolver {
  /**
   * @pre ref が有効な参照（パスまたはC3L）
   * @post 返り値は空文字でない（見つからない場合はエラー）
   * @throws PromptNotFoundError - プロンプトファイルが存在しない
   * @throws PromptParseError - テンプレート構文エラー
   * @side-effect ファイル読み込み
   */
  resolve(ref: PromptReference): Promise<string>;

  /**
   * @post 返り値は空文字でない
   * @side-effect ファイル読み込み
   */
  resolveSystem(): Promise<string>;
}
```

### 変数解決の責務

```typescript
// 変数解決は PromptResolver の責務か？
// 選択肢:
// A) PromptResolver に variables を渡す: resolve(ref, variables)
// B) 呼び出し側が置換する: content.replace()
// C) 別の VariableResolver を作る

// 推奨: A) PromptResolver に統合
// 理由: プロンプト解決と変数展開は密結合（テンプレートエンジン）
```

## エラー階層

```typescript
// 基底エラー
class AgentError extends Error {
  code: string;
  recoverable: boolean;
}

// Layer別エラー
class ConfigurationError extends AgentError {} // Layer -1
class LifecycleError extends AgentError {} // Layer 0
class LoopError extends AgentError {} // Layer 1
class SdkBridgeError extends AgentError {} // Layer 2
class CompletionError extends AgentError {} // Layer 3
class PromptError extends AgentError {} // Layer 4

// recoverableの定義:
// true: リトライや代替処理で回復可能
// false: 致命的エラー、即時停止が必要
```
