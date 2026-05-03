## AC typed-prefix violated

`ac_typed_all_ok` is false. The validator `ac-typed-prefix-ok` failed: at least
one typed AC's `evidence_paths` does NOT live under the required prefix, or
`ls` failed on it.

### Required remediation

Handle EXACTLY the ACs listed in `violating_ac_ids` — nothing else.

For each violating `ac_id`:

1. Re-read the AC text from `ac_list` and look up its `evidence_type` in
   `ac_mapping`.
2. Move / create the evidence under the required path prefix:
   - `fixture` → file under `**/fixtures/**`
   - `prompt` → file under `**/prompts/**`
   - `template` → file under `**/prompts/**` or `**/templates/**`
   - `schema` → file under `**/schemas/**`
3. Verify the file is readable: `ls <path>` should succeed.
4. Commit the change with `(#{uv-issue})` in the subject so the commit-binding
   chain picks it up.

### Do ONLY this

- Do not touch ACs not in `violating_ac_ids`
- Do not rephrase or remove existing AC bullets
- Do not relocate non-typed (`generic`) AC evidence
- Do not close the issue

Emit `repeat` to loop back to the precheck chain for re-verification.

## Allowed `next_action.action` values

This retry prompt is fed back into `closure.issue.precheck-ac-typed-prefix`
(the validator `ac-typed-prefix-ok` runs there). Your structured JSON response
MUST satisfy that step's `next_action.action` enum:

- Allowed values: `["next","repeat"]`
- Emit `repeat` after relocating typed evidence to the required prefix. The
  validator will re-check `ac_typed_all_ok` and the chain advances on success.

Do NOT emit `closing`, `handoff`, `close`, `done`, or any other value. Any value
outside `["next","repeat"]` triggers `GATE_INTERPRETATION_ERROR` (failFast) and
aborts the run. Canonical schema: `.agent/iterator/schemas/issue.schema.json` →
`closure.issue.precheck.properties.next_action.properties.action.enum`.
