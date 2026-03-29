# Verification Patterns

Catalog of contradiction patterns with test design guidance.
Each pattern includes: definition, recognition signals, both-sides test structure, and a real example.

## Pattern 1: Asymmetry

**Definition**: Two code paths that should behave identically produce different results for the same input.

**Recognition signals**:
- Two processors/handlers for the same concept
- Copy-paste code with one path missing a call
- Feature works in scenario A but fails in scenario B

**Both-sides test structure**:
1. Side A: Run input through Path 1, assert result
2. Side B: Run same input through Path 2, assert different result
3. Asymmetry proof: Assert Path 1 result !== Path 2 result

**Real example**: Flow Loop never calls `setUvVariables()` but Completion Loop does. Same template, same iteration, different substitution results.

## Pattern 2: Catch-22

**Definition**: No valid configuration exists — every option fails at some validation or runtime stage.

**Recognition signals**:
- "If I add X, Y breaks; if I remove X, Z breaks"
- Multiple validators with contradictory requirements
- Configuration works in isolation but not end-to-end

**Both-sides test structure**:
1. Config A: Set the option, run all validators, record pass/fail per validator
2. Config B: Unset the option, run all validators, record pass/fail per validator
3. Catch-22 proof: Assert neither Config A nor Config B produces all-pass

**Real example**: `previous_summary` declared in uvVariables passes template validation but fails at runtime; undeclared fails template validation outright.

## Pattern 3: Silent Overwrite

**Definition**: Data is lost without error because a later write overwrites an earlier write in the same namespace.

**Recognition signals**:
- `Object.assign()` / spread operator merging from multiple sources
- Flat namespace shared by multiple subsystems
- No collision detection or warning

**Both-sides test structure**:
1. Before: Set value from source A, assert value is present
2. After: Merge source B (using the same key), assert source A value is gone
3. Silent proof: Assert no error or warning was emitted during overwrite

**Real example**: Channel 4 handoff overwrites Channel 1 CLI param via `Object.assign()` with no collision detection.

## Pattern 4: Naming Mismatch

**Definition**: Documentation and implementation use different names for the same concept.

**Recognition signals**:
- Docs say "parameter X" but code uses "parameter Y"
- Template placeholder name differs from documented parameter name
- Configuration key in docs does not match actual config schema

**Both-sides test structure**:
1. Implementation name: Substitute/configure with the actual name, assert success
2. Documented name: Substitute/configure with the documented name, assert failure
3. Mismatch proof: Assert implementation name works but documented name does not

**Real example**: Fallback template uses `{uv-issue}` but documentation references `issue_number`. Substitution with `issue` succeeds; with `issue_number` the placeholder remains.

## Pattern 5: Channel Bypass

**Definition**: A variable is supplied outside the established delivery system, breaking the system's guarantees.

**Recognition signals**:
- Manual injection with spread operator or `Object.assign`
- Variable uses the system's naming convention but does not go through the system
- Works only because of ad-hoc code, not system design

**Both-sides test structure**:
1. Without bypass: Use only the system's channels, assert variable is absent
2. With bypass: Add manual injection, assert variable resolves
3. Bypass proof: Assert the variable is unreachable through any official channel

**Real example**: `uv-verdict_criteria` is manually injected in `resolveSystemPromptForIteration()`, bypassing the 4-Channel UV system entirely.

## Pattern 6: Graceful Miss

**Definition**: An unresolved placeholder or missing value is silently passed through instead of raising an error.

**Recognition signals**:
- `value ?? fallback` or `value ?? match` in template substitution
- No validation that all placeholders were resolved
- Output contains literal placeholder text like `{uv-xxx}`

**Both-sides test structure**:
1. With value: Supply the variable, assert placeholder is resolved
2. Without value: Omit the variable, assert literal placeholder survives in output
3. Graceful miss proof: Assert no error was thrown AND placeholder text remains

**Real example**: `{uv-max_iterations}` and `{uv-previous_summary}` remain as literal text when Channel 3 variables are absent, because `substitute()` returns the unmatched placeholder.

## Choosing the Right Pattern

| Signal | Pattern |
|--------|---------|
| Same input, two paths, different results | Asymmetry |
| Option A breaks X, removing A breaks Y | Catch-22 |
| Value changes without error | Silent Overwrite |
| Docs say one name, code uses another | Naming Mismatch |
| Variable works but not through the official system | Channel Bypass |
| Placeholder survives without error | Graceful Miss |

Multiple patterns may apply to a single issue. Choose the pattern that best describes the root mechanism.

## Test Design Principles

### Self-containment

Replicate minimal production logic in the test file rather than importing production modules. This prevents the test from breaking when the fix is applied and makes the contradiction proof independent of the codebase state.

Exception: When testing validators (e.g., Catch-22 pattern), import the actual validators since the contradiction is between the validators themselves.

### Both-sides assertion

Every contradiction test must have a companion that asserts the expected behavior. This serves dual purposes:
1. Proves the fix path exists (the contradiction is fixable)
2. After the fix, the contradiction test is updated to match the expected-behavior test

### Grouping strategy

Group by root cause, not by issue number:
- Issues sharing a root cause → same test file
- Independent issues → group by pattern similarity
- Each group becomes one test file

### Post-fix lifecycle

After the contradiction is fixed:
1. The "actual behavior" assertion is updated to match the "expected behavior" assertion
2. The test transforms from a contradiction proof into a regression test
3. If the test used local helpers, update them to match the fixed production code
