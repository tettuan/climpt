---
stepId: closure.consider.emit-handoff-detail
name: Emit Handoff-Detail Verdict From Doc-Verify Short-Circuit
description: Echo-only terminal step. Surfaces the upstream handoff-detail verdict verbatim as the agent's terminal output. No re-judgment, no side effects.
uvVariables:
  - issue
---

# Goal: Emit the verdict that `closure.consider.doc-verify` already decided

This step exists solely so that the RC4 short-circuit (doc paths not diffed →
`verdict="handoff-detail"`) lands on the agent's terminal output without being
re-evaluated by the `consider` step.

## Inputs (from upstream handoff)
- `uv-verdict` — MUST be `"handoff-detail"`. Passed from `closure.consider.doc-verify`.
- `uv-final_summary` — rationale sentence authored by `doc-verify` (e.g. `"documentation work outstanding: docs/foo.md not modified in this run"`).
- `uv-doc_paths_required` — original list from `closure.consider.doc-scan`.
- `uv-doc_diff_results` — per-path diff outcomes from `closure.consider.doc-verify`.

## Action

Do NOT:
- read the issue body
- run `gh` commands
- execute `Grep`, `Glob`, `Read`, or `WebFetch`
- post an issue comment
- re-derive the verdict
- alter the `final_summary`

Do ONLY:
- Emit the structured JSON below with `verdict` and `final_summary` copied verbatim
  from the uv variables.

## Output

Return a JSON object matching `closure.consider` in
`schemas/considerer.schema.json`:

```json
{
  "stepId": "consider",
  "status": "completed",
  "summary": "short-circuit: documentation work outstanding",
  "next_action": { "action": "closing" },
  "verdict": "handoff-detail",
  "final_summary": "<uv-final_summary verbatim>",
  "handoff_anchor": {
    "file": null,
    "symbol": null,
    "strategy": null
  },
  "doc_paths_required": <uv-doc_paths_required verbatim>,
  "doc_diff_results": <uv-doc_diff_results verbatim>
}
```

## Rules
- `verdict` MUST be the literal string `"handoff-detail"` (this step is reached
  only on the short-circuit path; any other verdict is a logic error upstream).
- `next_action.action` MUST be `"closing"` (terminal).
- `handoff_anchor` fields MAY all be `null` — anchor selection is the detailer's
  job, not this step's.
- If `uv-verdict` is not `"handoff-detail"`, emit `repeat` and report the
  inconsistency in `next_action.reason`. This catches upstream bugs.

## Why this step exists
Without it, the short-circuit would hand off to the `consider` step, which
re-judges `verdict` from the issue body alone and can silently overwrite
`handoff-detail` with `done`. Keeping this as a dedicated single-purpose step
makes the RC4 invariant structural rather than prompt-dependent.
