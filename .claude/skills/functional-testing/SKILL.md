---
name: functional-testing
description: Use when implementing tests, writing test cases, discussing test strategy, or reviewing test code. Guides testing to bridge design documents and implementation, focusing on system boundaries.
allowed-tools: [Read, Glob, Grep, Write, Edit, Bash]
---

# Functional Testing

Tests verify three-layer consistency (Design Doc ↔ Scaffold ↔ Runtime) by checking boundary contracts, not implementation details.

## Test Categories

### A. Contract Tests

Verify design constraints hold at runtime by referencing the design document.

```typescript
/** @design_ref agents/docs/design/08_step_flow.md */
Deno.test("stepId follows c2.c3 pattern", () => {
  assertMatch(step.stepId, /^[a-z]+\.[a-z]+$/);
});
```

### B. Enforcement Tests

Verify violations produce errors, not warnings. Existence of a constraint and enforcement of it are separate concerns.

```typescript
Deno.test("initial step handoff is rejected, not just warned", async () => {
  await assertRejects(
    () => processStep("initial.start", { handoff: true }),
    HandoffNotAllowedError,
  );
});
```

### C. Drift Detection

Detect divergence between any two layers before it becomes a silent bug.

| Layer Pair | What to check |
|------------|---------------|
| Spec ↔ Scaffold | Generated output includes all spec-required fields |
| Spec ↔ Runtime | Runtime respects spec constraints |
| Scaffold ↔ Runtime | Generated output is honored at runtime |
| Doc A ↔ Doc B | No contradictions across documents |

### D. Dead Reference Detection

Verify documented APIs and classes still exist in code, catching stale docs after refactoring.

```typescript
Deno.test("documented FlowController is actually used", () => {
  assertExists(mod.FlowController);
  assert(isUsedInRunner(mod.FlowController));
});
```

### E. Flow Path Verification

Verify design diagram transitions match actual code paths.

```typescript
Deno.test("repeat routes back to work step, not closure", async () => {
  const result = await router.handleRepeat("closure.verify");
  assertEquals(result.nextStep, "work.implement");
});
```

### F. Validator Testing

When a validator exists for a configuration or input, test the validator — not the config directly. The validator owns the correctness contract; the test verifies the validator honors it.

Four aspects to cover:

| Aspect | Verifies | Fails when |
|--------|----------|------------|
| Acceptance | Valid input passes | Validator falsely rejects correct config |
| Rejection | Invalid input is caught | Validator silently accepts bad config |
| Diagnosis | Error messages are actionable | Developer cannot locate fix from message alone |
| Completeness | All design constraints are checked | A required validation rule is missing |

```typescript
/** @design_ref agents/docs/design/agent_config.md */
Deno.test("validator rejects invalid permission mode", async () => {
  const agent = createMinimalAgent({ runner: { permissionMode: "invalid" } });
  const result = await validate(agent);
  assertEquals(result.valid, false);
  assertStringIncludes(result.errors[0], "permissionMode");
});

Deno.test("validation error includes fix guidance", async () => {
  const agent = createMinimalAgent({ name: "CAPS" });
  const result = await validate(agent);
  assertMatch(result.errors[0], /lowercase|pattern/i);
});
```

See `test-design` skill for design principles (source of truth, diagnosability) applied to validator tests.

## Boundary Testing

| Boundary | Test focus |
|----------|-----------|
| API | Input/output shape, error types |
| Config | Schema validation, defaults |
| FileSystem | Required files exist |
| Value Pass | Variables substituted correctly |
| Validator | Acceptance, rejection, error quality |

## Test Structure

Order tests by increasing specificity: existence → contract → enforcement → alignment.

```typescript
/** @design_ref path/to/design.md */
Deno.test("required components exist", ...);      // 1. Existence
Deno.test("function returns expected shape", ...); // 2. Contract
Deno.test("constraint violation throws error", ...); // 3. Enforcement
Deno.test("tool isolation matches design", ...);   // 4. Alignment
```

## Checklist

- [ ] Design document referenced (`@design_ref`)
- [ ] Tests verify contracts, not implementation details
- [ ] Enforcement tested (error, not just warning)
- [ ] Cross-layer consistency checked (spec ↔ scaffold ↔ runtime)
- [ ] Dead references detected
- [ ] Flow paths match diagrams
- [ ] Alignments reported (what works correctly)
- [ ] No absolute paths in test code
- [ ] After refactoring: Before/After contracts verified per `refactoring` skill Phase 2
- [ ] Validators tested (acceptance, rejection, diagnosis, completeness) — not bypassed

## Reference

For the 3-layer consistency model, boundary test code examples, and test ordering rationale, read `testing-patterns.md` in this skill's directory.
