# 完了条件検証と部分リトライ

Step の完了を検証し、失敗時はパターンベースでリトライする。

## 概要

### 二つの検証

| 検証                | 責務               | トリガー   |
| ------------------- | ------------------ | ---------- |
| FormatValidator     | LLM 出力の形式検証 | 出力受信時 |
| CompletionValidator | 外部状態の検証     | 完了宣言後 |

**FormatValidator** は「出力が期待形式か」を検証する。 **CompletionValidator**
は「タスクが実際に完了したか」を検証する。

```
LLM 応答
  │
  ├─ FormatValidator: 形式は正しいか？
  │   └─ NG → 形式リトライ
  │
  └─ 完了宣言を検出
       │
       └─ CompletionValidator: 条件を満たしているか？
            ├─ OK → 完了
            └─ NG → 条件リトライ（パターンベース）
```

## 契約

### 形式検証

```
FormatValidator.validate(summary, format) → FormatValidationResult

入力:    IterationSummary（検出アクション・応答含む）、ResponseFormat（形式指定）
出力:    { valid: boolean, error?: string, extracted?: unknown }
副作用:  なし
```

### 完了検証

```
CompletionValidator.validate(conditions) → CompletionValidationResult

入力:    完了条件の配列
出力:    { valid: boolean, pattern?: string, params?: Record }
副作用:  コマンド実行（git status, deno task test 等）
```

### リトライ

```
RetryHandler.buildRetryPrompt(pattern, params) → string

入力:    失敗パターン、抽出パラメータ
出力:    C3L で解決されたリトライプロンプト
副作用:  なし
```

## 設計思想

### 本当に必要なもの

```
LLM「完了」宣言 → 完了条件検証 → 失敗パターン特定 → 部分リトライ
```

**不要なもの**:

- Action 検知（手段に過ぎない）
- Tool Use への依存（API 機能に過ぎない）
- 複雑なパース処理

### 例

```
Issue 完了の検証:
  - [x] コード実装済み
  - [ ] テスト失敗 ← pattern: "test-failed"
  - [x] コミット済み

→ テスト修正のプロンプトだけ送信してリトライ
```

## SDK Structured Output

Step に `outputSchemaRef` を指定すると、SDK の `outputFormat` パラメータに JSON
Schema が渡される。LLM は Schema に従った JSON を生成し、SDK が
`structured_output` フィールドで返す。

```typescript
// Runner での利用
const schema = loadSchemaForStep(stepId);
const response = await sdk.query({
  prompt,
  outputFormat: { type: "json_schema", schema },
});
// response.structured_output に検証済み JSON が含まれる
```

### steps_registry.json での設定

```json
{
  "steps": {
    "initial.issue": {
      "outputSchemaRef": {
        "file": "issue.schema.json",
        "schema": "initial.issue"
      }
    }
  }
}
```

この方式は外部コマンドによる完了条件検証とは独立しており、LLM
出力のフォーマット保証に使用する。

### SchemaResolver - $ref 解決

Schema ファイルは `$ref` で他の schema を参照できるが、SDK に渡す前に
すべての参照を解決する必要がある。`SchemaResolver` がこれを処理する。

```typescript
import { SchemaResolver } from "../common/schema-resolver.ts";

const resolver = new SchemaResolver(schemasDir);
const schema = await resolver.resolve("issue.schema.json", "complete.issue");
// schema は $ref が解決済み、additionalProperties: false 付与済み
```

**機能**:

| 機能                 | 説明                                              |
| -------------------- | ------------------------------------------------- |
| 外部 $ref 解決       | `common.schema.json#/$defs/stepResponse` を展開   |
| 内部 $ref 解決       | `#/$defs/issueContext` を展開                     |
| allOf マージ         | 継承構造を単一 schema に統合                      |
| additionalProperties | すべての object に `false` を自動付与（SDK 要件） |
| キャッシュ           | 同一ファイルの重複読み込みを防止                  |

**SDK 要件**: `additionalProperties: false` がないと structured output
は動作しない。 SchemaResolver はこれを自動的に追加する。

## 完了パターン

### パターン一覧

| パターン          | 説明               | 検出方法                 |
| ----------------- | ------------------ | ------------------------ |
| `git-dirty`       | 未コミットの変更   | `git status --porcelain` |
| `test-failed`     | テスト失敗         | `deno task test` 失敗    |
| `type-error`      | 型エラー           | `deno check` 失敗        |
| `lint-error`      | リントエラー       | `deno task lint` 失敗    |
| `format-error`    | フォーマットエラー | `deno fmt --check` 失敗  |
| `file-not-exists` | ファイル不在       | ファイル存在チェック     |

