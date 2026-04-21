---
stepId: closure.consider.precheck-kind-scope
name: Precheck - Verify Changed Paths Respect Kind Boundary
description: Check this run's changed paths against the kind:* scope rule.
uvVariables:
  - issue
---

# Goal: Verify that this run's changed paths obey the boundary implied by `kind_at_triage`

Considerer handles `kind:consider` issues primarily. The boundary rule forbids
source-file edits outside `tests/` on those runs. The other two arms are
implemented for completeness so a mis-routed issue fails fast rather than
silently succeeds.

| kind           | Rule                                                                        |
|----------------|-----------------------------------------------------------------------------|
| kind:consider  | Zero source files (`*.ts`, `*.js`, `*.py`) outside `tests/` in changed_paths |
| kind:design    | At least one `docs/**/design*.md` path in changed_paths                     |
| kind:impl      | DISALLOWED on considerer — emit a violation so the fail-fast retry fires   |

## Inputs

- `kind_at_triage` (from `closure.consider.precheck-kind-read`)
- `run_started_sha` if available (fallback `HEAD~10`) — same convention as
  `closure.consider.doc-verify`.

## Outputs

- `kind_boundary_violations: [{path: string, reason: string}]` — empty iff the
  rule is satisfied.

## Action

1. Determine `BASE`: `run_started_sha` if present, else `HEAD~10`.
2. Collect `ALL_PATHS` from this run:

   ```bash
   bash -c '
   set -euo pipefail
   BASE=${run_started_sha:-HEAD~10}
   git diff --name-only "$BASE"..HEAD
   '
   ```

3. Apply the rule for `kind_at_triage`:

   - **`kind:consider`**: for each `p` in `ALL_PATHS`, if
     `p` matches `*.ts` / `*.js` / `*.py` AND does NOT start with `tests/`, add
     `{path: p, reason: "kind:consider must not modify source files outside tests/"}`
     to violations.
   - **`kind:design`**: scan `ALL_PATHS` for any entry matching
     `docs/**/design*.md`. If zero matches, add one synthetic violation
     `{path: "<none>", reason: "kind:design requires at least one docs/**/design*.md change"}`.
   - **`kind:impl`**: mis-routed. Add a synthetic violation
     `{path: "<none>", reason: "kind:impl issue routed to considerer; revert all changes and require re-triage"}`.

4. Emit `kind_boundary_violations[]`; enforcement by the `kind-boundary-clean`
   validator (postllm).

5. Intent:
   - If `kind_boundary_violations` is empty, emit `next` (proceed to
     `consider`).
   - Otherwise emit `repeat`; the retry template
     `retry/consider/f_failed_kind-boundary-breach.md` will instruct revert.

## Do ONLY this

- Do not edit files, revert, or run `git restore` here.
- Do not inspect file contents; match on path strings only.
- Do not second-guess `kind_at_triage`; treat it as ground truth.
- Do not emit intents other than `next` (clean) or `repeat` (violations).
