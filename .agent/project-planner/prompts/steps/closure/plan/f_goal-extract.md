---
stepId: closure.plan.goal-extract
name: Extract Project Goal From README
description: Extract goal_statement and goal_axes from injected {{project_goals}} README context.
uvVariables:
  - issue
---

# Goal: Extract project goal_statement and goal_axes from {{project_goals}}

## Inputs (handoff)
- `{uv-issue}` — sentinel issue number (entry-step UV; no upstream handoff fields).
- `{{project_goals}}` — project README content, injected by the orchestrator
  via the O1 hook when `projectBinding.injectGoalIntoPromptContext` is enabled.
- `{{project_titles}}`, `{{project_numbers}}`, `{{project_ids}}` — project metadata
  (used only to disambiguate which project's README is in `{{project_goals}}`).

## Outputs
- `goal_statement: string` — verbatim or near-verbatim goal text from `{{project_goals}}`.
- `extraction_method: "readme_heading" | "readme_body" | "readme_list" | "absent"`.
- `goal_axes: [{axis, description}]` — coverage dimensions implied by the goal
  (e.g. `schema`, `CLI`, `docs`, `tests`).
- Schema: `closure.plan.goal-extract` in `schemas/planner.schema.json`.

## Action
1. Inspect `{{project_goals}}`. If absent or whitespace-only, this is the
   fast-path: set `goal_statement=""`, `goal_axes=[]`,
   `extraction_method="absent"`, and emit `next` so the chain advances to
   `closure.plan.issue-survey` and ultimately the terminal plan step,
   which short-circuits to a `final_summary` of "goal unavailable" with
   an empty `proposed_issues` list.
2. Otherwise, locate the goal text in this priority order:
   the first H1/H2 heading sentence (`readme_heading`), then a single
   body paragraph that states the project's purpose (`readme_body`),
   then an explicit enumerated goal list (`readme_list`). Record the
   chosen path in `extraction_method`.
3. Decompose the goal into 1–7 coverage axes. Each axis is a noun-phrase
   dimension that issue candidates can later be sorted under
   (e.g. `schema`, `CLI`, `docs`, `tests`, `runtime`). Provide one
   sentence per axis under `description`.

## Verdict
- `next` — extraction attempt complete. Two cases: (a) success —
  `goal_statement` non-empty and `goal_axes` length ≥1; or (b) fast-path
  absent — `extraction_method="absent"`, empty goal fields. Either way
  transitions to `closure.plan.issue-survey`.
- `repeat` — `{{project_goals}}` is present but parse is ambiguous enough
  that re-reading would change the answer. Re-runs this step.
  Convergence anchor: each retry MUST narrow the choice
  (`extraction_method` candidates excluded, axis count stabilising).
  When `completed_iterations` ≥ `maxIterations - 1`, prefer `next`
  with best-effort axes over another `repeat`.

## Do ONLY this
- Do not run `gh issue list` or any issue listing call (that is `closure.plan.issue-survey`'s job).
- Do not propose issues, do not compute gaps (that is `closure.plan.plan`'s job).
- Do not modify files; do not run write commands.
- Do not emit any artifact field beyond `goal_statement`, `goal_axes`, `extraction_method`, `next_action`.
