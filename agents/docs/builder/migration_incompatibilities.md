# Migration Compatibility Report

Compatibility issues discovered during migration to the climpt-agents framework
and their resolution status.

---

## Overview

| Category                             | Issues | Resolved |
| ------------------------------------ | ------ | -------- |
| v1.12.0 Breaking: Config Restructure | 1      | 1        |
| Schema Extensions                    | 4      | 4        |
| Pending Implementation               | 2      | 0        |

---

## 0. v1.12.0 Breaking Change: Config Restructure

### 0.1 `behavior`/`prompts`/`logging` -> `runner.*`

**Version**: v1.12.0

**Impact**: agent.json のトップレベル構造が変更。旧形式は動作しない。

**変更内容**: フラットな
`behavior`/`prompts`/`logging`/`github`/`worktree`/`finalize` を
ランタイムモジュールの責務に沿った `runner.*` 階層に置き換え。

**対応表**:
[migration_guide.md の v1.12.0 Config Migration セクション](./migration_guide.md#v1120-config-migration-behavior---runner)
を参照。

**対処方法**: agent.json を `runner.*` 形式に書き換える。`deno check agents/`
で型エラーがないことを確認。

---

## 1. Resolved: Schema Extensions

### 1.1 `adaptation` Field

**Issue**: Source uses `edition` + `adaptation` two-layer structure

**Resolution**: Added `adaptation` to `PromptC3LReference`

```typescript
export interface PromptC3LReference {
  c1: string;
  c2: string;
  c3: string;
  edition?: string;
  adaptation?: string; // Added
}
```

**Path Resolution**:

- Without `adaptation`: `{c1}/{c2}/{c3}/f_{edition}.md`
- With `adaptation`: `{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md`

### 1.2 `customVariables` Field

**Issue**: No definition for runtime-injected variables in prompts

**Resolution**: Added `customVariables` to `StepDefinition`

```typescript
export interface StepDefinition {
  customVariables?: CustomVariableDefinition[];
}

export interface CustomVariableDefinition {
  name: string;
  source: "stdin" | "github" | "computed" | "parameter" | "context";
  description?: string;
  required?: boolean;
}
```

### 1.3 `usesStdin` Flag

**Issue**: No specification for whether step accepts stdin input

**Resolution**: Added to `StepDefinition`

```typescript
export interface StepDefinition {
  usesStdin?: boolean;
}
```

### 1.4 `entryStepMapping`

**Issue**: Cannot dynamically select steps based on mode

**Resolution**: Added to `StepsRegistry`

```typescript
export interface StepsRegistry {
  entryStepMapping?: Record<string, string>;
}
```

**Usage Example**:

```json
{
  "entryStep": "s_init_externalState",
  "entryStepMapping": {
    "externalState": "s_init_externalState",
    "iterationBudget": "s_init_iterationBudget"
  }
}
```

### 1.5 `fallback` Field

**Issue**: No fallback specification when prompt is not found

**Resolution**: Added `fallback` to `PromptReference`

```typescript
export interface PromptC3LReference {
  fallback?: string;
}

export interface PromptPathReference {
  fallback?: string;
}
```

---

## 2. Pending Implementation: Runner Features

### 2.1 customVariables Injection

**Status**: Schema definition complete, runner implementation pending

**Required Implementation**:

- `source: "stdin"` -> Read from stdin
- `source: "github"` -> GitHub API call
- `source: "computed"` -> Execute computation logic
- `source: "parameter"` -> Get from CLI parameter
- `source: "context"` -> Get from execution context

### 2.2 entryStepMapping Selection Logic

**Status**: Schema definition complete, runner implementation pending

**Required Implementation**:

```typescript
function getEntryStep(registry: StepsRegistry, mode?: string): string {
  if (mode && registry.entryStepMapping?.[mode]) {
    return registry.entryStepMapping[mode];
  }
  return registry.entryStep;
}
```

---

## 3. Migrated Agents

### 3.1 reviewer

| Item                       | Status |
| -------------------------- | ------ |
| agent.json                 | Done   |
| steps_registry.json        | Done   |
| Prompts                    | Done   |
| customVariables definition | Done   |

### 3.2 iterator

| Item                       | Status                    |
| -------------------------- | ------------------------- |
| agent.json                 | Done                      |
| steps_registry.json        | Done (all steps migrated) |
| Prompts                    | Done                      |
| entryStepMapping           | Done                      |
| customVariables definition | Done                      |
| adaptation usage           | Done                      |

---

## 4. Modified Files

### Type Definitions

- `agents/common/types.ts`
  - Added `StepsRegistry.entryStepMapping`
  - Added `StepDefinition.customVariables`
  - Added `StepDefinition.usesStdin`
  - Added `PromptC3LReference.adaptation`
  - Added `PromptC3LReference.fallback`
  - Added `PromptPathReference.fallback`
  - Added `CustomVariableDefinition` type

### JSON Schemas

- `agents/schemas/steps_registry.schema.json`
  - Added `entryStepMapping` property
  - Added `customVariables` property
  - Added `usesStdin` property
  - Added `adaptation` property
  - Added `fallback` property
  - Added `CustomVariableDefinition` definition

### Migrated Agents

- `agents/iterator/` - Fully migrated
- `agents/reviewer/` - Fully migrated
