---
stepId: closure.issue.precheck-kind-scope
name: Precheck - Verify Changed Paths Respect Kind Boundary
description: Check commit_verification.changed_paths against the iterator scope rule for the current kind:* label.
uvVariables:
  - issue
---

# Goal: Verify that this run's changed paths obey the boundary implied by the issue's **current** `kind:*` label

The orchestrator routes by the current `kind:*` label and that current
routing is the authoritative ground truth. Each kind implies a scope rule
on what the iterator is allowed to change in this run:

| kind           | Rule                                                                        |
|----------------|-----------------------------------------------------------------------------|
| kind:consider  | Zero source files (`*.ts`, `*.js`, `*.py`) outside `tests/` in changed_paths |
| kind:design    | At least one `docs/**/design*.md` path in changed_paths                     |
| kind:impl      | No path restriction (pass-through)                                          |

A violation means the iterator crossed the boundary (e.g. a `kind:consider`
issue produced `.ts` edits in src/). The fix is to revert out-of-scope
changes.

`kind_at_triage` is audit information only. Do NOT branch behavior on it.
If `kind_at_triage` differs from the current label (label drift), trust
the current label — the orchestrator already routed this run based on it.

## Inputs

- The issue's **current** `kind:*` label (one of
  `kind:impl | kind:consider | kind:design`). Resolve via:

  ```bash
  gh issue view {uv-issue} --json labels --jq '.labels[].name' \
    | grep -E '^kind:(impl|consider|design)$' | head -1
  ```

  If no `kind:*` label is set on the live issue, treat as `kind:impl`
  (least-restrictive pass-through) — the orchestrator would not have
  dispatched iterator without one, so this fallback only matters in
  manual / off-orchestrator runs.

- `commit_verification` (from `closure.issue.precheck-commit-verify`),
  with each entry carrying `changed_paths`.

## Outputs

- `kind_boundary_violations: [{path: string, reason: string}]` — empty
  iff the rule is satisfied.

## Action

1. Resolve `CURRENT_KIND` via the `gh issue view` command above.
2. Union every `changed_paths` list across `commit_verification[]` into a
   single deduplicated set `ALL_PATHS`.
3. Apply the rule for `CURRENT_KIND`:

   - **`kind:consider`**: for each `p` in `ALL_PATHS`, if `p` matches
     `*.ts` / `*.js` / `*.py` AND does NOT start with `tests/`, add
     `{path: p, reason: "kind:consider must not modify source files outside tests/"}`
     to violations.
   - **`kind:design`**: scan `ALL_PATHS` for any entry matching
     `docs/**/design*.md`. If zero matches, add one synthetic violation
     `{path: "<none>", reason: "kind:design requires at least one docs/**/design*.md change"}`.
   - **`kind:impl`** (or fallback): no rule. `kind_boundary_violations = []`.

4. Emit the resulting `kind_boundary_violations[]` and delegate enforcement
   to the `kind-boundary-clean` validator (postllm phase).

5. Intent:
   - If `kind_boundary_violations` is empty, emit `next` (proceed to
     `closure.issue.precheck-ac-extract`).
   - Otherwise emit `repeat`; the retry template
     `retry/issue/f_failed_kind-boundary-breach.md` will instruct revert.

## Do ONLY this

- Do not edit any files, revert, or run `git restore` here — that belongs
  to the retry template on validator failure.
- Do not inspect file contents; match on path strings only.
- Do not branch on `kind_at_triage` — it is audit-only. Use the live
  `kind:*` label.
- Do not emit intents other than `next` (clean) or `repeat` (violations).
