---
name: service-consistency
description: Verify end-to-end service consistency across design, implementation, docs, tests, and user experience. Use when auditing a module or feature for gaps before release, or when user mentions 'service consistency', 'consistency check', 'gap audit', '一貫性', 'サービス整合', '品質チェック', 'verify everything'. Orchestrates docs-consistency, functional-testing, contradiction-verification, and refactoring skills.
allowed-tools: [Read, Glob, Grep, Write, Edit, Bash, Agent]
argument-hint: [target-module-or-feature]
---

# Service Consistency

Verify that a module or feature is consistent across all layers: design intent, implementation, documentation, tests, and user experience. Produce a gap report with prioritized fix actions.

## When to Use

- Before release: audit a feature for completeness
- After major refactoring: verify nothing was lost
- Periodic health check: proactive quality scan
- New module: verify all layers are wired up

## Principle

A service is consistent when a user can discover it (guides), configure it (help), execute it (runtime), recover from errors (diagnostics), and every layer agrees on what it does (design = code = docs = tests).

## Phase Overview

```
Phase 1: Inventory      — What exists?
Phase 2: Coverage        — Is each feature documented and tested?
Phase 3: Consistency     — Do design, code, and docs agree?
Phase 4: Pathway         — Can a user navigate without dead ends?
Phase 5: Diagnostics     — Do errors help the user?
Phase 6: Report          — Gap table + fix plan
```

## Phase 1: Inventory

Enumerate the target module's features, configs, and APIs.

**Inputs:** Module path (e.g., `agents/`, `src/docs/`)

**Procedure:**

1. List public exports: `grep "^export" <module>/mod.ts`
2. List CLI commands/options: `grep -rE "\.option|\.flag|--" <module>/ --include="*.ts"`
3. List config keys: `jq -r '.properties | keys[]' <schema>.json` or grep config types
4. List design docs: `ls docs/internal/ | grep <module-name>`

**Output:** `tmp/<task>/inventory.md`

| # | Feature | Source | Type |
|---|---------|--------|------|
| 1 | `install()` | `src/docs/mod.ts:5` | API |
| 2 | `--mode` | `src/docs/cli.ts:22` | CLI option |
| 3 | `output_dir` | `agent.schema.json` | Config key |

## Phase 2: Coverage

For each inventory item, check documentation and test existence.

**Delegate to:** `docs-consistency` (Phase 1-3) and `functional-testing` (G. Coverage Inventory)

**Procedure:**

For each feature in inventory:

| # | Feature | Guide? | --help? | Test file? | Validator? |
|---|---------|:------:|:-------:|:----------:|:----------:|
| 1 | `install()` | Yes | Yes | Yes | — |
| 2 | `--mode` | Yes | No | **Missing** | — |
| 3 | `output_dir` | **Missing** | — | Yes | Yes |

**Gaps found here become Phase 6 fix items.**

## Phase 3: Consistency

Verify design, implementation, and documentation agree.

**Delegate to:** `docs-consistency` (SEMANTIC-CHECK triangle) and `contradiction-verification` (standalone scan mode)

**Sub-steps:**

1. **Design ↔ Implementation** — Do exported APIs match design doc signatures?
2. **Implementation ↔ Docs** — Do documented behaviors match actual behavior?
3. **Design ↔ Docs** — Does the user explanation convey the design intent?
4. **Duplicate detection** — Are there two implementations or two docs for the same concept?

**Procedure:**

```bash
# Design vs Implementation: exported function signatures
grep -E "^(export|async|function)" docs/internal/<design>.md > $TMPDIR/design-api.txt
grep "^export" <module>/mod.ts > $TMPDIR/impl-api.txt
diff $TMPDIR/design-api.txt $TMPDIR/impl-api.txt

# Duplicate detection: same concept in multiple docs
grep -rl "<concept>" docs/ --include="*.md" | sort
```

For each mismatch, identify the contradiction pattern (Asymmetry, Naming Mismatch, etc.) per `contradiction-verification` skill.

**Output:** Contradiction table appended to `tmp/<task>/consistency.md`

