---
stepId: closure.issue.precheck-ac-map
name: Precheck - Map AC to Evidence Paths
description: Map each AC to evidence paths via commit changed_paths
uvVariables:
  - issue
---

# Goal: For each AC in ac_list, identify which commit changed_paths are evidence

## Inputs

- `ac_list` (from closure.issue.precheck-ac-extract)
- `commit_list` with `changed_paths` (from closure.issue.precheck-commit-verify)

## Outputs

- `ac_mapping: [{ac_id, evidence_paths: [string], evidence_type: string}]`

## Action

1. For each `ac_id` in `ac_list`, compute `evidence_paths` as the subset of all commits' `changed_paths` whose filename or directory matches keywords in the AC text.
2. Set `evidence_type`:
   - contains `fixture` → `fixture` (evidence must include a path under `**/fixtures/**`)
   - contains `prompt` → `prompt` (path under `**/prompts/**`)
   - contains `template` → `template` (path under `**/prompts/**` or `**/templates/**`)
   - contains `schema` → `schema` (path under `**/schemas/**`)
   - otherwise → `generic`
3. Emit `ac_mapping[]`; `evidence_paths` may be empty (verify step will catch).

## Do ONLY this

- Do not run shell commands
- Do not edit files
- Do not invent paths not present in `changed_paths`
- Do not emit intents other than `next` (mapping emitted) or `repeat` (ac_list or commit_list missing)
