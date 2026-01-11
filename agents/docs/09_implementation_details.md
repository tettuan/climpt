# Implementation Details

各レイヤーの実装詳細と具体的な設計決定。 抽象度: **低**（実装依存）

## Layer -1: Configuration

### load() と validate() の関係

**問題**: load()とvalidate()が分離しているが、呼び出しタイミングが曖昧。

**決定**:

```typescript
class ConfigurationLoader {
  // load() は構文的な妥当性のみチェック（JSONパース）
  // validate() は意味的な妥当性をチェック（スキーマ、依存関係）

  async loadAndValidate(agentPath: string): Promise<ValidatedDefinition> {
    const definition = await this.load(agentPath);
    const result = this.validate(definition);
    if (!result.valid) {
      throw new ConfigurationValidationError(result.errors);
    }
    // warnings はログ出力
    if (result.warnings.length > 0) {
      console.warn("Configuration warnings:", result.warnings);
    }
    return definition as ValidatedDefinition; // 型で妥当性を保証
  }
}
```

### 依存オブジェクト生成順序

```typescript
// 生成順序（依存関係に基づく）
// 1. PromptResolver - 他から参照されるが依存なし
// 2. CompletionHandler - PromptResolver に依存する可能性あり
// 3. SdkBridge - 独立
// 4. ActionSystem - Logger に依存
// 5. Logger - 独立だが最初に生成すべき

const buildOrder = [
  "logger", // 他のコンポーネントが使用
  "promptResolver", // Completion, SdkBridge が使用
  "completionHandler", // 完了判定
  "sdkBridge", // LLM接続
  "actionSystem", // アクション処理（optional）
];
```

## Layer 1: Loop

### IterationSummary の構造

```typescript
interface IterationSummary {
  iteration: number;
  sessionId?: string;
  assistantResponses: string[]; // 複数レスポンスを配列で保持
  toolsUsed: ToolUsage[]; // 詳細情報を含む
  detectedActions: DetectedAction[];
  actionResults?: ActionResult[];
  errors: string[];
  timestamp: Date;
  durationMs: number;
}

interface ToolUsage {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}
```

### carry の更新ルール

```typescript
// イテレーション終了時の更新処理
function updateCarry(
  carry: ContextCarry,
  summary: IterationSummary,
): ContextCarry {
  return {
    previousResponse: summary.assistantResponses.join("\n"),
    accumulatedContext: {
      ...carry.accumulatedContext,
      // 最新のサマリーから必要な情報を抽出
      lastToolsUsed: summary.toolsUsed.map((t) => t.name),
      lastActions: summary.detectedActions.map((a) => a.type),
    },
  };
}
```

### 無限ループ防止

```typescript
const HARD_LIMIT = 100; // 設定に関わらない絶対上限

async function runLoop(context: RuntimeContext): Promise<AgentResult> {
  while (true) {
    context.iteration++;

    // 1. 設定上限（completionHandler）
    if (await completionHandler.isComplete()) break;

    // 2. ハード上限（安全弁）
    if (context.iteration > HARD_LIMIT) {
      return {
        success: false,
        error: `Hard limit exceeded: ${HARD_LIMIT}`,
        completionReason: "emergency_stop",
      };
    }

    // 3. タイムアウト（別途実装）
    // ...
  }
}
```

## Layer 2: SDK Bridge

### 初期化パラメータ

```typescript
interface SdkBridgeConfig {
  cwd: string; // 作業ディレクトリ
  defaultSystemPrompt?: string; // デフォルトシステムプロンプト
  defaultTools?: string[]; // デフォルト許可ツール
  sandboxConfig?: SandboxConfig; // サンドボックス設定
}

class SdkBridge {
  private config: SdkBridgeConfig;
  private sessionId: string | null = null;

  constructor(config: SdkBridgeConfig) {
    this.config = config;
  }

  async query(prompt: string, options: QueryOptions): Promise<QueryResult> {
    const queryOptions = {
      cwd: this.config.cwd,
      systemPrompt: options.systemPrompt ?? this.config.defaultSystemPrompt,
      allowedTools: options.tools ?? this.config.defaultTools,
      resume: options.sessionId ?? this.sessionId,
      // ...
    };

    const result = await sdk.query({ prompt, options: queryOptions });
    this.sessionId = result.sessionId;
    return result;
  }
}
```

### セッション切断時の再接続

```typescript
async function queryWithReconnect(
  prompt: string,
  options: QueryOptions,
): Promise<QueryResult> {
  try {
    return await this.query(prompt, options);
  } catch (error) {
    if (isSessionDisconnectedError(error)) {
      // セッションが切断された場合、新規セッションで再試行
      console.warn("Session disconnected, starting new session");
      this.sessionId = null;
      return await this.query(prompt, { ...options, sessionId: undefined });
    }
    throw error;
  }
}
```

## Layer 3: Completion

### check() の副作用明示

