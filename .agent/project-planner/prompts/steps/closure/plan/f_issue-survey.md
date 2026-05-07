---
stepId: closure.plan.issue-survey
name: Survey Open Issues In Project
description: List existing open issues in the project bound to the sentinel; emit existing_issues + count.
uvVariables:
  - issue
---

# Goal: Enumerate open issues in the project for downstream gap analysis

## Inputs (handoff)
- `{uv-issue}` — sentinel issue number, used to discover the project binding.
- From `closure.plan.goal-extract`:
  - `goal_statement: string`
  - `extraction_method: string`
  - `goal_axes: [{axis, description}]`
  These pass through unchanged; this step does not interpret them.

## Outputs
- `existing_issues: [{number, title, labels}]` — open issues in the project.
- `existing_issue_count: integer` — `existing_issues.length`, recorded for sanity.
- `goal_statement`, `extraction_method`, `goal_axes` — pass through.
- Schema: `closure.plan.issue-survey` in `schemas/planner.schema.json`.

## Action
1. Resolve the project binding: run
   `gh issue view {uv-issue} --json projectItems` once and read the first
   `projectItems[].project` entry to obtain `(owner, projectNumber)`.
2. Run `gh project item-list <projectNumber> --owner <owner> --format json --limit 200`
   once. Filter to entries whose `content.type == "Issue"` and
   `content.state == "OPEN"`. For each, record
   `{number: content.number, title: content.title, labels: content.labels[].name}`.
3. Set `existing_issue_count = existing_issues.length`. The empty list is
   a valid result (new project with no issues yet).

## Verdict
- `handoff` — listing completed (including empty list). Transitions to
  the closure step `closure.plan.plan` (work→closure boundary; per the
  StepKind boundary contract, work→closure uses `handoff`, not `next`).
- `repeat` — `gh` call failed (network / parse error). Re-runs this step.
  Convergence anchor: each retry MUST narrow the failure surface
  (different command variant, smaller `--limit`). When
  `completed_iterations` ≥ `maxIterations - 1`, prefer `handoff` with
  whatever partial list was obtained over another `repeat`.

## Do ONLY this
- Do not re-extract the goal (already provided via handoff).
- Do not propose issues, do not compute gaps (that is `closure.plan.plan`'s job).
- Do not run `gh issue create`, `gh issue edit`, `gh issue close`, or any write command.
- Do not emit any artifact field beyond `existing_issues`, `existing_issue_count`, `next_action`, and the pass-through goal fields.
