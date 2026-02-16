# Model Selection

ステップごとに使用するモデルを指定できる仕組み。品質とコストのバランスを
ステップ単位で制御する。

## Why

- **品質重視のデフォルト**: 明示的に指定しない限り opus を使用
- **コスト最適化**: 定型的なステップには haiku を指定可能
- **シンプルな設定**: 多くのステップは設定不要

## What

### 利用可能なモデル

| モデル   | 特徴             | 用途                               |
| -------- | ---------------- | ---------------------------------- |
| `opus`   | 最高性能         | デフォルト。初期分析、重要な判断   |
| `sonnet` | 高性能・バランス | コストと品質のバランスが必要な場合 |
| `haiku`  | 高速・低コスト   | 定型処理、リトライ、繰り返し作業   |

### 解決優先順位

```
1. step.model                        (ステップ固有の指定)
2. runner.boundaries.defaultModel    (エージェントのデフォルト)
3. "opus"                            (システムデフォルト)
```

Runner は上から順に評価し、最初に見つかった値を使用する。

## 設定

### agent.json - defaultModel（通常不要）

システムデフォルトが opus のため、通常は設定不要。 エージェント全体で opus
以外をデフォルトにしたい場合のみ指定。

```json
{
  "runner": {
    "boundaries": {
      "defaultModel": "sonnet"
    }
  }
}
```

### steps_registry.json - ステップごとの指定

例外的なステップのみ `model` を指定する。

```json
{
  "steps": {
    "initial.issue": {
      "stepId": "initial.issue"
      // model 未指定 → opus (default)
    },
    "continuation.issue": {
      "stepId": "continuation.issue",
      "model": "haiku"
    },
    "closure.issue": {
      "stepId": "closure.issue",
      "model": "haiku"
    }
  }
}
```

## 実装

### Runner の resolveModelForStep

```typescript
private resolveModelForStep(stepId?: string): ModelName {
  const SYSTEM_DEFAULT: ModelName = "opus";

  // 1. ステップ固有の指定
  if (stepId && this.stepsRegistry) {
    const stepDef = this.stepsRegistry.steps[stepId];
    if (stepDef?.model) {
      return stepDef.model;
    }
  }

  // 2. エージェントのデフォルト
  if (this.definition.runner.boundaries.defaultModel) {
    return this.definition.runner.boundaries.defaultModel;
  }

  // 3. システムデフォルト
  return SYSTEM_DEFAULT;
}
```

### SDK への受け渡し

```typescript
const queryOptions = {
  model: this.resolveModelForStep(stepId),
  // ...
};

const queryIterator = query({ prompt, options: queryOptions });
```

## ステップ種別ごとの推奨

| ステップ種別     | 推奨モデル     | 理由                         |
| ---------------- | -------------- | ---------------------------- |
| `initial.*`      | opus (default) | 初期分析・方針決定は品質重視 |
| `continuation.*` | haiku or opus  | 繰り返し作業はコスト考慮可   |
| `closure.*`      | haiku          | 定型的なクロージング処理     |
| `*.review`       | opus (default) | レビューは品質重視           |
| `retry.*`        | haiku          | リトライは高速優先           |

## 使用例

### 1. 標準設定（全て opus）

```json
{
  "steps": {
    "initial.issue": {},
    "continuation.issue": {},
    "closure.issue": {}
  }
}
```

### 2. コスト最適化

```json
{
  "steps": {
    "initial.issue": {},
    "continuation.issue": { "model": "haiku" },
    "closure.issue": { "model": "haiku" }
  }
}
```

### 3. バランス型

```json
// agent.json
{ "runner": { "boundaries": { "defaultModel": "sonnet" } } }

// steps_registry.json
{
  "steps": {
    "initial.issue": { "model": "opus" },
    "continuation.issue": {},
    "closure.issue": {}
  }
}
```

## ログ出力

```
[Model] Step "initial.issue" using model: opus (source: system)
[Model] Step "continuation.issue" using model: haiku (source: step)
```

## 型定義

```typescript
// src_common/types.ts
export type ModelName = "sonnet" | "opus" | "haiku";

export interface RunnerBoundariesConfig {
  defaultModel?: ModelName;
  // ...
}

// common/step-registry.ts
export interface PromptStepDefinition {
  model?: ModelName;
  // ...
}
```

## バリデーション

```typescript
const VALID_MODELS = ["sonnet", "opus", "haiku"] as const;

function validateStepModel(step: PromptStepDefinition): void {
  if (step.model && !VALID_MODELS.includes(step.model)) {
    throw new Error(
      `Invalid model "${step.model}" for step "${step.stepId}". ` +
        `Valid models: ${VALID_MODELS.join(", ")}`,
    );
  }
}
```

## 関連ドキュメント

| ドキュメント                                                        | 内容                          |
| ------------------------------------------------------------------- | ----------------------------- |
| [01_runner.md](./01_runner.md)                                      | Runner の責務と実行シーケンス |
| [builder/02_agent_definition.md](../builder/02_agent_definition.md) | agent.json の設定詳細         |
