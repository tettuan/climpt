# Step Flow Design

## Overview

Step flow is an execution model that defines agent execution as a chain of named
steps. Each step has an independent prompt, and completion checks and transition
conditions control the transition to the next step.

## Comparison with Traditional Model

### Traditional: Iteration-Based

```
iteration 1 -> initial prompt
iteration 2 -> continuation prompt (same)
iteration 3 -> continuation prompt (same)
...
```

- Simple, but difficult to handle different processing per phase
- Only one completion condition for the entire execution

### New Model: Step Flow

```
step "analyze"   -> analysis prompt -> check -> OK ->
step "implement" -> implement prompt -> check -> NG -> fallback ->
step "review"    -> review prompt -> check -> OK -> complete
```

- Dedicated prompt and check for each step
- Conditional branching, fallback, and retry are possible
- State machine-like control

---

## Schema

### steps_registry.json

```json
{
  "$schema": "https://raw.githubusercontent.com/tettuan/climpt/main/agents/schemas/steps_registry.schema.json",
  "version": "2.0.0",
  "basePath": "prompts",
  "entryStep": "s_a8f3",
  "steps": {
    "s_a8f3": {
      "id": "s_a8f3",
      "name": "Code Analysis",
      "prompt": {
        "c1": "steps",
        "c2": "phase",
        "c3": "analyze"
      },
      "iterations": { "min": 1, "max": 1 },
      "check": {
        "prompt": {
          "c1": "checks",
          "c2": "step",
          "c3": "analyze"
        },
        "responseFormat": {
          "result": "ok|ng",
          "message": "string"
        },
        "onPass": { "next": "s_b2c1" },
        "onFail": { "retry": true, "maxRetries": 2 }
      }
    },
    "s_b2c1": {
      "id": "s_b2c1",
      "name": "Implementation",
      "prompt": {
        "c1": "steps",
        "c2": "phase",
        "c3": "implement"
      },
      "iterations": { "min": 1, "max": 5 },
      "check": {
        "prompt": {
          "c1": "checks",
          "c2": "step",
          "c3": "implement"
        },
        "responseFormat": {
          "result": "ok|ng",
          "message": "string"
        },
        "onPass": { "next": "s_c9d4" },
        "onFail": { "fallback": "s_a8f3" }
      }
    },
    "s_c9d4": {
      "id": "s_c9d4",
      "name": "Review",
      "prompt": {
        "c1": "steps",
        "c2": "phase",
        "c3": "review"
      },
      "iterations": { "min": 1, "max": 1 },
      "check": {
        "prompt": {
          "c1": "checks",
          "c2": "completion",
          "c3": "final"
        },
        "responseFormat": {
          "result": "ok|ng",
          "message": "string"
        },
        "onPass": { "complete": true },
        "onFail": { "fallback": "s_b2c1" }
      }
    }
  }
}
```

---

## Components

### Step ID

- Format: `s_` + 4-8 digit hexadecimal hash
- Example: `s_a8f3`, `s_b2c1de`
- Identifier resistant to insertion and reordering

### PromptReference

Two methods for referencing prompt files:

**Path Specification:**

```json
{ "path": "system.md" }
```

**C3L Specification:**

```json
{
  "c1": "steps",
  "c2": "phase",
  "c3": "analyze",
  "edition": "default"
}
```

-> `prompts/steps/phase/analyze/f_default.md`

### IterationConfig

```json
{
  "min": 1, // Minimum execution count
  "max": 5 // Maximum execution count
}
```

- `min`: Minimum number of step executions (default: 1)
- `max`: Maximum number of step executions (default: 1)

### CheckDefinition

Check configuration at step completion:

```json
{
  "prompt": { "c1": "checks", "c2": "step", "c3": "analyze" },
  "responseFormat": {
    "result": "ok|ng",
    "message": "string"
  },
  "onPass": { "next": "s_b2c1" },
  "onFail": { "retry": true, "maxRetries": 2 }
}
```

### TransitionDefinition

Definition of transition destination:

| Property     | Description                         |
| ------------ | ----------------------------------- |
| `next`       | Next step ID                        |
| `fallback`   | Fallback step ID on failure         |
| `retry`      | Re-execute same step                |
| `maxRetries` | Maximum retry count (0 = unlimited) |
| `complete`   | Agent completion                    |

