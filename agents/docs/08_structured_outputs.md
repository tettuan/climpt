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
      "outputSchemaRef": "schemas/issue.schema.json"
    }
  }
}
```

この方式は外部コマンドによる完了条件検証とは独立しており、LLM
出力のフォーマット保証に使用する。

## 完了パターン

### パターン一覧

| パターン          | 説明               | 検出方法                 |
| ----------------- | ------------------ | ------------------------ |
| `git-dirty`       | 未コミットの変更   | `git status --porcelain` |
| `test-failed`     | テスト失敗         | `deno task test` 失敗    |
| `type-error`      | 型エラー           | `deno task check` 失敗   |
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

## まとめ

| 観点       | 設計方針                                          |
| ---------- | ------------------------------------------------- |
| 完了判定   | LLM の宣言 + 条件検証                             |
| パターン   | 具体的な失敗パターン（git-dirty, test-failed 等） |
| リトライ   | 失敗パターンに対応する C3L プロンプト             |
| C3L 連携   | edition = failed, adaptation = パターン名         |
| パラメータ | validator が抽出、プロンプトに注入                |
