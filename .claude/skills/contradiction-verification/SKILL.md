---
name: contradiction-verification
description: This skill should be used when proving a reported problem actually exists before fixing it. It is invoked after investigation (fix-checklist) and before implementation. Relevant phrases - "矛盾を検証", "矛盾の存在証明", "verify contradiction", "prove the bug exists", "both-sides test", "両面テスト", "検証ポイント設計", "存在証明", "contradiction proof", "existence proof".
allowed-tools: [Read, Glob, Grep, Write, Edit, Bash, Agent]
---

# Contradiction Verification

Prove that a reported problem exists with both-sides tests before attempting to fix it.

## Position in Workflow

```
fix-checklist (investigate) → contradiction-verification (prove) → implementation (fix)
                                        ↑
service-consistency (scan) ─────────────┘  (standalone entry)
```

Consume investigation output from fix-checklist. Produce verification tests and structured results. Do NOT modify production code.

## Entry Modes

### A. Investigation-driven (default)

Consume fix-checklist output from `tmp/investigation/<issue>/`. This is the standard flow for known bugs.

### B. Standalone scan

Scan for contradictions directly without prior investigation. Use when verifying service consistency or auditing a module proactively.

**Procedure:**

1. **Define scope** — Identify the target module (e.g., `agents/`, `src/docs/`)
2. **Collect design intent** — Read `docs/internal/` and schema files for the target
3. **Collect implementation facts** — Grep exports, defaults, error paths, config keys
4. **Pattern-match** — For each design↔implementation pair, check against the 6 contradiction patterns (Asymmetry, Catch-22, Silent Overwrite, Naming Mismatch, Channel Bypass, Graceful Miss)
5. **Build verification table** — Same format as Step 2, but derived from scan rather than investigation

Standalone scan skips Step 1 (Consume Investigation) and enters directly at Step 2 (Design Verification Points). All subsequent steps (3-5) apply unchanged.

**Quick scan commands:**

```bash
# Design → Implementation: find undocumented exports
grep "^export" src/<module>/mod.ts | sort > $TMPDIR/exports.txt
grep -oE '`[a-zA-Z]+`' docs/internal/<design>.md | tr -d '`' | sort > $TMPDIR/documented.txt
diff $TMPDIR/documented.txt $TMPDIR/exports.txt

# Config → Runtime: find unvalidated config keys
grep -roh '{[a-z_]*}' agents/prompts/ | sort -u > $TMPDIR/template-vars.txt
grep -roh '"[a-z_]*"' agents/common/uv*.ts | sort -u > $TMPDIR/runtime-vars.txt
diff $TMPDIR/template-vars.txt $TMPDIR/runtime-vars.txt
```

## The Both-Sides Rule

Every contradiction test must verify BOTH sides:
- **Expected behavior (design intent)** — assert what SHOULD happen. Proves the fix path exists.
- **Actual behavior (contradiction)** — assert what DOES happen. Proves the problem.

A test that only shows failure is not a contradiction proof. The companion assertion demonstrating expected behavior is required.

## Step 1: Consume Investigation

Read fix-checklist output from `tmp/investigation/<issue>/` or equivalent documentation. Extract:
- Root cause from `root-cause.md`
- Affected components from `trace.md`
- Design intent from `overview.md`

If no investigation output exists: use standalone scan mode (Entry Mode B above) or run `/fix-checklist` first.

## Step 2: Design Verification Points

Build a verification point table for each contradiction:

| # | Contradiction | Test content | Expected (design) | Actual (contradiction) |
|---|--------------|-------------|-------------------|----------------------|

Group related issues by root cause:
- Issues sharing a root cause go in the same test file
- Independent issues may be grouped by pattern similarity

Identify which verification pattern applies to each issue. For the pattern catalog (Asymmetry, Catch-22, Silent Overwrite, Naming Mismatch, Channel Bypass, Graceful Miss), read `references/verification-patterns.md`.

## Step 3: Write Both-Sides Tests

Create test files following these principles:

**Self-containment** — Replicate minimal production logic locally rather than importing production modules. Import only `@std/assert`. This makes the proof independent of codebase state and survives when the fix is applied.

**Both-sides assertion** — Every "actual behavior" test has a companion "expected behavior" test.

**Naming** — Test names: `Issue NN-x -- <description>`. File names: `<scope>/<descriptive-name>_test.ts`.

## Step 4: Execute Tests

Run all verification tests:

```bash
deno test --no-lock <test-files>
```

All tests must PASS. A PASS means the contradiction is confirmed. A FAIL means the contradiction does not exist (or the test is wrong).

## Step 5: Record Results

Write output to `tmp/<task>/verification/`:

**results.md** — Summary table + per-group detail:

| Group | Test file | Tests | Target Issues | Result |
|-------|----------|-------|--------------|--------|

Per-test detail:

| Test | Contradiction verified | Method | Proof |
|------|----------------------|--------|-------|

**test-files.md** — File locations, execution commands, permission requirements.

## Checklist

- [ ] Investigation output consumed
- [ ] Verification point table designed (both sides for each contradiction)
- [ ] Issues grouped by root cause or similarity
- [ ] Tests are self-contained (minimal production imports)
- [ ] Each test asserts both expected and actual behavior
- [ ] All tests PASS (confirming contradiction exists)
- [ ] results.md written with summary + per-test detail
- [ ] test-files.md written with locations and execution commands
- [ ] No production code was modified

## Anti-Patterns

| Bad | Good |
|-----|------|
| Test that only shows the error | Test that shows BOTH expected and actual |
| Importing full production modules | Replicate minimal logic locally |
| Fixing the code while verifying | Verification only, no fixes |
| Single test per issue | Both-sides: contradiction + fix-path |
| Flat list of issues | Grouped by root cause |

## Delegation

When verifying 3+ issues, use Conductor pattern:
1. Group issues into independent sets
2. Delegate each group to a TestWriter sub-agent (general-purpose)
3. Run a Verifier sub-agent to execute all tests
4. Record results

## Reference

For the contradiction pattern catalog with recognition signals, test structures, and real examples, read `references/verification-patterns.md` in this skill's directory.

## Related Skills

| Skill | Relationship |
|-------|-------------|
| fix-checklist | Upstream: produces investigation output this skill consumes |
| functional-testing | Downstream: verification tests follow functional testing patterns |
| work-process | Delegation: Conductor pattern for multi-issue verification |
| service-consistency | Caller: invokes standalone scan mode for proactive verification |
