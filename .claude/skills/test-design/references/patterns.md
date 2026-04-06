# Test Design Patterns — Implementation Reference

## Contract Test

### Theory

From Consumer-Driven Contracts (Ian Robinson): the consumer declares what it needs, and the provider is tested against that declaration.

The key: **import the consumer's declaration**. Do not copy it into the test.

### Implementation

```typescript
// Source of truth: the runner's hardcoded phases
import { STEP_PHASE } from "../shared/step-phases.ts";

// Derived automatically — no manual list to maintain
const REQUIRED = Object.values(STEP_PHASE);

Deno.test("user.yml directiveType includes all STEP_PHASE values", async () => {
  const yml = await Deno.readTextFile("config/iterator-steps-user.yml");
  const pattern = extractDirectiveTypePattern(yml);

  const missing = REQUIRED.filter(v => !pattern.test(v));
  assert(
    missing.length === 0,
    `Fix: Add [${missing.join(", ")}] to directiveType.pattern in config/iterator-steps-user.yml. ` +
      `These phases are runner-required (defined in agents/shared/step-phases.ts). ` +
      `Current pattern allows: [${extractPatternValues(pattern).join(", ")}].`,
  );
});
```

### Why import, not copy

```typescript
// BAD: manual list — if STEP_PHASE adds "preparation", this test won't catch the gap
const REQUIRED = ["initial", "continuation", "closure"];

// GOOD: derived from source — any change to STEP_PHASE automatically propagates
const REQUIRED = Object.values(STEP_PHASE);
```

The manual list is a synchronization point. It requires a human to remember to update the test when the source changes. `Object.values()` eliminates that dependency.

### Error message: single direction

Contract tests have one correct fix direction: the provider must conform to the consumer. The error message reflects this:

```
Fix: Add [X] to <provider-file>.
These values are required by <consumer-module>.
```

No IF/THEN needed — the consumer is authoritative.

---

## Conformance Test

### Theory

Two peer configurations must agree, but neither is the sole authority. Either could have been intentionally changed.

### Implementation

```typescript
Deno.test("registry c2 values match user.yml directiveType", async () => {
  const registry = JSON.parse(await Deno.readTextFile("steps_registry.json"));
  const yml = await Deno.readTextFile("config/steps-user.yml");
  const pattern = extractDirectiveTypePattern(yml);

  const c2Values = [...new Set(Object.values(registry.steps).map(s => s.c2))];
  const missing = c2Values.filter(v => !pattern.test(v));

  assert(
    missing.length === 0,
    `Mismatch: steps_registry.json uses c2 values [${missing.join(", ")}] ` +
      `not in steps-user.yml directiveType pattern. ` +
      `IF you added a new step to steps_registry.json, ` +
        `THEN add the c2 value to user.yml directiveType.pattern. ` +
      `IF you intentionally narrowed user.yml, ` +
        `THEN remove the step from steps_registry.json.`,
  );
});
```

### Error message: IF/THEN branching

Conformance tests present both valid fix directions:

```
IF <intent A>, THEN <fix A>.
IF <intent B>, THEN <fix B>.
```

The developer chooses based on their intent. The test cannot know which side is "right" — only that they disagree.

---

## Invariant Test

### Theory

From Property-Based Testing (QuickCheck, Claessen & Hughes 2000): test a property that holds for all members, not a specific example.

### Implementation

```typescript
Deno.test("every registry step has a corresponding prompt file", async () => {
  const registry = JSON.parse(await Deno.readTextFile("steps_registry.json"));
  const steps = Object.entries(registry.steps);

  // Guard: non-vacuity
  assert(steps.length > 0, "Registry has no steps — test would pass vacuously");

  for (const [id, step] of steps) {
    const path = `prompts/${step.c2}/${step.c3}/f_${step.edition ?? "default"}.md`;
    const exists = await fileExists(path);
    assert(exists, `Step "${id}" references missing prompt file: ${path}`);
  }
});
```

### Non-vacuity guard

An invariant test over an empty collection always passes. This is a silent lie. Always assert the collection is non-empty:

