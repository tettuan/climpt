---
name: docs-consistency
description: Verify and fix documentation to match implementation. Use when updating docs, releasing versions, or when user mentions 'docs consistency', 'docs update', 'docs verify', 'ドキュメント更新', '最新にして', 'docsを直して'. Extracts design intent, investigates implementation, then updates docs accordingly.
allowed-tools: [Read, Edit, Grep, Glob, Bash, Write]
---

# Docs Consistency

Docs explain implementation; they do not rewrite design. Flow: design intent (What/Why) → implementation survey (How) → docs update (explanation).

## Phase 1: Extract Design Intent

Read design docs (`docs/internal/`) and write `tmp/docs-review/{feature}-intent.md` capturing What, Why, constraints, and what users need to know.

## Phase 2: Survey Implementation

Identify implementation files, public API, defaults, and edge cases. Write `tmp/docs-review/{feature}-implementation.md`.

## Phase 3: Diff Against Current Docs

Compare intent + implementation memos against current docs. Build a diff table:

| Item | Design/Implementation | Current docs | Gap |
|------|----------------------|-------------|-----|
| Install command | `dx jsr:...` | Documented | None |
| 3 output modes | preserve/flatten/single | Missing | Add |
| Default output dir | ./climpt-docs | Missing | Add |

### Conciseness Check

After building the diff table, verify every existing doc sentence follows these rules:

- **One sentence per item**: Each feature, option, or behavior is described in exactly one sentence.
- **Dense**: No filler words, no hedging, no redundancy — pack information into the shortest form that remains unambiguous.

Flag violations in the diff table with Gap = "Shorten".

## Phase 4: Fix Docs

Do not change design docs — only update implementation-facing docs.

| Priority | Target |
|----------|--------|
| 1 | README.md |
| 2 | README.ja.md (sync required) |
| 3 | docs/guides/ |
| 4 | --help output |

Use intent/implementation memos as source material for writing.

### Memo disposition after fix

| Situation | Action |
|-----------|--------|
| Low value (simple fix) | Delete `tmp/docs-review/` |
| Useful for PR description | Quote in PR |
| Worth preserving as design record | Promote to `docs/internal/changes/` |

## Phase 5: Format Check

```bash
deno task verify-docs          # all checks
deno task verify-docs readme   # README.md/ja sync
deno task verify-docs manifest # manifest.json version
```

When docs files are added or removed: `deno task generate-docs-manifest`.

## Phase 6: Language

| Pattern | Language |
|---------|---------|
| `*.md` | English (required) |
| `*.ja.md` | Japanese (optional, not distributed via JSR) |

Japanese-only files: rename to `.ja.md`, create English `.md` translation, then regenerate manifest.

## Pathway Verification

Verify the user journey flows smoothly across guides, help, and validation. A user should never hit a dead end or encounter an undocumented state.

### User Journey Stages

```
Onboarding → Configuration → Execution → Error → Recovery
```

### Verification Table

For each stage, check that the pathway is documented and navigable:

| Stage | Guide exists? | --help covers it? | Validator catches mistakes? | Error points to fix? |
|-------|:------------:|:-----------------:|:--------------------------:|:-------------------:|
| Onboarding | README § Getting Started | `climpt --help` | — | — |
| Configuration | docs/guides/en/ | `climpt <cmd> --help` | Schema validation | Error names the field |
| Execution | docs/guides/en/ | — | Runtime checks | Error names the step |
| Error | — | — | — | Error includes How-to-fix |
| Recovery | docs/guides/en/ or FAQ | — | Re-validation | — |

### Procedure

1. **List entry points** — All CLI commands and config files a user interacts with
2. **Walk each stage** — For each entry point, trace: what does the user read first? → what do they configure? → what happens on error?
3. **Find dead ends** — A dead end is where the user encounters an error with no documented recovery path
4. **Check cross-references** — Error messages should reference the guide that explains the fix. Guides should mention what errors to expect.

### Quick checks

```bash
# Commands mentioned in README but missing from --help
grep -oE 'climpt [a-z-]+' README.md | sort -u > $TMPDIR/readme-cmds.txt
deno run -A mod.ts --help 2>&1 | grep -oE '[a-z-]+' > $TMPDIR/help-cmds.txt
diff $TMPDIR/readme-cmds.txt $TMPDIR/help-cmds.txt

# Error messages that lack guidance
grep -rn "throw new\|new Error" src/ --include="*.ts" | grep -v _test.ts | grep -vE "(Fix:|Check |See |Valid )" 
```

## Distribution Scope

| Included | Excluded |
|----------|----------|
| `docs/guides/en/`, `docs/internal/`, top-level `docs/*.md` | `docs/guides/ja/`, `docs/reference/`, `*.ja.md` |

## File Classification

| File type | Role | Editable? |
|-----------|------|-----------|
| docs/internal/ | Design intent record | No (read only) |
| docs/reference/ | External reference | No (not distributed) |
| README.md, docs/guides/, --help | Implementation explanation | Yes |
| tmp/docs-review/ | Working memo | Delete or promote after use |

## Checklist

```
Phase 1: - [ ] Read docs/internal/, wrote {feature}-intent.md
Phase 2: - [ ] Identified impl files, wrote {feature}-implementation.md
Phase 3: - [ ] Built diff table against current docs
         - [ ] Conciseness check: every sentence is one-sentence-per-item, dense, no filler
Phase 4: - [ ] Updated README.md, synced README.ja.md
Phase 5: - [ ] deno task verify-docs passed, manifest updated if needed
Phase 6: - [ ] No Japanese-only .md files remain
Pathway: - [ ] User journey stages have no dead ends
Memo:    - [ ] tmp/docs-review/ deleted or promoted
```

## References

- [SEMANTIC-CHECK.md](references/SEMANTIC-CHECK.md) — Semantic consistency details
- [IMPLEMENTATION-CHECK.md](references/IMPLEMENTATION-CHECK.md) — Formal checks (supplementary)
- `scripts/verify-docs.ts` — Automated checks (supplementary)
- `refactoring` skill — Docs grep after structural code changes (Phase 4 Step 12)
- `references/operational-guide.md` in this skill's directory — Concrete example (docs-distribution), bash commands, distribution scope, memo lifecycle, language rules
