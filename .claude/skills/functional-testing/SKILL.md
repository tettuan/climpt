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

When a validator exists, test the validator's behavior (acceptance/rejection/diagnosis/completeness) — not the config directly. See `test-design` skill (Validator as Test Boundary) for design patterns and examples.

### G. Coverage Inventory

Enumerate testable features from source and verify test files exist. Use when auditing test completeness for a module.

**Procedure:**

1. **Extract feature surface** — List public API from exports, CLI options from arg parser, config keys from schema
2. **Map to test files** — For each feature, find corresponding `*_test.ts` by convention (`<module>/<feature>_test.ts`)
3. **Build coverage table:**

| Feature | Source | Test file | Status |
|---------|--------|-----------|--------|
| `install()` | `src/docs/mod.ts:5` | `tests/docs/install_test.ts` | Covered |
| `--lang` filter | `src/docs/cli.ts:22` | — | **Missing** |

4. **Verify non-vacuity** — Each "Covered" test file must contain at least one assertion (not just an empty test)

```bash
# Extract exports as feature list
grep "^export" src/<module>/mod.ts

# Find corresponding test files
for f in $(grep -l "^export" src/<module>/*.ts); do
  base=$(basename "$f" .ts)
  ls tests/<module>/${base}_test.ts 2>/dev/null || echo "MISSING: tests/<module>/${base}_test.ts"
done
```

### H. Error Message Audit

Systematically evaluate all error messages for actionability. Every user-facing error must provide What/Where/How-to-fix.

**Procedure:**

1. **Grep all error sites:**

```bash
grep -rn "throw new\|new Error\|assertRejects\|reject(" src/ agents/ --include="*.ts" | grep -v _test.ts | grep -v node_modules
```

2. **Classify each error:**

| Location | Error text | What | Where | How-to-fix | Verdict |
|----------|-----------|------|-------|------------|---------|
| `src/cli.ts:42` | "Invalid option" | Yes | No | No | **Fix** |
| `agents/runner.ts:88` | "Step '{id}' failed: {reason}. Check agent.json steps field." | Yes | Yes | Yes | OK |

3. **Evaluation criteria:**

| Criterion | Question | Bad example | Good example |
|-----------|----------|-------------|--------------|
| What | Does it name the mismatch? | "Error" | "Unknown step type 'foo'" |
| Where | Does it name the file/field? | "Config error" | "agent.json: steps[2].type" |
| How-to-fix | Does it suggest the fix? | (nothing) | "Valid types: iterate, review, complete" |

4. **Priority:** Fix user-facing CLI errors first, then agent runtime errors, then internal errors.

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
- [ ] Coverage inventory: all public features have corresponding test files
- [ ] Error message audit: user-facing errors include What/Where/How-to-fix

## Reference

For the 3-layer consistency model, boundary test code examples, and test ordering rationale, read `references/testing-patterns.md` in this skill's directory.