---

## Directory Structure

```
.agent/my-agent/
+-- agent.json
+-- steps_registry.json
+-- prompts/
    +-- system.md
    +-- steps/
    |   +-- phase/
    |       +-- analyze/
    |       |   +-- f_default.md
    |       +-- implement/
    |       |   +-- f_default.md
    |       +-- review/
    |           +-- f_default.md
    +-- checks/
        +-- step/
        |   +-- analyze/
        |   |   +-- f_default.md
        |   +-- implement/
        |       +-- f_default.md
        +-- completion/
            +-- final/
                +-- f_default.md
```

---

## Execution Flow

```
+-----------------------------------------------------+
|  [Start]                                             |
|     |                                               |
|     v                                               |
|  +----------+                                       |
|  | analyze  |<---------------------+               |
|  | (s_a8f3) |                      |               |
|  +----+-----+                      |               |
|       | check                      |               |
|       +-- OK --+                   |               |
|       +-- NG --+ retry (max 2)     |               |
|                |                   |               |
|                v                   |               |
|  +----------+                      |               |
|  |implement |                      |               |
|  | (s_b2c1) |                      |               |
|  +----+-----+                      |               |
|       | check                      |               |
|       +-- OK --+                   |               |
|       +-- NG --+-- fallback -------+               |
|                |                                    |
|                v                                    |
|  +----------+                                       |
|  |  review  |                                       |
|  | (s_c9d4) |                                       |
|  +----+-----+                                       |
|       | check                                       |
|       +-- OK -- [Complete]                          |
|       +-- NG -- fallback to implement              |
+-----------------------------------------------------+
```

---

## Writing Check Prompts

### Example: checks/step/implement/f_default.md

```markdown
## Implementation Check

Please verify the following conditions:

1. All tests are passing
2. No type errors
3. No linter errors

After verification, return results in the following format:

\`\`\`json { "result": "ok", "message": "All tests pass, no errors" } \`\`\`

Or

\`\`\`json { "result": "ng", "message": "2 test failures in test/auth.test.ts" }
\`\`\`
```

### Response Format

- `result`: `"ok"` | `"ng"` | `"pass"` | `"fail"` | `true` | `false`
- `message`: Arbitrary description string

---

## agent.json Usage

```json
{
  "name": "code-improver",
  "displayName": "Code Improver",
  "description": "Agent that analyzes and improves code",
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "stepFlow",
    "completionConfig": {},
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "permissionMode": "acceptEdits"
  },
  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  },
  "logging": {
    "directory": "tmp/logs/agents/code-improver",
    "format": "jsonl"
  }
}
```

---

## Programmatic API

```typescript
import { loadAgentDefinition, StepFlowRunner } from "climpt-agents";

const definition = await loadAgentDefinition("code-improver");
const runner = new StepFlowRunner(definition);

const result = await runner.run({
  args: {
    topic: "Refactoring authentication module",
  },
  cwd: Deno.cwd(),
});

console.log(`Success: ${result.success}`);
console.log(`Final Step: ${result.finalStepId}`);
console.log(`Completion: ${result.completionReason}`);

// Check history
for (const entry of result.state.history) {
  console.log(
    `${entry.stepId}: ${entry.transition} (${
      entry.checkResult?.message ?? ""
    })`,
  );
}
```

---

## Design Points

### Why Use Hash for Step ID

1. **Resistant to insertion**: Sequential numbers cause shifts when inserting
2. **Resistant to reordering**: ID is unchanged when flow order changes
3. **Reference stability**: Fallback target IDs don't change

### Why Separate Checks

1. **Separation of concerns**: Separate execution prompts from evaluation
   prompts
2. **Reusability**: Same check can be used by multiple steps
3. **Testability**: Check logic can be tested independently

### Why Use C3L Structure

1. **Climpt integration**: Variable substitution and conditional branching
   available
2. **Edition management**: Different variations of the same step
3. **Structure**: Directory structure clarifies meaning

---

## Limitations

- Maximum total iterations: 100 (infinite loop prevention)
- Check response parse failure: Treated as NG
- Step definition not found: Error termination
