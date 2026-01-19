---
name: functional-testing
description: Use when implementing tests, writing test cases, discussing test strategy, or reviewing test code. Guides testing to bridge design documents and implementation, focusing on system boundaries.
allowed-tools: [Read, Glob, Grep, Write, Edit, Bash]
---

# Functional Testing Skill

テストは「設計の思想を守り、実装を試す」ための橋渡しである。

## Core Principle

```
Design Document  →  Test  →  Implementation
    (守る)         (橋)       (試す)
```

## 1. Design Document Dependency

### Tests Must Reference Design

テストを書く前に、依存する設計資料を明確にする:

| Artifact | Location | Purpose |
|----------|----------|---------|
| Architecture | `docs/` or `agents/docs/` | System boundaries, component relationships |
| API Schema | `*.schema.json`, OpenAPI specs | Input/output contracts |
| Type Definitions | `types.ts`, `*.d.ts` | Data structure contracts |
| Config Specs | `config.json`, `*_registry.json` | Required configuration shape |

### Test File Header Pattern

```typescript
/**
 * @design_ref agents/docs/03_runner.md
 * @design_ref agents/schemas/agent.schema.json
 *
 * Tests workflow routing logic against design specification.
 */
```

### Before Writing Tests

1. Identify which design document defines the behavior
2. Extract the contract (input/output/boundary)
3. Write test to verify the contract, not the implementation detail

## 2. Design-Implementation Bridge

### What Tests Protect vs What They Test

```
+-------------------+------------------------+
|   PROTECT         |   TEST                 |
| (Design Intent)   | (Implementation)       |
+-------------------+------------------------+
| API contracts     | Actual function calls  |
| Data shapes       | Real data processing   |
| Error categories  | Exception handling     |
| Config structure  | Config loading code    |
| Naming conventions| File/directory access  |
+-------------------+------------------------+
```

### Test Assertion Strategy

```typescript
// BAD: Testing implementation detail
assertEquals(result._internalCache.size, 3);

// GOOD: Testing design contract
assertEquals(result.items.length, 3);
assertEquals(result.status, "completed");
```

### Design Expression in Tests

```typescript
// Design says: "Steps must have stepId matching pattern {c2}.{c3}"
Deno.test("step ID follows C2.C3 pattern", () => {
  const step = registry.getStep("initial.issue");
  assertMatch(step.stepId, /^[a-z]+\.[a-z]+$/);
});

// Design says: "Config must have prompts.registry path"
Deno.test("config contains required prompts section", () => {
  const config = loadConfig("config.json");
  assertExists(config.prompts);
  assertExists(config.prompts.registry);
});
```

## 3. System Boundary Testing

### Boundary Categories

#### A. API Boundaries

```typescript
// Function signature contract
Deno.test("resolveStepPrompt returns PromptResult", async () => {
  const result = await resolveStepPrompt(stepId, uvVars);

  // Type shape assertion (design contract)
  assertExists(result.content);
  assertExists(result.path);
  assertEquals(typeof result.content, "string");
});

// Error boundary
Deno.test("invalid stepId throws StepNotFoundError", async () => {
  await assertRejects(
    () => resolveStepPrompt("invalid.step", {}),
    StepNotFoundError,
  );
});
```

#### B. Value Passing

```typescript
// UV variable propagation (design requirement)
Deno.test("UV variables are substituted in prompt", async () => {
  const result = await resolveStepPrompt("initial.issue", {
    "uv-issue_number": "123",
  });

  assertStringIncludes(result.content, "123");
  assertNotMatch(result.content, /\{uv-issue_number\}/);
});
```

#### C. Existence Confirmation

```typescript
// Required files exist
Deno.test("required config files exist", async () => {
  const requiredFiles = [
    "config.json",
    "registry.json",
    "prompts/system.md",
  ];

  for (const file of requiredFiles) {
    const stat = await Deno.stat(join(agentDir, file)).catch(() => null);
    assertExists(stat, `Required file missing: ${file}`);
  }
});

// Required exports exist
Deno.test("module exports required functions", () => {
  assertExists(mod.runIterator);
  assertExists(mod.runReviewer);
  assertEquals(typeof mod.runIterator, "function");
});
```

#### D. Configuration Processing

```typescript
// Config validation
Deno.test("config passes schema validation", () => {
  const config = loadConfig("config.json");
  const errors = validateAgainstSchema(config, agentSchema);

  assertEquals(errors, [], "Config should match schema");
});

// Default value handling
Deno.test("missing optional fields get defaults", () => {
  const config = loadConfig("minimal-config.json");

  assertEquals(config.logging?.maxFiles ?? 100, 100);
});
```

#### E. Design-Essential Naming

```typescript
// Directory structure convention
Deno.test("prompts follow C3L directory structure", async () => {
  const stepsDir = join(agentDir, "prompts/steps");

  // C2 directories
  const c2Dirs = ["initial", "continuation"];
  for (const c2 of c2Dirs) {
    const stat = await Deno.stat(join(stepsDir, c2)).catch(() => null);
    assertExists(stat, `C2 directory missing: ${c2}`);
  }
});

// File naming pattern
Deno.test("prompt files follow f_{edition}_{adaptation}.md pattern", async () => {
  const files = await glob("prompts/steps/**/*.md", agentDir);

  for (const file of files) {
    const basename = file.split("/").pop()!;
    assertMatch(
      basename,
      /^f_[a-z]+(_[a-z]+)?\.md$/,
      `Invalid prompt filename: ${basename}`,
    );
  }
});
```

## 4. Test Structure Template

```typescript
/**
 * @design_ref path/to/design/document.md
 * @boundary API | Config | FileSystem | Naming
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";

// Setup: Load design-specified fixtures
const testConfig = await loadTestConfig();

// Group 1: Existence tests
Deno.test("required components exist", () => {
  // Files, exports, config keys
});

// Group 2: Contract tests
Deno.test("function returns expected shape", () => {
  // Input/output contracts
});

// Group 3: Boundary tests
Deno.test("invalid input is rejected", () => {
  // Error handling at boundaries
});

// Group 4: Integration tests
Deno.test("components work together", () => {
  // Cross-boundary flows
});
```

## 5. Checklist

Before committing tests:

- [ ] Design document reference is documented
- [ ] Tests verify design contracts, not implementation details
- [ ] All system boundaries are covered
- [ ] Required file/directory existence is verified
- [ ] Naming conventions are enforced
- [ ] Error boundaries are tested
- [ ] No absolute paths in test code
