## Kind boundary breach

Current issue is `${kind_at_triage}`. Your run modified files outside that
scope. The validator `kind-boundary-clean` failed with:

```
${kind_boundary_violations}
```

### Required remediation

Revert ONLY the listed out-of-scope files. Do NOT add new edits, refactors,
or "fixes along the way".

```bash
# For each violation.path (skip synthetic "<none>" entries used for kind:design / mis-routed kind:impl):
git restore --source=HEAD --staged --worktree -- <violation.path>
```

If `kind_at_triage` is `kind:impl` you landed on a mis-routed issue: revert
every change this run produced and emit `repeat`. Re-triage is required —
do not attempt the implementation here.

If `kind_at_triage` is `kind:design` and the only violation is the synthetic
"requires at least one docs/**/design*.md change", and the honest answer is
"this run produced no design doc work", emit `repeat` with a reason noting
the work was not done this run. Do not fabricate a doc.

### Do ONLY this

- Do not modify files other than reverting the listed paths.
- Do not amend commits; make a new revert commit if the reverted files were
  already committed in this run.
- Do not change the issue's `kind:*` label — the label was frozen at triage
  and is owned by `.agent/climpt/out/kind_at_triage/<issue>.txt`.
- Do not close the issue.

Emit `repeat` to loop back into the precheck chain for re-verification.
