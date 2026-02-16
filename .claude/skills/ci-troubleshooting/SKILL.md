---
name: ci-troubleshooting
description: Use when user encounters CI errors, JSR connection issues, 'deno task ci' failures, or sandbox-related build problems. Provides solutions for common CI issues.
allowed-tools: [Bash, Read, Edit, Grep, Glob]
---

# CI Troubleshooting

## CI Pipeline Stages

`@aidevtool/ci` runs these stages in order:

1. **Type Check** - `deno check`
2. **JSR Check** - JSR publish dry-run
3. **Test** - `deno test`
4. **Lint** - `deno lint`
5. **Format** - `deno fmt --check`

## Isolating Failures

### Run Specific Mode

```bash
# Single-file mode to isolate per-file errors
deno task ci --mode single-file

# Show only failing files
deno task ci --log-mode error-files-only

# Stop at first error
deno task ci --stop-on-first-error

# Check specific directory
deno task ci --hierarchy src/
```

## Network / Sandbox Issues

### JSR Connection Failed

```
error: JSR package manifest for '@std/path' failed to load.
Import 'https://jsr.io/@std/path/meta.json' failed.
```

**Solution**: See `/git-gh-sandbox` skill for sandbox bypass.

```typescript
Bash({
  command: "deno task ci",
  dangerouslyDisableSandbox: true,
})
```

## Lint Errors

### Common Rules and Fixes

| Rule | Error | Fix |
|------|-------|-----|
| `no-console` | console.log in non-CLI code | Add `// deno-lint-ignore no-console` |
| `prefer-ascii` | Japanese in comments | Change to English |
| `no-await-in-loop` | await in for loop | Add ignore or refactor to Promise.all |
| `eqeqeq` | `!=` instead of `!==` | Use strict equality |
| `explicit-function-return-type` | Missing return type | Add `: ReturnType` |
| `ban-unused-ignore` | Unused lint ignore | Remove or adjust ignore list |

### File-Level Lint Ignore

Add at top of file (after shebang if present):

```typescript
#!/usr/bin/env -S deno run ...
// deno-lint-ignore-file no-console prefer-ascii
```

### Line-Level Lint Ignore

```typescript
// deno-lint-ignore no-console
console.log("Debug output");
```

### prefer-ascii (Japanese Text)

Replace Japanese with English in:
- Code comments
- Doc references (e.g., `#command-schema` not `#command-schema`)
- Error messages in library code

Exception: Japanese OK in test fixtures or user-facing CLI output.

## Test Failures

### Flaky Tests (Timing Issues)

**Problem**: Parallel execution with small delays
```typescript
// Bad: 2ms may not be enough for millisecond-precision timestamps
const promises = Array.from({ length: 10 }, (_, i) =>
  new Promise((r) => setTimeout(() => r(generateId()), i * 2))
);
```

**Solution**: Sequential execution with adequate delay
```typescript
// Good: Sequential with 5ms delay
for (let i = 0; i < 10; i++) {
  ids.push(generateId());
  await new Promise((r) => setTimeout(r, 5));
}
```

### Type Errors in Tests

Check for:
- Missing type assertions (`as Type`)
- Incorrect mock implementations
- Outdated test fixtures after interface changes

## Format Errors

```bash
# Check without fixing
deno fmt --check

# Fix all
deno fmt
```

## Quick Debugging

```bash
# Run single stage individually
deno check src/**/*.ts
deno lint
deno test path/to/test.ts

# Verbose test output
deno test --allow-all 2>&1 | head -100
```

## Related Skills

- Network sandbox: `/git-gh-sandbox`
- CI execution: `/local-ci`
- Release flow: `/release-procedure`
