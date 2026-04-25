---
stepId: closure.consider.precheck-kind-scope
name: Precheck - Record Kind Boundary Scope Findings
description: Record findings about this run's changed paths under the kind:* scope rule. Always emits next; closure consider step decides verdict.
uvVariables:
  - issue
---

# Goal: Record findings about this run's changed paths under the boundary implied by `kind_at_triage`

This step is fact-recording, not enforcement. It populates
`kind_boundary_violations` so the terminal `consider` step can decide the
verdict. Never emit `repeat` — there is no validator-driven retry; a loop
here only burns iteration budget.

| kind           | Rule                                                                        |
|----------------|-----------------------------------------------------------------------------|
| kind:consider  | Zero source files (`*.ts`, `*.js`, `*.py`) outside `tests/` in changed_paths |
| kind:design    | At least one `docs/**/design*.md` path in changed_paths                     |
| kind:impl      | Mis-route. Always emit empty `kind_boundary_violations` here; the closure step detects `kind_at_triage == "kind:impl"` and emits `verdict: "handoff-detail"` |

## Inputs

- `kind_at_triage` (from `closure.consider.precheck-kind-read`)
- `run_started_sha` if available (fallback `HEAD~10`) — same convention as
  `closure.consider.doc-verify`.

## Outputs

- `kind_boundary_violations: [{path: string, reason: string}]` — empty iff the
  rule is satisfied (or for `kind:impl` mis-route, regardless of paths).

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
   - **`kind:impl`**: emit empty `kind_boundary_violations`. The closure
     `consider` step recognizes the mis-route from `kind_at_triage` and
     emits `verdict: "handoff-detail"` regardless.

4. Emit `kind_boundary_violations[]` as a fact. The closure `consider` step
   reads it together with `kind_at_triage` and decides the verdict.

5. Intent: always `next`. The transition target is `consider` (terminal
   closure). There is no retry path on this step.

## Do ONLY this

- Do not edit files, revert, or run `git restore` here.
- Do not inspect file contents; match on path strings only.
- Do not second-guess `kind_at_triage`; treat it as ground truth.
- Do not emit intents other than `next`.
