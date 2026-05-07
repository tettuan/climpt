---
stepId: closure.consider.doc-verify
name: Verify Required Doc Paths Were Touched After The Issue Baseline
description: For each required doc path, check whether it was modified after the issue baseline (run_started_sha if present, else issue createdAt).
uvVariables:
  - issue
---

# Goal: Verify each required doc path was modified after the issue baseline

This step does NOT decide a verdict. It records facts (`diffed` per path) and
emits `next`. Downstream `closure.consider.doc-evidence` collects commit
metadata; the terminal `consider` step decides the verdict (`done` vs
`handoff-detail`) with full context.

## Inputs (handoff)
- `doc_paths_required` — from prior step `closure.consider.doc-scan`.
- `run_started_sha` — optional; considerer does not run polling so this value
  is not guaranteed.
- `{uv-issue}` — GitHub issue number (used only when `run_started_sha` is unset).

## Outputs
- `doc_diff_results: [{path: string, diffed: boolean}]` — one entry per
  required path, in the same order as `doc_paths_required`. Schema:
  `closure.consider.doc-verify` in `schemas/considerer.schema.json`.

## Action
1. If `run_started_sha` is present:
   - For each `path` in `doc_paths_required`, run
     `git diff --name-only ${run_started_sha}..HEAD -- "${path}"`;
     `diffed=true` iff stdout is non-empty, else `diffed=false`.
2. Else (path-specific, time-anchored fallback — removes the previous `HEAD~10` temporal drift):
   - `BASELINE_TIME` = `gh issue view {uv-issue} --json createdAt -q .createdAt` (ISO-8601 timestamp).
   - For each `path` in `doc_paths_required`:
     - `PATH_TIME` = `git log --first-parent -1 --format=%cI -- "${path}"` (empty string if path never committed). `--first-parent` ensures merged-in changes are dated by the merge commit (when they landed on this branch), not by the side-branch author date — this prevents false negatives when a fix arrives via a merge whose original commit predates `BASELINE_TIME`.
     - `diffed=true` iff `PATH_TIME` is non-empty AND `PATH_TIME >= BASELINE_TIME`; else `diffed=false`.
3. Collect entries into `doc_diff_results` in the same order as `doc_paths_required`.

## Verdict
- `next` — fact recording completed. Transitions to
  `closure.consider.doc-evidence`. This step never short-circuits; verdict
  authority lives in the terminal `consider` step.
- `repeat` — `git` / `gh` invocation failure. Re-runs from
  `closure.consider.doc-scan` (transition target).

## Do ONLY this
- Do not read the doc file contents; only check diff status (`git diff --name-only`) or last-modification time (`git log --first-parent -1 --format=%cI ...`).
- Do not run commands other than the `git` invocations in Action steps 1–2 and the single `gh issue view {uv-issue} --json createdAt -q .createdAt` call (only when `run_started_sha` is unset).
- Do not emit any artifact field beyond `doc_diff_results`. In particular, do
  not emit `verdict` or `final_summary` here — those are owned by the terminal
  `consider` step.
