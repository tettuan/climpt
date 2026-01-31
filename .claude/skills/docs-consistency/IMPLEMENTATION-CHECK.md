# Implementation-to-Docs Verification Details

Component-by-component verification guide.

## CLI Module (`src/cli/`)

### Options Verification

```bash
# Extract all CLI flags from code
grep -r "\.option\|\.flag\|--" src/cli/ --include="*.ts" | grep -oE -- "--[a-z-]+"

# Compare with README
grep -oE -- "--[a-z-]+" README.md | sort -u
```

### Help Text Sources

| Source | Purpose |
|--------|---------|
| `src/cli/args.ts` | Argument definitions |
| `src/cli/help.ts` | Help text templates |
| `mod.ts --help` | Runtime output |

### Verification Script

```bash
deno run -A .claude/skills/docs-consistency/scripts/verify-docs.ts cli
```

---

## Agent Module (`agents/`)

### Config Schema vs Docs

```bash
# Schema fields
jq -r '.properties | keys[]' agents/schemas/agent.schema.json

# Documented fields in README
grep -oE '\`[a-zA-Z]+\`' agents/README.md | tr -d '`' | sort -u
```

### Verification Points

| File | Docs Location | Check |
|------|---------------|-------|
| `agent.schema.json` | agents/README.md | Property names match |
| `steps_registry.schema.json` | agents/docs/builder/ | Step types match |
| Completion types | README § Completion Types | All types documented |

---

## Docs Module (`src/docs/`)

### API vs Docs

```bash
# Exported functions
grep "^export" src/docs/mod.ts

# Documented in design
grep -E "^(###|import|await)" docs/internal/docs-distribution-design.md
```

### CLI Commands

| Command | Source | Docs |
|---------|--------|------|
| `install` | `src/docs/cli.ts` | README § Documentation |
| `list` | `src/docs/cli.ts` | README § Documentation |

---

## Prompt Templates

### Template Variables

Document all variables used in prompts:

```bash
# Find variables in templates
grep -roh "{[a-z_]*}" .agent/climpt/prompts/ | sort -u
```

Match against `docs/guides/` documentation.

---

## MCP Configuration

### Config Keys

```bash
# From MCP source
grep -oE '"[a-z_]+"' src/mcp/*.ts | sort -u

# From docs
grep -oE '"[a-z_]+"' docs/mcp-setup.md | sort -u
```

---

## Multi-language Docs (`docs/guides/`)

### Structure Verification

```bash
# Count files per language
ls -1 docs/guides/ja/*.md | wc -l
ls -1 docs/guides/en/*.md | wc -l

# Compare file names
ls -1 docs/guides/ja/*.md | xargs -n1 basename | sort > /tmp/claude/ja-files.txt
ls -1 docs/guides/en/*.md | xargs -n1 basename | sort > /tmp/claude/en-files.txt
diff /tmp/claude/ja-files.txt /tmp/claude/en-files.txt
```

### Content Verification

For each guide pair:
- Same code blocks
- Same heading count
- Same link targets

---

## Manifest Verification

### Entry Validation

```bash
# Run manifest generation
deno task generate-docs-manifest

# Verify output
deno run -A .claude/skills/docs-consistency/scripts/verify-docs.ts manifest
```

### Expected Properties

```json
{
  "version": "matches deno.json",
  "entries": [
    {
      "id": "unique-identifier",
      "path": "relative/to/docs/",
      "category": "guides|reference|internal",
      "lang": "ja|en|undefined",
      "title": "# heading or undefined",
      "bytes": "file size"
    }
  ]
}
```

---

## Automated Verification Summary

```bash
# Full verification
deno run -A .claude/skills/docs-consistency/scripts/verify-docs.ts all

# Specific checks
deno run -A .claude/skills/docs-consistency/scripts/verify-docs.ts cli
deno run -A .claude/skills/docs-consistency/scripts/verify-docs.ts readme
deno run -A .claude/skills/docs-consistency/scripts/verify-docs.ts manifest
deno run -A .claude/skills/docs-consistency/scripts/verify-docs.ts agents
```