```typescript
// BAD: if steps is empty, the loop never executes, test passes
for (const step of steps) { assert(valid(step)); }

// GOOD: explicit guard
assert(steps.length > 0, "No steps to validate — check registry path");
for (const step of steps) { assert(valid(step)); }
```

---

## Layered Verification

### Theory

Combine Contract + Conformance in layers when a system has both hard requirements (from code) and soft requirements (from config).

### Structure

```
Layer 1 (Contract):     Code constants → Config
                        "Config must include what code requires"
                        Error: "Fix config"

Layer 2 (Conformance):  Config A ↔ Config B
                        "Two configs must agree"
                        Error: IF/THEN
```

### Why layering matters

Layer 1 catches the non-negotiable requirements first. If Layer 1 fails, Layer 2 results are meaningless. If Layer 1 passes but Layer 2 fails, the developer knows the issue is config-specific, not a system requirement violation.

---

## Validator Test

Four aspects — each with a minimal fixture mutated per test:

```typescript
// Acceptance: valid input passes
const result = await validate(createMinimalAgent());
assertEquals(result.valid, true,
  `Valid agent rejected: ${result.errors.join(", ")}`);

// Rejection: invalid input caught
delete agent.runner.verdict.type;
assertEquals((await validate(agent)).valid, false);

// Diagnosis: error message is actionable (What + How-to-fix)
assertStringIncludes(result.errors[0], "verdict.type");

// Completeness: every design-required field has a validation rule
for (const field of DESIGN_REQUIRED) {
  deleteNestedField(createMinimalAgent(), field);
  assert(!validate(agent).valid,
    `No validation for "${field}". Fix: Add rule in validator.ts.`);
}
```

---

## Anti-Pattern: Validator Bypass

Test checks config directly when a validator exists, creating two verification paths that diverge.

```typescript
// BAD: test reimplements validator's rule (stale if validator changes)
assertMatch(config.name, /^[a-z][a-z0-9-]*$/);

// GOOD: test delegates to validator
assertEquals(validate(config).valid, true);
```

Detection: `grep -rn "assertMatch.*config\." tests/ --include="*_test.ts" | grep -v "validate"`

---

## Deriving Expected Values

### Decision table

| Source | Derivation Method | Example |
|--------|-------------------|---------|
| TypeScript const/enum | `import` + `Object.values()` | `STEP_PHASE` |
| JSON schema | `JSON.parse()` + traverse | `required` fields |
| YAML config | Parse + extract | `directiveType.pattern` |
| Directory structure | `Glob` / `readDir` | Agent directories |
| Design document | `@design_ref` annotation | Allowed intents |

### Rule: one degree of separation

The test should be **at most one step** from the source of truth:

```
Source → Test expectation     ✓  (import, parse)
Source → Copy → Test          ✗  (manual sync point)
Source → Summary → Test       ✗  (lossy translation)
```

---

## Diagnosability

### Theory

**Diagnosability** (診断可能性): a test failure is diagnosable if the failure message alone is sufficient to identify the fix.

- Gerard Meszaros『xUnit Test Patterns』(2007): **Defect Localization** — テストの粒度・命名・エラーメッセージの質が、障害箇所特定の速度を決定する
- Microsoft Research: テスト失敗の診断コスト研究 — メッセージだけで修正先が分かるテストは、デバッガやログ調査を不要にする

### Key insight: test pattern determines message structure

テストパターンの選択がエラーメッセージの構造まで決定する。これは設計段階で決まる:

| Test Pattern | Fault Type | Root Cause | Message Form |
|-------------|-----------|------------|-------------|
| Contract Test | **Unambiguous** | Provider must conform to consumer | `Fix:` — single directive |
| Conformance Test | **Ambiguous** | Either side could be intentionally changed | `IF/THEN` — developer chooses |
| Invariant Test | **Unambiguous** | The violating member is wrong | `Fix:` — with specific member ID |

**Unambiguous fault** (一意な障害): 修正先が一つに定まる。Contract Test では consumer が権威なので、provider を直す以外の選択肢がない。

