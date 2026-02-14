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

## Boundary Testing

| Boundary | Test focus |
|----------|-----------|
| API | Input/output shape, error types |
| Config | Schema validation, defaults |
| FileSystem | Required files exist |
| Value Pass | Variables substituted correctly |

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