## Phase 4: Pathway

Verify the user journey has no dead ends.

**Delegate to:** `docs-consistency` (Pathway Verification section)

**User journey stages:**

```
Onboarding → Configuration → Execution → Error → Recovery
```

For each stage:

| Stage | Entry point | Guide | Help | Validator | Error → fix? |
|-------|------------|:-----:|:----:|:---------:|:------------:|
| Onboarding | README | Yes | — | — | — |
| Configuration | agent.json | Yes | `--help` | Schema | Yes |
| Execution | `climpt run` | Yes | `--help` | — | Yes |
| Error | runtime failure | — | — | — | **No guide** |
| Recovery | — | **Missing** | — | — | — |

**Dead end = any stage where the user has no documented next step.**

## Phase 5: Diagnostics

Audit error messages for actionability.

**Delegate to:** `functional-testing` (H. Error Message Audit)

**Procedure:**

1. Grep all throw/error sites in the target module
2. For each error, evaluate What/Where/How-to-fix
3. Classify:

| Grade | Criteria |
|-------|----------|
| A | All three present (What + Where + How-to-fix) |
| B | What + Where, missing How-to-fix |
| C | What only |
| F | Generic or empty message |

**Target:** No Grade C or F errors in user-facing code paths.

## Phase 6: Report

Consolidate all findings into a single gap report.

**Output:** `tmp/<task>/service-consistency-report.md`

### Report Structure

```markdown
# Service Consistency Report: <module>

## Summary
| Phase | Items checked | Gaps found |
|-------|:------------:|:----------:|

## Gap Table
| # | Phase | Gap | Severity | Fix action | Delegate to |
|---|-------|-----|----------|------------|-------------|
| 1 | Coverage | --mode missing from --help | High | Add to help text | docs-consistency |
| 2 | Consistency | API signature mismatch | Critical | Update design doc | — |
| 3 | Pathway | No recovery guide for auth error | Medium | Write guide | docs-consistency |
| 4 | Diagnostics | "Error" with no context in cli.ts:42 | High | Add What/Where/How | — |

## Fix Priority
1. Critical: Design ↔ Implementation contradictions
2. High: Missing docs/help for existing features, Grade F errors
3. Medium: User pathway dead ends, Grade C errors
4. Low: Missing test files for covered features
```

## Delegation Strategy

Use `work-process` conductor pattern. Conductor runs Phases 1, 2 (inventory/coverage table), 6 (report), and delegates:

| Phase | Agent type | Skill |
|-------|-----------|-------|
| 2 (docs check) | general-purpose | `docs-consistency` |
| 2 (test check) | Explore | `functional-testing` (G) |
| 3 | general-purpose | `contradiction-verification` (standalone scan) |
| 4 | Explore | `docs-consistency` (Pathway) |
| 5 | general-purpose | `functional-testing` (H) |

For small modules (< 10 features), Phases 2-5 can run sequentially without delegation.

## Checklist

```
Phase 1: - [ ] Inventory table written (features, configs, APIs)
Phase 2: - [ ] Coverage table: every feature checked for guide, help, test, validator
Phase 3: - [ ] Consistency: design ↔ implementation ↔ docs triangle verified
         - [ ] No semantic duplicates across docs
Phase 4: - [ ] User journey: all 5 stages navigable, no dead ends
Phase 5: - [ ] Error audit: no Grade C/F errors in user-facing paths
Phase 6: - [ ] Gap report written with severity and fix delegation
         - [ ] Fix items assigned to responsible skill
```

## Related Skills

| Skill | Role in service-consistency |
|-------|---------------------------|
| `work-process` | Orchestration (verify mode) |
| `docs-consistency` | Phase 2 (docs), Phase 4 (pathway) |
| `functional-testing` | Phase 2 (tests), Phase 5 (error audit) |
| `contradiction-verification` | Phase 3 (standalone scan) |
| `refactoring` | Phase 3 (duplicate detection, consumer audit) |
| `test-design` | Phase 2 (test quality evaluation) |
