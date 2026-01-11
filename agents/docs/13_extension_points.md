# 拡張ポイント

Agent システムを拡張する方法。Agent 自体を複雑にせず、組み合わせで機能を増やす。

## 拡張の原則

```
✓ 設定で拡張     - 新しいオプションを追加
✓ プラグインで拡張 - 差し替え可能なコンポーネント
✓ 組み合わせで拡張 - 複数 Agent、外部ツール
✗ コア改変       - Agent 本体の変更は最終手段
```

## 層別の拡張ポイント

### 構成層

| 拡張                   | 方法                  | 例                              |
| ---------------------- | --------------------- | ------------------------------- |
| 新しい設定項目         | スキーマ拡張          | `agent.json` に新フィールド追加 |
| 別の設定ソース         | ConfigLoader 差し替え | 環境変数、API からの読み込み    |
| カスタムバリデーション | Validator プラグイン  | プロジェクト固有のルール        |

```typescript
// 設定ソースの差し替え例
interface ConfigLoader {
  load(agentPath: string): Promise<AgentDefinition>;
}

class FileConfigLoader implements ConfigLoader {
  /* ファイルから読み込み */
}
class ApiConfigLoader implements ConfigLoader {
  /* API から読み込み */
}
class EnvConfigLoader implements ConfigLoader {
  /* 環境変数から読み込み */
}
```

### 実行層

| 拡張           | 方法                  | 例                               |
| -------------- | --------------------- | -------------------------------- |
| ループ戦略     | LoopRunner 差し替え   | バッチ実行、インタラクティブ     |
| イベントフック | ライフサイクルフック  | 開始時通知、終了時クリーンアップ |
| カスタム carry | CarryUpdater 差し替え | 特殊な引き継ぎロジック           |

```typescript
// ライフサイクルフックの例
interface LifecycleHooks {
  onStart?(options: StartOptions): Promise<void>;
  onIterationStart?(iteration: number): Promise<void>;
  onIterationEnd?(summary: IterationSummary): Promise<void>;
  onStop?(result: AgentResult): Promise<void>;
}

// 使用例: Slack 通知
const slackHooks: LifecycleHooks = {
  onStop: async (result) => {
    await slack.notify(`Agent finished: ${result.completionReason}`);
  },
};
```

### 判定層

| 拡張                     | 方法                   | 例                  |
| ------------------------ | ---------------------- | ------------------- |
| 新しい完了条件           | CompletionHandler 追加 | 外部 API 状態で完了 |
| カスタムステップチェック | StepChecker 追加       | LLM 以外での判定    |
| 複合条件の追加           | CompositeHandler 拡張  | 新しい mode         |

```typescript
// 新しい完了条件の追加例
class ExternalStateHandler implements CompletionHandler {
  constructor(private checkUrl: string) {}

  async check(context: CompletionContext): Promise<CompletionResult> {
    const response = await fetch(this.checkUrl);
    const data = await response.json();
    return {
      complete: data.status === "done",
      reason: data.message,
    };
  }
}

// 設定での指定
{
  "completion": {
    "type": "externalState",
    "checkUrl": "https://api.example.com/status"
  }
}
```

### ステップ間引き継ぎ

| 拡張               | 方法                     | 例                     |
| ------------------ | ------------------------ | ---------------------- |
| カスタム出力抽出   | OutputExtractor 差し替え | XML 形式、カスタム構文 |
| 出力検証ルール追加 | OutputValidator 拡張     | 範囲チェック、相関検証 |
| コンテキスト永続化 | StepContext 拡張         | ファイル保存、DB 保存  |

```typescript
// カスタム出力抽出の例
class XmlOutputExtractor implements OutputExtractor {
  extract(response: string, schema: OutputSchema): ExtractResult {
    // XML タグから出力を抽出
    const match = response.match(/<output>([\s\S]*?)<\/output>/);
    if (!match) {
      return { ok: false, errors: [{ message: "XML output block not found" }] };
    }
    // XML パースして返す
    return { ok: true, data: this.parseXml(match[1]) };
  }
}

// 設定での指定
{
  "outputExtraction": {
    "type": "xml",
    "rootTag": "output"
  }
}
```

```typescript
// 出力検証ルール追加の例
class RangeValidator implements OutputValidator {
  validate(
    data: Record<string, unknown>,
    schema: OutputSchema,
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // 範囲チェック
    if (schema.height && typeof data.height === "number") {
      if (data.height < 100 || data.height > 250) {
        errors.push({ field: "height", message: "Height must be 100-250cm" });
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
```

```typescript
// コンテキスト永続化の例
class PersistentStepContext implements StepContext {
  private sessionDir: string;

  constructor(sessionId: string) {
    this.sessionDir = `.agent/sessions/${sessionId}`;
  }

  async set(stepId: string, data: Record<string, unknown>): Promise<void> {
    // メモリに保存
    this.outputs[stepId] = data;
    // ファイルにも永続化
    await Deno.writeTextFile(
      `${this.sessionDir}/outputs/${stepId}.json`,
      JSON.stringify(data, null, 2),
    );
  }

  static async restore(sessionId: string): Promise<PersistentStepContext> {
    // ファイルから復元
    const context = new PersistentStepContext(sessionId);
    const outputsDir = `${context.sessionDir}/outputs`;
    for await (const entry of Deno.readDir(outputsDir)) {
      if (entry.name.endsWith(".json")) {
        const stepId = entry.name.replace(".json", "");
        const content = await Deno.readTextFile(`${outputsDir}/${entry.name}`);
        context.outputs[stepId] = JSON.parse(content);
      }
    }
    return context;
  }
}
```

### 接続層