```typescript
interface CompletionHandler {
  /**
   * 完了条件を判定し、内部状態を更新する。
   * @mutates this._isComplete, this._reason
   */
  check(context: CompletionContext): Promise<CompletionResult>;

  // または、純粋関数 + 明示的な状態更新に分離:
  // evaluate(context): CompletionResult  // 純粋関数
  // commit(result): void                 // 状態更新
}

// 実装例（状態更新を明示）
class IterationBudgetHandler {
  private state: { isComplete: boolean; reason: string } = {
    isComplete: false,
    reason: "",
  };

  async check(context: CompletionContext): Promise<CompletionResult> {
    const result = this.evaluate(context); // 純粋な判定
    this.updateState(result); // 状態更新（副作用）
    return result;
  }

  private evaluate(context: CompletionContext): CompletionResult {
    if (context.iteration >= this.maxIterations) {
      return { complete: true, reason: `Reached ${this.maxIterations}` };
    }
    return { complete: false };
  }

  private updateState(result: CompletionResult): void {
    this.state.isComplete = result.complete;
    this.state.reason = result.reason ?? "";
  }
}
```

### CompletionSignal の処理

```typescript
// シグナル処理の責務分担
// Loop: シグナルを受け取り、適切なハンドラーに委譲
// CompletionHandler: シグナルを状態に反映

async function processCompletionSignal(
  handler: CompletionHandler,
  signal: CompletionSignal,
): Promise<void> {
  switch (signal.type) {
    case "phase-advance":
      if ("advancePhase" in handler) {
        (handler as PhaseAwareHandler).advancePhase();
      }
      break;
    case "complete":
      if ("forceComplete" in handler) {
        (handler as ForceCompletableHandler).forceComplete(signal.data);
      }
      break;
  }
}
```

## Layer 4: Prompt

### 変数解決の実装

```typescript
interface PromptResolver {
  /**
   * @param ref プロンプト参照
   * @param variables 置換変数 (key: 変数名、value: 値)
   */
  resolve(
    ref: PromptReference,
    variables?: Record<string, string>,
  ): Promise<string>;
}

class PromptResolverImpl implements PromptResolver {
  async resolve(
    ref: PromptReference,
    variables?: Record<string, string>,
  ): Promise<string> {
    // 1. ファイル読み込み
    const content = await this.loadPromptFile(ref);

    // 2. 変数置換
    if (variables) {
      return this.substituteVariables(content, variables);
    }

    return content;
  }

  private substituteVariables(
    content: string,
    variables: Record<string, string>,
  ): string {
    let result = content;
    for (const [key, value] of Object.entries(variables)) {
      // {uv-xxx} 形式を置換
      result = result.replace(new RegExp(`\\{uv-${key}\\}`, "g"), value);
    }
    return result;
  }
}
```

### C3L パス解決の詳細

```typescript
interface C3LReference {
  c1: string; // Category
  c2: string; // Classification
  c3: string; // Chapter
  edition?: string; // default: "default"
  adaptation?: string; // optional variant
}

function resolveC3LPath(basePath: string, ref: C3LReference): string {
  const edition = ref.edition ?? "default";

  // adaptation がある場合: f_{edition}_{adaptation}.md
  // ない場合: f_{edition}.md
  const filename = ref.adaptation
    ? `f_${edition}_${ref.adaptation}.md`
    : `f_${edition}.md`;

  return `${basePath}/${ref.c1}/${ref.c2}/${ref.c3}/${filename}`;
}
```

### フォールバック処理

```typescript
async function resolveWithFallback(
  ref: PromptReference,
  fallbackDir: string,
): Promise<string> {
  // 1. 主パスを試行
  const primaryPath = this.resolvePath(ref);
  if (await this.fileExists(primaryPath)) {
    return await Deno.readTextFile(primaryPath);
  }

  // 2. 参照内のfallbackを試行（あれば）
  if ("fallback" in ref && ref.fallback) {
    const fallbackPath = this.resolvePath({ path: ref.fallback });
    if (await this.fileExists(fallbackPath)) {
      console.warn(`Using fallback: ${fallbackPath}`);
      return await Deno.readTextFile(fallbackPath);
    }
  }

  // 3. グローバルフォールバックディレクトリを試行
  const globalFallback = `${fallbackDir}/${this.extractFilename(ref)}`;
  if (await this.fileExists(globalFallback)) {
    console.warn(`Using global fallback: ${globalFallback}`);
    return await Deno.readTextFile(globalFallback);
  }

  throw new PromptNotFoundError(primaryPath);
}
```

## ステップ遷移ロジック

**問題**: steps_registry
にステップ定義があるが、遷移ロジックがLoopに統合されていない。

**決定**: StepMachine をLoop内に統合

```typescript
interface StepMachine {
  getCurrentStep(): StepDefinition;
  transition(checkResult: CheckResponse): void;
  isTerminal(): boolean;
}

class StepMachineImpl implements StepMachine {
  private currentStepId: string;
  private registry: StepsRegistry;

  constructor(registry: StepsRegistry) {
    this.registry = registry;
    this.currentStepId = registry.entryStep;
  }

  getCurrentStep(): StepDefinition {
    return this.registry.steps[this.currentStepId];
  }

  transition(checkResult: CheckResponse): void {
    const step = this.getCurrentStep();
    if (!step.check) {
      // チェックなしのステップは次へ
      return;
    }

    const passed = this.isPassed(checkResult);
    const next = passed ? step.check.onPass : step.check.onFail;

    if (next.complete) {
      // 完了
      return;
    }

    if (next.next) {
      this.currentStepId = next.next;
    }
  }

  isTerminal(): boolean {
    const step = this.getCurrentStep();
    return step.check?.onPass?.complete === true;
  }
}
```
