## Kind boundary breach

Your run modified files outside the iterator scope rule for this issue's
**current** `kind:*` label. The validator `kind-boundary-clean` failed with:

```
${kind_boundary_violations}
```

### Required remediation

Revert ONLY the listed out-of-scope files. Do NOT add new edits, refactors, or
"fixes along the way".

```bash
# For each violation.path (skip synthetic "<none>" entries used by kind:design):
git restore --source=HEAD --staged --worktree -- <violation.path>
```

If the boundary demands additive evidence that is missing (e.g. `kind:design`
with zero `docs/**/design*.md` changes), and the only honest outcome is "this
run produced no work toward that kind", do not fabricate a doc — emit `repeat`
with a reason noting the work was not done this run.

### Do ONLY this

- Do not modify files other than reverting the listed paths.
- Do not amend commits; make a new revert commit if the reverted files were
  already committed in this run.
- Do not change the issue's `kind:*` label — boundary breach is detected against
  the issue's live label and working tree, not against a frozen artifact.
  Re-labeling to fit the breach is not a remedy.
- Do not close the issue.

Emit `repeat` to loop back into the precheck chain for re-verification.

## Allowed `next_action.action` values

This retry prompt is fed back into `closure.issue.precheck-kind-scope` (the
validator `kind-boundary-clean` runs there). Your structured JSON response MUST
satisfy that step's `next_action.action` enum:

- Allowed values: `["next","repeat"]`
- Emit `repeat` after reverting the listed out-of-scope paths. The validator
  will re-check `kind_boundary_violations` and the chain advances on success.

Do NOT emit `closing`, `handoff`, `close`, `done`, or any other value. Any value
outside `["next","repeat"]` triggers `GATE_INTERPRETATION_ERROR` (failFast) and
aborts the run. Canonical schema: `.agent/iterator/schemas/issue.schema.json` →
`closure.issue.precheck.properties.next_action.properties.action.enum`.
