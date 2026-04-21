---
stepId: closure.issue.precheck-ac-verify
name: Precheck - Verify AC Coverage
description: Verify every AC has non-empty evidence and typed paths exist
uvVariables:
  - issue
---

# Goal: Verify every AC in ac_list is covered with non-empty evidence_paths

## Inputs

- `ac_list` (from closure.issue.precheck-ac-extract)
- `ac_mapping` (from closure.issue.precheck-ac-map)

## Outputs

- `ac_coverage_complete: boolean`
- `missing_ac_ids: [string]`

## Action

1. For each `ac_id` in `ac_list`, find the matching `ac_mapping` entry. If absent or `evidence_paths` empty, add `ac_id` to `missing_ac_ids`.
2. For entries whose `evidence_type` is `fixture|prompt|template|schema`, run `ls <path>` on each `evidence_paths` item; on non-zero exit or if the path is not under the required directory prefix, add `ac_id` to `missing_ac_ids`.
3. Set `ac_coverage_complete = (missing_ac_ids.length === 0)`. Emit `next` when complete, otherwise `repeat`.

## Do ONLY this

- Do not edit files
- Do not run shell commands other than `ls`
- Do not infer evidence paths not present in `ac_mapping`
- Do not emit intents other than `next` (complete) or `repeat` (incomplete)
