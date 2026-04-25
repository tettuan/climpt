# Plan: Evaluate Project Goals and Emit Issue Candidates

## Your Task

Read the project goal (from `{{project_goals}}` context) and the sentinel
issue, then:

1. Survey existing open issues in the project.
2. Identify gaps between the goal and current issue coverage.
3. Emit `deferred_items` for each gap (with `title`, `body`, `labels`).
4. Emit verdict `done`.

## Input

- **Sentinel issue**: `{{issue}}` — the trigger issue for this planning cycle.
- **Project goals**: injected via `{{project_goals}}` prompt context variable
  (project README content).
- **Project metadata**: `{{project_titles}}`, `{{project_numbers}}`,
  `{{project_ids}}`.

## Output

Return structured JSON with:

- `verdict`: always `"done"`
- `final_summary`: one-paragraph summary of planning outcome
- `next_action.action`: `"closing"`

Use `deferred_items` in structured output to propose new issues.
Each entry needs `title`, `body`, and `labels` (pick `kind:impl` or
`kind:consider`).

## Constraints

- Do NOT create issues directly (use `deferred_items` only).
- Do NOT modify code, config, or docs.
- Do NOT close or relabel issues.
- Research only: `Read`, `Grep`, `Glob`, `Bash` (read-only).
