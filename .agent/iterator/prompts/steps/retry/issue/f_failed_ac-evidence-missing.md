## AC evidence missing

`ac_evidence_all_nonempty` is false. The validator `ac-evidence-nonempty` failed.

### Required remediation

Handle EXACTLY the ACs listed in `missing_ac_ids` — nothing else.

For each missing `ac_id`:

1. Re-read the AC text from `ac_list`.
2. Produce evidence (any path counts as evidence at this stage; typed-prefix
   correctness is checked by the next validator):
   - Create / modify a file that demonstrably satisfies the bullet text.
3. Commit the change with `(#{uv-issue})` in the subject so the commit-binding
   chain picks it up.

### Do ONLY this

- Do not touch ACs not in `missing_ac_ids`
- Do not rephrase or remove existing AC bullets
- Do not close the issue

Emit `repeat` to loop back to the precheck chain for re-verification.

## Allowed `next_action.action` values

This retry prompt is fed back into `closure.issue.precheck-ac-evidence-nonempty`
(the validator `ac-evidence-nonempty` runs there). Your structured JSON
response MUST satisfy that step's `next_action.action` enum:

- Allowed values: `["next","repeat"]`
- Emit `repeat` after creating evidence for each `missing_ac_id`. The validator
  will re-check `ac_evidence_all_nonempty` and the chain advances on success.

Do NOT emit `closing`, `handoff`, `close`, `done`, or any other value. Any value
outside `["next","repeat"]` triggers `GATE_INTERPRETATION_ERROR` (failFast) and
aborts the run. Canonical schema: `.agent/iterator/schemas/issue.schema.json` →
`closure.issue.precheck.properties.next_action.properties.action.enum`.
