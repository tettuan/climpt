---
stepId: closure.consider.precheck-kind-scope
name: Precheck - Record Considerer Boundary Findings
description: Record findings about this run's changed paths under considerer's source-edit boundary. Always emits next; closure consider step decides verdict.
uvVariables:
  - issue
---

# Goal: Record findings about source files this run modified outside `tests/`

Considerer is a respond-and-close agent — it must NOT edit source code as
part of answering an issue. This step records any source-file edits in
`kind_boundary_violations` so the terminal `consider` step can flip the
verdict to `handoff-detail` if the boundary was breached.

`kind_at_triage` is audit information only. Do NOT branch behavior on it.
The orchestrator routed this run as considerer based on the current
`kind:consider` label; that current routing is the authoritative ground
truth. If `kind_at_triage` differs (label drift), trust the current
routing and apply considerer's boundary.

## Boundary rule

Source files (`*.ts`, `*.js`, `*.py`) outside `tests/` MUST NOT appear in
this run's changed paths. Test files under `tests/**` are permitted (the
considerer may add evidence-gathering tests). Markdown / json / yaml are
permitted (response artifacts, deferred items).

## Inputs

- `run_started_sha` if available (fallback `HEAD~10`) — same convention as
  `closure.consider.doc-verify`.

## Outputs

- `kind_boundary_violations: [{path: string, reason: string}]` — empty iff
  considerer made no source-file edits outside `tests/`.

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

3. For each `p` in `ALL_PATHS`, if `p` matches `*.ts` / `*.js` / `*.py`
   AND does NOT start with `tests/`, add
   `{path: p, reason: "considerer must not modify source files outside tests/"}`
   to violations.

4. Emit `kind_boundary_violations[]` as a fact. The closure `consider`
   step reads it and emits `handoff-detail` if non-empty (Step 4-pre
   override).

5. Intent: always `next`. Transition target is `consider` (terminal
   closure). There is no retry path on this step.

## Do ONLY this

- Do not edit files, revert, or run `git restore` here.
- Do not inspect file contents; match on path strings only.
- Do not branch on `kind_at_triage` — it is audit-only.
- Do not emit intents other than `next`.