**Ambiguous fault** (曖昧な障害): どちらの変更が意図的か、テストには判断できない。IF/THEN 形式で開発者の意図に委ね、両方の修正パスを提示する。

### Application

Contract Test のエラーメッセージを書くとき:
- 修正先は一つ → `Fix:` で始める
- 権威の出典を明記する (e.g., "required by agents/shared/step-phases.ts")

Conformance Test のエラーメッセージを書くとき:
- 修正先が二つ → IF/THEN で分岐する
- 各分岐に「意図」を書く (e.g., "IF you added a new step", "IF you narrowed the pattern")
- 意図が修正先を決定する構造にする

---

## Error Message Template

### Single-fix (Contract)

```
Fix: <action> in <file-path>.
<Values> are required by <source-module> (<source-file>).
Current <target> allows: [<current-values>].
```

### Multi-fix (Conformance)

```
Mismatch: <file-A> declares [<values>] not in <file-B> <field> [<current>].
IF <intent-A>, THEN <fix-for-B>.
IF <intent-B>, THEN <fix-for-A>.
```

### Invariant violation

```
Step "<id>" violates invariant: <property>.
Expected: <what-should-hold>.
Actual: <what-was-found>.
Fix: <specific-action> in <file-path>.
```

---

## Anti-Pattern: Partial Consumer Enumeration

### Problem

A contract (e.g., "c2/c3 values must be in user.yml pattern") has multiple consumers (code paths that resolve C3L prompts), but the test only checks one of them. The unchecked consumers become blind spots.

### Real-world example

```
registry.steps         → checked by config-consistency_test ✓
registry.validationSteps → NOT checked                      ✗
RetryHandler            → NOT checked                      ✗
```

A new validation step with `c3: "external-state"` passes the test but fails at runtime when validation triggers a retry prompt lookup.

### Detection

Before writing a consistency test, enumerate ALL code paths that consume the contract:

```
grep -r "\.c2\b\|\.c3\b" agents/ --include="*.ts" -l
```

Each file that reads c2/c3 is a consumer. The test must cover all of them.

### Fix pattern

```typescript
// Collect c2/c3 from ALL C3L-bearing sections, not just steps
function collectAllC2C3(registry: FullRegistry): { c2: Set<string>; c3: Set<string> } {
  const c2 = new Set<string>();
  const c3 = new Set<string>();

  for (const step of Object.values(registry.steps)) {
    c2.add(step.c2); c3.add(step.c3);
  }
  for (const vstep of Object.values(registry.validationSteps ?? {})) {
    c2.add(vstep.c2); c3.add(vstep.c3);
  }
  // Add future C3L sections here
  return { c2, c3 };
}
```

---

## Anti-Pattern: Shadow Contract

### Problem

A parameterized value (e.g., `registry.c1`) is available but a code path hardcodes a specific value (e.g., `c1 = "steps"`), creating a dependency that bypasses the parameter. No test catches this because tests only exercise the default value.

### Real-world example

```typescript
// PromptResolver: uses registry.c1 ✓ (parameterized)
this.c3lLoader = new C3LPromptLoader({ configSuffix: registry.c1 });

// RetryHandler: hardcodes "steps" ✗ (shadow contract)
const c3lPath = { c1: "steps", c2: step.c2, c3: step.c3 };
```

If `registry.c1` changes to `"steps-v2"`, PromptResolver follows, but RetryHandler silently looks in the wrong directory.

### Detection

Search for literal values of parameters that should be derived:

```
grep -rn '"steps"' agents/ --include="*.ts" | grep -v test | grep -v _test
```

Any match outside of tests is a potential shadow contract.

### Fix pattern

1. Replace the hardcoded value with the parameterized source
2. Add a regression test with a non-default value:

```typescript
Deno.test("RetryHandler respects non-default c1", async () => {
  const registry = createRegistry({ c1: "steps-v2" });
  const handler = new RetryHandler(registry);
  // Verify the handler resolves paths under steps-v2/, not steps/
  const path = handler.buildPromptPath(step);
  assertStringIncludes(path, "steps-v2/");
});
```

The non-default value is the key: if every test uses `c1 = "steps"`, the shadow contract is invisible.