### パターン定義

```json
{
  "completionPatterns": {
    "git-dirty": {
      "description": "未コミットの変更がある",
      "edition": "failed",
      "adaptation": "git-dirty",
      "params": ["changedFiles", "untrackedFiles"]
    },
    "test-failed": {
      "description": "テストが失敗",
      "edition": "failed",
      "adaptation": "test-failed",
      "params": ["failedTests", "errorOutput"]
    }
  }
}
```

## Validator

### Validator と Pattern のマッピング

```json
{
  "validators": {
    "git-clean": {
      "type": "command",
      "command": "git status --porcelain",
      "successWhen": "empty",
      "failurePattern": "git-dirty",
      "extractParams": {
        "changedFiles": "parseChangedFiles",
        "untrackedFiles": "parseUntrackedFiles"
      }
    },
    "tests-pass": {
      "type": "command",
      "command": "deno task test",
      "successWhen": "exitCode:0",
      "failurePattern": "test-failed",
      "extractParams": {
        "failedTests": "parseTestOutput",
        "errorOutput": "stderr"
      }
    }
  }
}
```

### 型定義

```typescript
interface ValidatorDefinition {
  type: "command" | "file" | "custom";
  command?: string;
  successWhen: string;
  failurePattern: string;
  extractParams: Record<string, string>;
}

interface FormatValidationResult {
  valid: boolean;
  error?: string;
  extracted?: unknown;
}

interface CompletionValidationResult {
  valid: boolean;
  pattern?: string;
  params?: Record<string, unknown>;
}
```

## C3L 連携

### パス構造

```
{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md

c1         = steps
c2         = retry
c3         = issue
edition    = failed
adaptation = git-dirty, test-failed, etc.
```

### ファイル構造

```
.agent/iterator/prompts/
└── steps/
    └── retry/
        └── issue/
            ├── f_failed.md                 # フォールバック
            ├── f_failed_git-dirty.md       # git未コミット
            ├── f_failed_test-failed.md     # テスト失敗
            └── f_failed_type-error.md      # 型エラー
```

### プロンプト例

**`steps/retry/issue/f_failed_test-failed.md`**

```markdown
---
params:
  - failedTests
  - errorOutput
---

## テストが失敗しています

### 失敗したテスト

{{#each failedTests}}

- `{{this.name}}`: {{this.error}} {{/each}}

### エラー出力
```

{{errorOutput}}

```
失敗したテストを修正してください。
```

## steps_registry.json 設定

### 構造

```json
{
  "agentId": "iterator",

  "completionPatterns": {
    "git-dirty": { ... },
    "test-failed": { ... }
  },

  "validators": {
    "git-clean": { ... },
    "tests-pass": { ... }
  },

  "steps": {
    "complete.issue": {
      "stepId": "complete.issue",
      "name": "Issue Complete Step",
      "c2": "retry",
      "c3": "issue",
      "completionConditions": [
        { "validator": "git-clean" },
        { "validator": "tests-pass" }
      ],
      "onFailure": {
        "action": "retry",
        "maxAttempts": 3
      }
    }
  }
}
```

### フィールド説明

| フィールド             | 説明                                          |
| ---------------------- | --------------------------------------------- |
| `completionPatterns`   | 失敗パターンの定義（edition/adaptation 含む） |
| `validators`           | 検証ロジックの定義                            |
| `completionConditions` | Step の完了条件                               |
| `onFailure`            | 失敗時の動作                                  |

## 型定義

```typescript
interface CompletionPattern {
  description: string;
  edition: string;
  adaptation: string;
  params: string[];
}

interface CompletionStepConfig {
  stepId: string;
  name: string;
  c2: string;
  c3: string;
  completionConditions: CompletionCondition[];
  onFailure: {
    action: "retry" | "abort" | "skip";
    maxAttempts?: number;
  };
}

interface CompletionCondition {
  validator: string;
  params?: Record<string, unknown>;
}

interface StepsRegistry {
  agentId: string;
  completionPatterns: Record<string, CompletionPattern>;
  validators: Record<string, ValidatorDefinition>;
  steps: Record<string, CompletionStepConfig>;
}
```

## フロー

