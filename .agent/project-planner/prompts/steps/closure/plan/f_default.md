---
stepId: closure.plan.plan
name: Plan Project Issues
description: Compute gap between goal_axes and existing_issues; emit proposed_issues[] with coverage_axes; emit verdict closing.
uvVariables:
  - issue
---

# Goal: Emit proposed_issues[] that close the gap between goal_axes and existing_issues

## Inputs (handoff)
- `{uv-issue}` — sentinel issue number (preserved for traceability).
- From `closure.plan.issue-survey`:
  - `goal_statement: string`
  - `extraction_method: string`
  - `goal_axes: [{axis, description}]`
  - `existing_issues: [{number, title, labels}]`
  - `existing_issue_count: integer`

## Outputs
- `proposed_issues: [{title, body, labels, projects?}]` — structurally identical
  to considerer `deferred_items`. The orchestrator issue-emitter consumes
  this array via the same outbox path.
- `coverage_axes: [{axis, description, issue_indices}]` — every entry in
  `goal_axes` MUST appear here; `issue_indices` is the zero-based positions
  in `proposed_issues[]` that address that axis (empty array = axis
  unaddressed by this batch).
- `verdict: "done"`, `final_summary: string`.
- Schema: `closure.plan.plan` in `schemas/planner.schema.json`.

## Action
1. Short-circuit check: if `extraction_method == "absent"` (goal-extract
   fast-path fired because `{{project_goals}}` was missing), set
   `proposed_issues=[]`, `coverage_axes=[{axis:"_unavailable", description:"Goal source unavailable; no axes derived.", issue_indices:[]}]`,
   `final_summary="Goal unavailable: {{project_goals}} was absent or empty; no proposals drafted."`,
   and proceed to Verdict (`closing` with `verdict:"done"`).
2. Otherwise, for each `axis` in `goal_axes`, identify which
   `existing_issues` already address it (heuristic: title or label
   substring match against `axis`). Mark the axis covered if at least
   one open issue addresses it.
3. For each uncovered (or thinly covered) axis, draft 1–3
   `proposed_issues` entries. Each entry needs:
   - `title` — self-contained, no reference to the sentinel issue number.
   - `body` — markdown restating the scope so a downstream agent (iterator
     or considerer) does not need to re-read the sentinel.
   - `labels` — exactly one of `kind:impl` or `kind:consider`. Omit `order:N`.
4. Build `coverage_axes`: every axis in `goal_axes` is one entry. Set
   `issue_indices` to the zero-based positions in `proposed_issues[]`
   that address that axis. Axes already covered by existing issues
   keep `issue_indices: []`.
5. Cap `proposed_issues` at 20 entries (schema `maxItems`). If more would
   be needed, prioritise the most blocking axes and note the remainder
   in `final_summary`.
6. Write `final_summary` (1 paragraph): which axes were uncovered, how
   many `proposed_issues` were drafted, which axes remain open after
   this batch.

## Verdict
- `closing` — proposed_issues drafted (including empty list when every
  axis is already covered) and `coverage_axes` enumerates every
  `goal_axes` entry. Terminates the chain; orchestrator advances the
  sentinel phase to `done` without closing the issue
  (`closeBinding.primary.kind: none`).
- `repeat` — only when `completed_iterations < maxIterations` AND the
  previous attempt's `coverage_axes` did not enumerate every `goal_axes`
  entry (internal inconsistency detected). Convergence anchor: each
  retry MUST narrow the gap (more axes mapped, or fewer DUP candidates).
  When `completed_iterations` ≥ `maxIterations - 1`, prefer `closing`
  with the best-effort batch over another `repeat`.

## Do ONLY this
- Do not re-extract the goal or re-list issues (use the handoff data).
- Do not run `gh issue create`, `gh issue edit`, `gh issue close`, or any write command.
- Do not modify code, config, or docs.
- Do not emit any artifact field beyond the schema-required set.
