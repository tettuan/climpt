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

## Layer 3.5: StepCheck（Rudder実験で発見）

ステップ単位の遷移判定。Completion（エージェント全体）と区別する。

### StepChecker

```typescript
interface StepChecker {
  /**
   * @pre step.check が定義されている
   * @post result.passed === true/false
   * @side-effect チェックタイプによる（prompt型はLLM呼び出し）
   */
  check(context: StepCheckContext): Promise<StepCheckResult>;
}

interface StepCheckContext {
  type: "prompt" | "action" | "keyword";
  response: QueryResult;
  actionResults?: ActionResult[];
}

interface StepCheckResult {
  passed: boolean;
  reason?: string;
}

// 契約: type によって必要な入力が異なる
// - prompt: response全体を使用、追加のLLM呼び出しを行う
// - action: actionResults のみ参照
// - keyword: response.messages のテキスト部分のみ参照
```

### Retry Policy契約

```typescript
interface RetryPolicy {
  maxRetries: number; // 必須
  onExhausted: "error" | "fallback" | "skip";
  fallbackStep?: string; // onExhausted="fallback" のとき必須
}

// 契約:
// - retry=true, maxRetries未指定 → デフォルト3
// - retryCount >= maxRetries → onExhausted で判断
// - retry時、同一ステップを再実行（プロンプト変更なし）
```

## Composite Completion契約（Rudder実験で発見）

複合完了条件の評価ルール。

```typescript
interface CompositeCompletionConfig {
  conditions: CompletionCondition[];
  mode: "any" | "all";
  // 契約:
  // - mode="any": 一つでも complete=true なら完了（OR）
  // - mode="all": 全て complete=true で完了（AND）
  // - 評価順序: conditions配列の順序で評価
  // - 短絡評価: mode="any" で true発見時、以降は評価しない
}

interface CompositeCompletionHandler extends CompletionHandler {
  /**
   * @post 各conditionの個別状態を返す
   * @side-effect none (Query)
   */
  getConditionStates(): Record<string, boolean>;
}

// キーワード検出の優先度契約:
// 1. StepCheck.keywords が先に評価される（ステップ遷移に影響）
// 2. CompletionConfig.keywords は後に評価される（エージェント完了に影響）
// 3. 同一キーワードが両方に存在する場合、両方が反応する
```

## 変数マッピング契約（Rudder実験で発見）

args から UV変数への変換ルール。

```typescript
// 契約: Configuration層の責務
// args: { origin: "Tokyo" } → variables: { "origin": "Tokyo" }
// PromptResolver に渡す時点で "uv-" prefix なし

// PromptResolver側の契約:
// variables["origin"] を受け取り、{uv-origin} を置換

// 未定義変数の契約:
// - 変数が未定義 → 置換せずそのまま残す（エラーにしない）
// - 警告ログを出力
```

## ステップ遷移契約（Rudder実験で発見）

```typescript
interface StepTransitionContract {
  // 契約:
  // - next で指定されたステップは registry.steps に存在すること
  // - 存在しない場合: ConfigurationValidationError
  // - ループ（A→B→A）は許可するが、訪問回数を記録する
  // - 同一ステップの連続実行（retry除く）が STEP_LOOP_LIMIT を超えた場合、
  //   LoopError を発生させる
}

const STEP_LOOP_LIMIT = 10; // 設定可能
```

## 並列実行について（スコープ外）

Saucier実験で Layer 1.5
Scheduler（並列実行、リソース管理、同期ポイント）の必要性を発見したが、
**過剰実装のためスコープ外**とする。

### 設計判断

並列実行が必要な場合は、**複数のAgentインスタンスを起動**して対応する。

```
# 並列実行の代替案
Agent A (appetizer担当)  ─┐
Agent B (fish担当)       ─┼─→ 外部オーケストレーター
Agent C (meat担当)       ─┘

# 利点:
# - 各Agentは単純な単一ループを維持
# - 並列制御は外部（シェルスクリプト、ワークフローエンジン等）に委譲
# - Agent自体の複雑性を抑制
```

### スコープ外とした項目

以下はSaucier実験で発見したが、設計には含めない:

- Layer 1.5: Scheduler
- ParallelOptions, SyncPoint, ResourceLock 契約
- DependencyResolver, TimingConstraint 契約
- parallelGroup, maxConcurrency, syncPoints 設定
- リソース競合解決、デッドロック検出

### 残す項目

以下はSaucier実験で発見し、設計に含める:

- **エスカレーション契約**: ステップ間のジャンプ、外部通知
- **SubStep契約**: 入れ子構造のステップ定義（ただし sequential=true のみ）

## エスカレーション契約（Saucier実験で発見）

```typescript
interface EscalationConfig {
  escalateTo: string; // ステップ名 or 外部参照
  notificationMethod?: "in_agent" | "webhook" | "log";
  returnFlow?: "resume" | "abort" | "restart";
  // 契約:
  // - in_agent: 別のステップにジャンプ
  // - webhook: 外部サービスに通知
  // - log: ログ出力のみ
  //
  // returnFlow:
  // - resume: エスカレーション後、元のステップに戻る
  // - abort: エスカレーション後、エージェント終了
  // - restart: エスカレーション後、最初から再実行
}
```

## SubStep契約（Saucier実験で発見）

```typescript
interface SubStepConfig {
  sequential: true; // 並列実行はスコープ外
  subSteps: string[];
  // 契約:
  // - subSteps を順番に実行
  // - 親ステップの完了: すべての subSteps 完了で完了
  // - 親ステップの失敗: いずれかの subSteps 失敗で失敗
}

// ステップ型の区別:
type StepType = "normal" | "gateway" | "subStep";
// 契約:
// - normal: 通常のプロンプト実行ステップ
// - gateway: 分岐/合流ポイント
// - subStep: 親ステップの一部として実行
// 注: syncPoint はスコープ外（複数Agent起動で対応）
```
