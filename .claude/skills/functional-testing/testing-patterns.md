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

## Test Ordering

Progress from coarse to fine. If existence fails, contract/enforcement tests are meaningless.

```
1. Existence  — required files, exports, config keys present
2. Contract   — input/output shapes match spec
3. Enforcement — violations produce errors, not warnings
4. Alignment  — confirm what IS working correctly
```
