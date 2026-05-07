---
stepId: closure.issue.precheck-ac-evidence-nonempty
name: Precheck - Verify AC Evidence Non-Empty
description: Assert every ac_id has at least one evidence_path
uvVariables:
  - issue
---

# Goal: For every `ac_id` in `ac_list`, confirm its `ac_mapping` entry has a non-empty `evidence_paths`

This step has a single axis: **per-AC evidence non-emptiness**. Typed-prefix
correctness and `ls` checks are the job of the NEXT step
(`closure.issue.precheck-ac-typed-prefix`). Do not run `ls` here.

## Inputs (handoff)

Received from `closure.issue.precheck-ac-map.structuredGate.handoffFields`:

- `ac_list: [{ac_id, text}]` — produced by `closure.issue.precheck-ac-extract`
- `ac_mapping: [{ac_id, evidence_paths, evidence_type}]` — produced by `closure.issue.precheck-ac-map`
- Carry-through: `run_started_sha`, `commit_list`, `commit_verification`, `kind_boundary_violations`
- `{uv-issue}` — GitHub issue number (uvVariable, context only)

## Outputs (intermediate artifacts)

- `ac_evidence_all_nonempty: boolean` — true iff `missing_ac_ids` is empty
- `missing_ac_ids: [string]` — every `ac_id` whose `ac_mapping` entry is absent OR has empty `evidence_paths`

Carry-through (unchanged): all input handoff fields.

## Action

1. Initialize `missing_ac_ids = []`.
2. For each `{ac_id}` in `ac_list`:
   - Find the matching entry in `ac_mapping`. If absent, append `ac_id` to `missing_ac_ids`.
   - Otherwise inspect `evidence_paths`. If `evidence_paths.length === 0`, append `ac_id` to `missing_ac_ids`.
3. Set `ac_evidence_all_nonempty = (missing_ac_ids.length === 0)`.
4. Emit `next` if `ac_evidence_all_nonempty=true`, otherwise `repeat`. Validator `ac-evidence-nonempty` (postllm) re-checks; on failure retry adaptation `f_failed_ac-evidence-missing.md` runs.

## Verdict

- `next` — every AC has ≥1 evidence path. Advance to `closure.issue.precheck-ac-typed-prefix`.
- `repeat` — at least one AC has empty / missing `evidence_paths`. Retry remediates only `missing_ac_ids`.

## Do ONLY this

- Do not run `ls` or any shell command (typed-prefix step's responsibility)
- Do not edit files
- Do not invent paths not present in `ac_mapping`
- Do not inspect `evidence_type` or apply prefix rules (next step's responsibility)
- Do not emit intents other than `next` or `repeat`
