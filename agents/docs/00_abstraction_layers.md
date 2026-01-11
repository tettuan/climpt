# Abstraction Layers

Agent実行の汎用設計を抽象度レイヤーで整理する。

## Layer概要

```
┌─────────────────────────────────────────────────────────┐
│ Layer -1: Configuration                                 │
│   load(path) → definition → build() → Lifecycle         │
├─────────────────────────────────────────────────────────┤
│ Layer 0: Lifecycle                                      │
│   start(options) ──────────────────────────► stop(result)│
├─────────────────────────────────────────────────────────┤
│ Layer 1: Loop                                           │
│   while(!complete) { query → process → check }          │
├─────────────────────────────────────────────────────────┤
│ Layer 2: SDK Bridge                                     │
│   query(prompt) → response                              │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Completion                                     │
│   check(response) → bool                                │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Prompt                                         │
│   resolve(ref) → content                                │
└─────────────────────────────────────────────────────────┘
```

## 設計原則

1. **単方向依存**: 上位レイヤーは下位レイヤーに依存する。逆方向の依存は禁止。
2. **インターフェース境界**:
   各レイヤーは明確なインターフェースを定義し、実装を隠蔽する。
3. **状態の局所性**: 状態変更は可能な限り一箇所に集約する。
4. **副作用の明示**: 副作用を持つメソッドは名前やシグネチャで明示する。

## Layer定義

### Layer -1: Configuration

設定とプロンプトの読み込み、依存の組み立て。

```typescript
interface ConfigurationLoader {
  load(agentPath: string): Promise<AgentDefinition>;
  validate(definition: AgentDefinition): ValidationResult;
}

interface AgentFactory {
  build(definition: AgentDefinition, options?: BuildOptions): Lifecycle;
}

interface BuildOptions {
  overrides?: Partial<AgentDefinition>;
  dependencies?: Partial<AgentDependencies>;
}
```

責務:

- `agent.json` の読み込み
- `steps_registry.json` の読み込み
- プロンプトディレクトリの解決
- 設定のバリデーション
- 各Layer依存の組み立て（DI）

入力ファイル:

```
.agent/{agent-name}/
├── agent.json           # エージェント定義
├── config.json          # 実行時設定（オプション）
├── steps_registry.json  # ステップ定義
└── prompts/             # プロンプトファイル群
    ├── system.md
    └── steps/...
```

### Layer 0: Lifecycle

起動から停止までの全体制御。

```typescript
interface Lifecycle {
  start(options: StartOptions): Promise<void>;
  stop(): Promise<AgentResult>;
}

interface StartOptions {
  cwd: string;
  args: Record<string, unknown>;
  plugins?: string[];
}
```

責務:

- 起動オプションの受け取り
- 依存コンポーネントの初期化
- 終了時のクリーンアップ
- 結果の返却

### Layer 1: Loop

実行ループの制御。

```typescript
interface Loop {
  run(context: RuntimeContext): Promise<AgentResult>;
}

interface RuntimeContext {
  sessionId: string | null;
  iteration: number;
  summaries: IterationSummary[];
  carry: ContextCarry;
}

interface ContextCarry {
  previousResponse?: string;
  accumulatedContext?: Record<string, unknown>;
}
```

責務:

- ループの開始と継続判定
- イテレーション管理
- コンテキストの次処理への受け渡し
- エラー時のリトライ制御

### Layer 2: SDK Bridge

Claude Agent SDKとの接続。

```typescript
interface SdkBridge {
  query(prompt: string, options: QueryOptions): Promise<QueryResult>;
  getSessionId(): string | null;
}

interface QueryOptions {
  sessionId?: string; // 同一セッション維持
  tools?: string[];
  permissionMode?: PermissionMode;
}

interface QueryResult {
  sessionId: string;
  messages: Message[];
  toolResults: ToolResult[];
}
```

責務:

- SDK APIの呼び出し
- セッションIDの維持（同一セッション継続）
- レスポンスの正規化
- SDK固有エラーのラップ

### Layer 3: Completion

完了条件の判定。

```typescript
interface CompletionHandler {
  check(context: CompletionContext): Promise<CompletionResult>;
  isComplete(): boolean;
  getReason(): string;
}

interface CompletionContext {
  iteration: number;
  response: QueryResult;
  actionResults?: ActionResult[];
}

interface CompletionResult {
  complete: boolean;
  reason?: string;
  signal?: CompletionSignal;
}
```

責務:

- 完了条件との照合
- 完了理由の記録
- アクション結果からのシグナル検出

完了タイプ:

- `iterationBudget`: N回実行で完了
- `keywordSignal`: キーワード検出で完了
- `structuredSignal`: JSON構造シグナルで完了
- `externalState`: 外部状態（Issue等）で完了
- `composite`: 複数条件の組み合わせ

### Layer 4: Prompt

外部プロンプトの解決。

```typescript
interface PromptResolver {
  resolve(ref: PromptReference): Promise<string>;
  resolveSystem(): Promise<string>;
}

type PromptReference =
  | { path: string }
  | { c1: string; c2: string; c3: string; edition?: string };
```

責務:

- パス/C3L参照からプロンプト内容を取得
- 変数の展開（UV変数等）
- フォールバック処理

## Layer間の依存

```
Configuration
    │
    ▼
Lifecycle
    │
    ▼
  Loop ◄──── Completion
    │              │
    ▼              │
SdkBridge          │
    │              │
    └──────────────┘
           │
           ▼
        Prompt
```

- Configuration → Lifecycle: 設定から実行インスタンス生成
- Lifecycle → Loop: ループ実行を委譲
- Loop → SdkBridge: LLM呼び出し
- Loop → Completion: 完了判定
- Completion → Prompt: 判定用プロンプト解決（必要時）
- SdkBridge → Prompt: クエリ用プロンプト解決

## 実装マッピング

| Layer         | 現在の実装                                            |
| ------------- | ----------------------------------------------------- |
| Configuration | `agents/runner/loader.ts`, `agents/runner/builder.ts` |
| Lifecycle     | `AgentRunner.run()`                                   |
| Loop          | `AgentRunner.runLoop()`                               |
| SDK Bridge    | `@anthropic-ai/claude-agent-sdk`                      |
| Completion    | `agents/completion/`                                  |
| Prompt        | `agents/prompts/resolver.ts`                          |

## 拡張ポイント

各Layerは以下で拡張可能:

1. **Configuration**: 新しい設定ソース（API、環境変数等）
2. **Lifecycle**: 新しい起動モード追加
3. **Loop**: カスタムループ戦略（並列実行等）
4. **SDK Bridge**: 別LLMへの差し替え
5. **Completion**: 新しい完了条件タイプ
6. **Prompt**: 新しいプロンプトソース（API等）