```
Step 実行
  │
  ├─ LLM ループ
  │
  ├─ LLM「完了」宣言
  │
  ├─ 完了条件検証
  │   ├─ git-clean: ✓
  │   ├─ tests-pass: ✗ → pattern: "test-failed"
  │   └─ 検証停止
  │
  ├─ C3L プロンプト解決
  │   └─ steps/retry/issue/f_failed_test-failed.md
  │
  ├─ params 注入
  │   └─ { failedTests: [...], errorOutput: "..." }
  │
  └─ LLM に送信 → リトライ
```

## 実装

### CompletionValidator

```typescript
export class CompletionValidator {
  async validate(
    conditions: CompletionCondition[],
  ): Promise<CompletionValidationResult> {
    for (const condition of conditions) {
      const def = this.registry.validators[condition.validator];
      const result = await this.runValidator(def);

      if (!result.valid) {
        return {
          valid: false,
          pattern: def.failurePattern,
          params: result.params,
        };
      }
    }
    return { valid: true };
  }
}
```

### RetryHandler

```typescript
export class RetryHandler {
  async buildRetryPrompt(
    stepConfig: CompletionStepConfig,
    validationResult: CompletionValidationResult,
  ): Promise<string> {
    const pattern = this.registry.completionPatterns[validationResult.pattern!];

    const template = await this.c3lResolver.resolve({
      c1: "steps",
      c2: stepConfig.c2,
      c3: stepConfig.c3,
      edition: pattern.edition,
      adaptation: pattern.adaptation,
    });

    return this.injectParams(template, validationResult.params!);
  }
}
```

## Structured Output の完了判定への統合

### 概要

SDK の `structured_output` を完了判定に活用する仕組み。AI
の宣言と外部検証を組み合わせ ることで、より堅牢な完了判定を実現する。

### データフロー

```
SDK Response
    │
    ├─ processMessage() → structuredOutput をキャプチャ
    │
    ├─ IterationSummary.structuredOutput に保存
    │
    ├─ setCurrentSummary() → CompletionHandler に渡す
    │
    └─ isComplete() で利用
        ├─ AI の宣言 (status, next_action)
        └─ 外部検証 (git status, GitHub API)
```

### formatIterationSummary の拡張

次の iteration に渡す summary に structured output 情報を含める：

```typescript
// 出力例
## Previous Iteration Summary (Iteration 3)

### Previous Iteration Decision
**Reported Status**: completed
**Declared Next Action**: complete (All requirements satisfied)

### What was done:
...
```

これにより、AI は前回の宣言を認識し、整合性のある判断ができる。

### CompletionHandler インターフェース

```typescript
interface CompletionHandler {
  // ... existing methods

  /**
   * Set the current iteration summary before completion check.
   * Called by runner before isComplete() to provide structured output context.
   */
  setCurrentSummary?(summary: IterationSummary): void;
}
```

### IssueCompletionHandler の完了判定

```typescript
async isComplete(): Promise<boolean> {
  // 1. AI の宣言をチェック
  const soStatus = this.getStructuredOutputStatus();
  const aiDeclaredComplete = soStatus.status === "completed" ||
    soStatus.nextAction === "complete";

  // 2. 外部条件をチェック
  const isIssueClosed = await this.checkGitHubIssueState();
  const isGitClean = await this.checkGitStatus();
  const externalConditionsMet = isIssueClosed && isGitClean;

  // 3. 統合判定
  // AI が完了宣言したが条件未達 → 完了しない（リトライへ）
  if (aiDeclaredComplete && !externalConditionsMet) {
    return false;
  }

  return externalConditionsMet;
}
```

### 無限ループ防止

1. **AI の宣言が次 iteration に伝達される**
   - `formatIterationSummary` で `status`, `next_action` を含める
   - AI は自身の前回宣言を認識できる

2. **宣言と実際の乖離が検出される**
   - AI が `completed` と宣言したが条件未達 → 明示的なリトライ
   - 次 iteration で AI はこの乖離を認識し、修正行動を取れる

3. **アカウンタビリティの確立**
   - `getCompletionDescription()` で AI 宣言を含めて報告
   - ログで宣言と実際の状態を追跡可能

## まとめ

| 観点           | 設計方針                                           |
| -------------- | -------------------------------------------------- |
| 完了判定       | AI の宣言 + 外部条件検証の両方                     |
| 無限ループ防止 | 宣言と実際の乖離を検出しリトライ                   |
| 継続性         | formatIterationSummary で次 iteration に宣言を伝達 |
| パターン       | 具体的な失敗パターン（git-dirty, test-failed 等）  |
| リトライ       | 失敗パターンに対応する C3L プロンプト              |
| C3L 連携       | edition = failed, adaptation = パターン名          |
| パラメータ     | validator が抽出、プロンプトに注入                 |
