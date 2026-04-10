# Docs Consistency Operational Guide

## Concrete Example: docs-distribution Feature

### Phase 1 output — intent memo

```markdown
# tmp/docs-review/docs-distribution-intent.md

## What
JSR-based local installation of versioned documentation.

## Why
- Offline reference access
- AI context window inclusion
- Version-managed docs retrieval

## Design decisions
- manifest.json manages all doc entries
- 3 output modes: preserve / flatten / single
- Version auto-detected from meta.json

## Users need to know
- Install command and options
- Filter options (category, lang)
- Difference between output modes
```

### Phase 2 output — implementation memo

```markdown
# tmp/docs-review/docs-distribution-implementation.md

## Files
- src/docs/mod.ts, src/docs/cli.ts

## Public API
- install(options): Promise<Result>
- list(): Promise<Manifest>

## Flow
1. Fetch meta.json from JSR → identify latest version
2. Fetch manifest.json → list doc entries
3. Download each markdown file → save locally

## Defaults
- output: "./climpt-docs"
- mode: "preserve"

## Edge cases
- Network error: retry with backoff
- Existing file overwrite: preserve by default
```

## Investigation Commands

```bash
# Phase 1: find design docs
ls docs/internal/

# Phase 2: find implementation
grep -r "install\|list" src/docs/ --include="*.ts" -l

# Phase 3: check current docs
grep -A 20 "Documentation" README.md

# Phase 5: format check
deno task verify-docs
deno task generate-docs-manifest  # when files added/removed
```

## Distribution Scope

| Included (distributed via JSR) | Excluded |
|-------------------------------|----------|
| `docs/guides/en/` | `docs/guides/ja/` |
| `docs/internal/` | `docs/reference/` |
| Top-level `docs/*.md` | `*.ja.md` files |

## Memo Lifecycle

| After fix | Action |
|-----------|--------|
| Simple fix, low reuse value | Delete `tmp/docs-review/` |
| Useful background for PR | Quote in PR description |
| Design decision worth preserving | Promote to `docs/internal/changes/` |

## Language Rules

| Pattern | Language | Distribution |
|---------|---------|-------------|
| `*.md` | English (required) | Included in JSR |
| `*.ja.md` | Japanese (optional) | Excluded from JSR |

Translation: keep code, commands, and technical terms verbatim. Translate explanatory text only. Preserve heading structure.

### Fix Japanese-only files

```bash
mv docs/foo.md docs/foo.ja.md       # 1. rename
# Create English docs/foo.md         # 2. translate
deno task generate-docs-manifest     # 3. regenerate
```