| 拡張             | 方法               | 例                   |
| ---------------- | ------------------ | -------------------- |
| 別の LLM         | SdkBridge 差し替え | OpenAI、ローカル LLM |
| プロンプトソース | Resolver 差し替え  | データベース、API    |
| 新しいツール     | ToolProvider 追加  | カスタムツール       |

```typescript
// LLM 差し替えの例
interface LLMBridge {
  query(prompt: string, options: QueryOptions): Promise<QueryResult>;
}

class ClaudeSdkBridge implements LLMBridge {
  /* Claude Agent SDK */
}
class OpenAIBridge implements LLMBridge {
  /* OpenAI API */
}
class LocalLLMBridge implements LLMBridge {
  /* Ollama 等 */
}
```

## 組み合わせによる拡張

### 複数 Agent

```
並列化 ─────────────────────────────────────────
       Agent A   Agent B   Agent C
       (同一定義を複数起動)

パイプライン ───────────────────────────────────
       Agent A → Agent B → Agent C
       (結果を次の入力に)

分岐・合流 ─────────────────────────────────────
                  Agent B
       Agent A →           → Agent D
                  Agent C
```

### 外部オーケストレーター

```typescript
// シェルスクリプトでの例
async function orchestrate(issues: Issue[]) {
  const agents = issues.map((issue) =>
    spawnAgent({
      agent: "welder",
      args: {
        issueNumber: issue.number,
        origin: issue.baseBranch,
      },
      worktree: `.worktrees/issue-${issue.number}`,
    })
  );

  const results = await Promise.all(agents);

  for (const result of results) {
    if (result.success) {
      await createPR(result);
    }
  }
}
```

### 外部ツール連携

```
┌──────────────────────────────────────────────────────────┐
│ Agent                                                    │
│                                                          │
│   LLM が外部ツールを呼び出す                              │
│   ┌─────────────────────────────────────────────────┐   │
│   │ SDK 許可ツール:                                  │   │
│   │ - Bash (git, gh, npm, ...)                      │   │
│   │ - Read, Write, Edit                              │   │
│   │ - WebFetch, WebSearch                            │   │
│   └─────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## 推奨される拡張パターン

### プロジェクト固有の設定

```
.agent/my-agent/
├── agent.json           # 基本設定
├── config.json          # プロジェクト固有設定（gitignore可）
└── config.local.json    # ローカル開発用（gitignore）
```

マージ優先順位: `config.local.json > config.json > agent.json`

### カスタム完了条件

```json
{
  "completion": {
    "type": "composite",
    "mode": "any",
    "conditions": [
      { "type": "iterationBudget", "budget": 10 },
      { "type": "keywordSignal", "keywords": ["DONE", "COMPLETE"] },
      { "type": "externalState", "checkUrl": "..." }
    ]
  }
}
```

### ステップの追加

```json
// steps_registry.json - C3L 形式でプロンプトを参照
{
  "version": "1.0.0",
  "basePath": "prompts",
  "entryStep": "init",
  "steps": {
    "init": {
      "name": "Initialize",
      "c1": "steps",
      "c2": "init",
      "c3": "prepare",
      "edition": "default",
      "variables": ["uv-agent_name"],
      "next": "work"
    },
    "work": {
      "name": "Work",
      "c1": "steps",
      "c2": "work",
      "c3": "execute",
      "edition": "default",
      "variables": ["uv-iteration", "uv-max_iterations"],
      "next": "verify"
    },
    "verify": {
      "name": "Verify",
      "c1": "steps",
      "c2": "verify",
      "c3": "check",
      "edition": "default",
      "variables": ["uv-iteration"],
      "next": "complete"
    },
    "complete": {
      "name": "Complete",
      "c1": "steps",
      "c2": "complete",
      "c3": "finalize",
      "edition": "default",
      "variables": ["uv-completion_reason"]
    }
  }
}
```

C3L パス構造:

```
.agent/{agent-name}/prompts/{c1}/{c2}/{c3}/f_{edition}.md

例:
.agent/iterator/prompts/steps/init/prepare/f_default.md
.agent/iterator/prompts/steps/work/execute/f_default.md
.agent/iterator/prompts/steps/verify/check/f_default.md
.agent/iterator/prompts/steps/complete/finalize/f_default.md
```

## 拡張しないもの

以下は Agent の責務外。外部で対応する。

| やりたいこと     | 対応方法                        |
| ---------------- | ------------------------------- |
| 並列実行         | 複数 Agent 起動                 |
| スケジュール実行 | cron、GitHub Actions            |
| 結果集約         | 外部スクリプト                  |
| PR 作成・マージ  | 外部オーケストレーター          |
| 承認フロー       | GitHub PR レビュー              |
| 通知             | ライフサイクルフック + 外部 API |

## 拡張の注意点

### インターフェースを守る

```typescript
// 良い: インターフェースに従う
class MyHandler implements CompletionHandler {
  check(context) {
    /* ... */
  }
  isComplete() {
    /* ... */
  }
  getReason() {
    /* ... */
  }
}

// 悪い: 独自メソッドを期待する
class MyHandler {
  customCheck() {
    /* ... */
  } // 他から呼べない
}
```

### 依存の方向を守る

```
✓ 拡張 → コア（コアのインターフェースを使う）
✗ コア → 拡張（特定の拡張に依存しない）
```

### テスト可能に

```typescript
// 良い: 依存を注入可能
class MyHandler {
  constructor(private deps: Dependencies) {}
}

// 悪い: 依存がハードコード
class MyHandler {
  private deps = new HardcodedDependencies();
}
```

## 拡張の提案プロセス

```
1. Issue 作成 - 拡張の目的と方法を説明
2. 設計レビュー - コア改変が本当に必要か確認
3. 実装 - インターフェースを守る
4. テスト - 既存機能への影響を確認
5. ドキュメント - 使い方を記載
```
