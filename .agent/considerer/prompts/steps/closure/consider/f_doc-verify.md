---
stepId: closure.consider.doc-verify
name: Verify Required Doc Paths Have Diffs In This Run
description: For each required doc path, check whether the current run produced a diff.
uvVariables:
  - issue
---

# Goal: Verify each required doc path has a diff in the current run

## Inputs
- `doc_paths_required` (from prior step `closure.consider.doc-scan`)
- `run_started_sha` (optional; if unset, use `HEAD~10` as fallback base — considerer
  does not run polling so this value is not guaranteed)

## Outputs
- `doc_diff_results: [{path: string, diffed: boolean}]` — one entry per required path,
  in the same order as `doc_paths_required`.
- `verdict` — `"handoff-detail"` when any `diffed=false`; otherwise left unchanged
  (downstream `consider` step decides the final verdict).

## Action
1. Let `BASE` be `run_started_sha` if present, else `HEAD~10`.
2. For each `path` in `doc_paths_required`, run
   `git diff --name-only ${BASE}..HEAD -- "${path}"`; set `diffed=true` iff stdout is
   non-empty, else `diffed=false`. Collect entries into `doc_diff_results`.
3. Decide intent:
   - If `doc_paths_required` is empty OR every entry has `diffed=true`, emit `next`
     (proceed to `consider`).
   - Else, emit `closing` with `verdict="handoff-detail"` and rationale
     `"documentation work outstanding"` so the considerer short-circuits to the
     `handoff-detail` verdict.

## Do ONLY this
- Do not read the doc file contents; only check their diff status via `git diff`.
- Do not run commands other than `git diff --name-only` in Action step 2.
- Do not emit any other artifact field beyond `doc_diff_results` (+ `verdict`,
  `final_summary` when emitting `closing`).
- Do not emit intents other than `next`, `repeat` (on git failure), or `closing`.
