---
name: local-ci
description: Use when running 'deno task ci', local CI checks, or pre-push validation. Delegates to sub agent for context efficiency.
allowed-tools: [Bash, Read, Edit, Grep, Glob, Task]
---

# Local CI Execution

## Overview

Local CI uses `@aidevtool/ci` (JSR package) to run the full pipeline.

- CI error diagnosis: `/ci-troubleshooting` skill
- Release flow: `/release-procedure` skill
- Branch strategy: `/branch-management` skill

**Recommendation**: Delegate to sub agent to save context.

## Execution Methods

### Sub Agent Delegation (Preferred)

```typescript
Task({
  subagent_type: "Bash",
  prompt: "Run deno task ci and report results",
  description: "Run local CI"
})
```

### Direct Execution (Watch for Sandbox)

When JSR/Deno packages need to be fetched:

```typescript
Bash({
  command: "deno task ci",
  dangerouslyDisableSandbox: true,
})
```

## CI Pipeline Stages

`@aidevtool/ci` runs these stages in order:

1. **Type Check** - `deno check`
2. **JSR Check** - JSR publish dry-run
3. **Test** - `deno test`
4. **Lint** - `deno lint`
5. **Format** - `deno fmt --check`

## Execution Modes

| Mode | Command | Use Case |
|------|---------|----------|
| all (default) | `deno task ci` | Fastest, checks all files at once |
| batch | `deno task ci --mode batch --batch-size 10` | Large projects, controlled parallelism |
| single-file | `deno task ci --mode single-file` | Safest, isolates per-file errors |

## Hierarchy Targeting

Check a specific directory only:

```bash
deno task ci src/
deno task ci --hierarchy agents/ --mode batch
```

## Log Modes

| Mode | Flag | Use Case |
|------|------|----------|
| normal (default) | | Standard output |
| silent | `--log-mode silent` | CI/CD environments |
| debug | `--log-mode debug --log-key CI_DEBUG` | Detailed investigation |
| error-files-only | `--log-mode error-files-only` | Show only failing files |

## Key Options

| Option | Values | Default |
|--------|--------|---------|
| `--mode` | all, batch, single-file | all |
| `--batch-size` | 1-100 | 25 |
| `--allow-dirty` | flag | false |
| `--stop-on-first-error` | flag | false |
| `--filter` | pattern | none |

## Release Branch Version Check

On `release/*` branches, verify version consistency **before** running `deno task ci`. Skip this check on other branches.

```bash
# 1. Branch name version must match deno.json version
BRANCH=$(git rev-parse --abbrev-ref HEAD)
BRANCH_VERSION=${BRANCH#release/}
DENO_VERSION=$(grep '"version"' deno.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
if [ "$BRANCH_VERSION" != "$DENO_VERSION" ]; then
  echo "ERROR: Branch version mismatch: branch=$BRANCH_VERSION, deno.json=$DENO_VERSION"
  exit 1
fi

# 2. deno.json version must match version.ts
TS_VERSION=$(grep 'export const CLIMPT_VERSION' src/version.ts | sed 's/.*= *"\([^"]*\)".*/\1/')
if [ "$DENO_VERSION" != "$TS_VERSION" ]; then
  echo "ERROR: Version mismatch: deno.json=$DENO_VERSION, version.ts=$TS_VERSION"
  exit 1
fi
```

This mirrors the GitHub Actions `Check version consistency` step in `.github/workflows/test.yml`.

## Pre-Push Workflow

```bash
deno task ci && git push origin branch-name
```

## Error Handling

| Error Type | Skill Reference |
|------------|-----------------|
| JSR connection failed | `/ci-troubleshooting` |
| Lint errors | `/ci-troubleshooting` |
| Test failures | `/ci-troubleshooting` |
| Network blocked | `/git-gh-sandbox` |
