---
c1: test
c2: run
c3: specific
title: Run Specific Test Target
description: Execute tests for a specific target using the uv-target variable
usage: climpt-test run specific --uv-target=<test-target>
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
  file: false
  stdin: false
  destination: false
uv:
  - target: The specific test target to run (file path, function name, or test pattern)
---

# Run Specific Test Target

## Purpose

Execute tests for a specific target specified by the `{uv-target}` variable. This instruction supports various test runners and allows precise control over which tests to run.

## Input

The test target is specified via the `--uv-target` option:

```bash
climpt-test run specific --uv-target="tests/unit/auth_test.ts"
climpt-test run specific --uv-target="test_login_success"
climpt-test run specific --uv-target="**/integration/**"
```

## Workflow

### Step 1: Detect Test Runner

Identify the project's test runner by checking:

1. **Deno**: Check for `deno.json` or `deno.jsonc` with test task
2. **Node/npm**: Check for `package.json` with test scripts (jest, mocha, vitest)
3. **Python**: Check for `pytest.ini`, `pyproject.toml`, or `setup.py`
4. **Go**: Check for `*_test.go` files
5. **Rust**: Check for `Cargo.toml`

### Step 2: Build Test Command

Based on the detected runner, construct the appropriate test command:

| Runner | Command Pattern |
|--------|-----------------|
| Deno | `deno test {uv-target}` |
| Jest | `npx jest {uv-target}` |
| Vitest | `npx vitest {uv-target}` |
| Pytest | `pytest {uv-target}` |
| Go | `go test -run {uv-target}` |
| Cargo | `cargo test {uv-target}` |

### Step 3: Execute Tests

Run the constructed command and capture output:

```bash
# Example for Deno project
deno test {uv-target}

# Example for Node/Jest project
npx jest {uv-target} --verbose
```

### Step 4: Report Results

Analyze test output and report:
- Number of tests run
- Passed/failed count
- Failed test details with file:line references
- Suggested fixes for common failures

## Target Patterns

The `{uv-target}` supports various patterns:

| Pattern Type | Example | Description |
|--------------|---------|-------------|
| File path | `tests/auth_test.ts` | Run all tests in file |
| Directory | `tests/unit/` | Run all tests in directory |
| Glob pattern | `**/*_test.ts` | Match multiple files |
| Test name | `test_login` | Run specific test function |
| Filter | `--filter="auth"` | Filter by test name pattern |

## Error Handling

- If no test runner is detected, suggest installing one
- If target matches no tests, report and suggest alternatives
- If tests fail, provide actionable error summaries

## Output Example

```
Running tests for target: {uv-target}

Test Runner: deno test
Command: deno test tests/auth_test.ts

Results:
  - Passed: 5
  - Failed: 1
  - Skipped: 0

Failed:
  tests/auth_test.ts:42 - test_token_expiry
    AssertionError: Expected token to be expired

Suggested fix: Check token expiry calculation in auth.ts:28
```
