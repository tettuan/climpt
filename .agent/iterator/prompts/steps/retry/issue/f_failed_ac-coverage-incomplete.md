## AC coverage incomplete

`ac_coverage_complete` is false. The validator `ac-coverage-complete` failed.

### Required remediation

Handle EXACTLY the ACs listed in `missing_ac_ids` - nothing else.

For each missing `ac_id`:

1. Re-read the AC text from `ac_list`.
2. Produce the evidence required by its `evidence_type`:
   - `fixture` → create/modify a file under `**/fixtures/**`
   - `prompt` → create/modify a file under `**/prompts/**`
   - `template` → create/modify a file under `**/prompts/**` or `**/templates/**`
   - `schema` → create/modify a file under `**/schemas/**`
   - `generic` → produce any change that demonstrably satisfies the bullet
3. Commit the change with `(#{uv-issue})` in the subject so the commit-binding chain picks it up.

### Do ONLY this

- Do not touch ACs not in `missing_ac_ids`
- Do not rephrase or remove existing AC bullets
- Do not close the issue

Emit `repeat` to loop back to the precheck chain for re-verification.
