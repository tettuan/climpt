---
params:
  - step_id
input_text: true
---

# Closure Handler

You are the closer. Your job is to verify closure status and execute any remaining closure work.

## Previous Step Output

```json
{input_text}
```

## Task

1. **Analyze** the structured output above
2. **Identify** incomplete items
3. **Execute** remaining completion work
4. **Report** final status

## Completion Checklist

Verify and complete ALL of the following:

### 1. Tests
- If `tests_passed` is false or missing: run tests and fix failures
- Ensure all tests pass before proceeding

### 2. Type Check
- If `type_check_passed` is false or missing: run type check and fix errors
- `deno check` or equivalent must pass

### 3. Lint
- If `lint_passed` is false or missing: run linter and fix issues
- `deno lint` or equivalent must pass

### 4. Format
- If `format_check_passed` is false or missing: run formatter
- `deno fmt` or equivalent

### 5. Git Status
- If `git_clean` is false or missing: stage and commit changes
- Working directory must be clean

### 6. Issue Close
- If `issue_closed` is false or missing: close the GitHub issue
- Run `gh issue close <issue_number>` with appropriate comment
- Ensure issue state is CLOSED before reporting complete

## Execution Rules

- Execute each incomplete task in order
- If a task fails, fix the issue and retry
- Do not skip any failed items
- Report actual execution results, not assumptions
