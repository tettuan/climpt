---
stepId: closure.issue.precheck-ac-typed-prefix
name: Precheck - Verify AC Typed Path Prefix
description: For typed ACs (fixture/prompt/template/schema) verify required path prefix and ls succeeds
uvVariables:
  - issue
---

# Goal: For each `ac_mapping` entry whose `evidence_type` is typed, confirm prefix and `ls` succeed

This step has a single axis: **typed-AC path correctness**. Per-AC evidence
non-emptiness is already established by the prior step
(`closure.issue.precheck-ac-evidence-nonempty`). The two checks (prefix +
`ls`) are tightly coupled (both about whether the typed-path actually points
at the required directory tree), so they share this single axis.

## Inputs (handoff)

Received from `closure.issue.precheck-ac-evidence-nonempty.structuredGate.handoffFields`:

- `ac_list: [{ac_id, text}]`
- `ac_mapping: [{ac_id, evidence_paths, evidence_type}]`
- `ac_evidence_all_nonempty: boolean` (must be `true` to enter this step; otherwise prior step would have emitted `repeat`)
- `missing_ac_ids: [string]` — should be empty by precondition; passed through for transparency
- Carry-through: `run_started_sha`, `commit_list`, `commit_verification`, `kind_boundary_violations`
- `{uv-issue}` — GitHub issue number (uvVariable, context only)

## Outputs (intermediate artifacts)

- `ac_typed_all_ok: boolean` — true iff `violating_ac_ids` is empty
- `violating_ac_ids: [string]` — every typed `ac_id` failing prefix OR `ls` check

Carry-through (unchanged): all input handoff fields, including `ac_evidence_all_nonempty` and `missing_ac_ids`.

## Action

Required-prefix table (by `evidence_type`):

| evidence_type | Required path prefix glob          |
|---------------|------------------------------------|
| `fixture`     | `**/fixtures/**`                   |
| `prompt`      | `**/prompts/**`                    |
| `template`    | `**/prompts/**` OR `**/templates/**` |
| `schema`      | `**/schemas/**`                    |
| `generic`     | (no prefix rule — skip)            |

1. Initialize `violating_ac_ids = []`.
2. For each entry `m` in `ac_mapping`:
   - If `m.evidence_type === "generic"`, skip.
   - For each `path` in `m.evidence_paths`:
     - If `path` does NOT match the required prefix glob for `m.evidence_type`, append `m.ac_id` to `violating_ac_ids` and continue to the next entry.
     - Run `ls <path>` (capture exit code). If exit ≠ 0, append `m.ac_id` to `violating_ac_ids` and continue to the next entry.
3. Deduplicate `violating_ac_ids`.
4. Set `ac_typed_all_ok = (violating_ac_ids.length === 0)`.
5. Emit `next` if `ac_typed_all_ok=true`, otherwise `repeat`. Validator `ac-typed-prefix-ok` (postllm) re-checks; on failure retry adaptation `f_failed_ac-typed-prefix-violated.md` runs.

## Verdict

- `next` — every typed AC's evidence_paths satisfy the required prefix and `ls` succeeds. Advance to `closure.issue` (terminal closure step).
- `repeat` — at least one typed AC violates prefix or `ls`. Retry remediates only `violating_ac_ids`.

`fallbackIntent=repeat` because `next` advances the workflow phase
(verification → closure); ambiguous output stays in the verification loop
to preserve recoverability (per registry-shape.md fallbackIntent rule).

## Do ONLY this

- Do not edit files
- Do not run shell commands other than `ls`
- Do not infer evidence paths not present in `ac_mapping`
- Do not branch on `missing_ac_ids` (prior step gates that)
- Do not emit intents other than `next` or `repeat`
