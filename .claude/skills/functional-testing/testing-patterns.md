# Testing Patterns Reference

## Three-Layer Consistency Model

Tests validate alignment across three sources of truth. Two matching but one diverging is a contract violation.

```
Design Doc (contract)  ↔  Scaffold (generated output)  ↔  Runtime (execution)
```

| Pair | What misalignment looks like |
|------|------------------------------|
| Design ↔ Scaffold | Scaffold missing a field the spec requires |
| Design ↔ Runtime | Runtime allows what the spec prohibits |
| Scaffold ↔ Runtime | Runtime ignores a value the scaffold provides |

## Boundary Testing Examples

### API boundary — verify output shape

```typescript
Deno.test("returns PromptResult shape", async () => {
  const result = await resolveStepPrompt(stepId, vars);
  assertExists(result.content);
  assertExists(result.path);
});
```

### Error boundary — verify typed rejection

```typescript
Deno.test("invalid input throws typed error", async () => {
  await assertRejects(() => fn("invalid"), SpecificError);
});
```

### Config boundary — verify schema and defaults

```typescript
Deno.test("missing required field fails validation", () => {
  assertThrows(() => validateConfig({}), ConfigError);
});
```

### Value pass boundary — verify substitution

```typescript
Deno.test("template variables are substituted", () => {
  const result = renderPrompt("Hello {{name}}", { name: "Agent" });
  assertEquals(result, "Hello Agent");
});
```

## Validator Boundary Examples

### Acceptance — valid input passes

```typescript
Deno.test("validator accepts minimal valid agent", async () => {
  const agent = createMinimalAgent();
  const result = await validate(agent);
  assertEquals(result.valid, true,
    `Valid agent rejected: ${result.errors.join(", ")}`);
});
```

### Rejection — invalid input caught with typed error

```typescript
Deno.test("validator rejects unreachable closure step", async () => {
  const registry = createMinimalRegistry({ /* no path to closure */ });
  const result = await validateFlowReachability(registry);
  assertEquals(result.valid, false);
  assertStringIncludes(result.errors[0], "closure");
});
```

### Diagnosis — error messages are actionable

```typescript
Deno.test("ConfigError includes code, designRule, and fix", async () => {
  const registry = createMinimalRegistry({ steps: {} });
  try {
    await validateStepRegistry(registry);
    unreachable();
  } catch (e) {
    assertInstanceOf(e, ConfigError);
    assertExists(e.code);        // machine-readable (e.g., "SR-INTENT-001")
    assertExists(e.designRule);  // why this constraint exists
    assertExists(e.fix);         // what to change
  }
});
```

### Completeness — all constraints covered

```typescript
Deno.test("every required field has a validation rule", () => {
  const REQUIRED = ["name", "displayName", "runner"];
  assert(REQUIRED.length > 0, "No fields to check — test is vacuous");

  for (const field of REQUIRED) {
    const agent = createMinimalAgent();
    delete agent[field];
    const result = validate(agent);
    assert(!result.valid,
      `No validation for required field "${field}". ` +
      `Fix: Add rule in validator.ts.`);
  }
});
```

## Test Ordering

Progress from coarse to fine. If existence fails, contract/enforcement tests are meaningless.

```
1. Existence  — required files, exports, config keys present
2. Contract   — input/output shapes match spec
3. Enforcement — violations produce errors, not warnings
4. Alignment  — confirm what IS working correctly
```
