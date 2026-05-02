---
stepId: closure.consider.precheck-kind-scope
name: Precheck - Record Considerer Boundary Findings
description: Record findings about this run's changed paths under considerer's source-edit boundary. Always emits next; closure consider step decides verdict.
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

- (none) — boundary check is a property of the *current working tree*, not of
  any commit history. Considerer never commits, so any source edits this
  invocation made are uncommitted by definition.

## Outputs

- `kind_boundary_violations: [{path: string, reason: string}]` — empty iff
  this run's working tree contains no uncommitted source-file edits outside
  `tests/`.

## Action

1. Collect `ALL_PATHS` from the current working tree (uncommitted: staged,
   unstaged, and untracked):

   ```bash
   git status --porcelain | sed -E 's/^.{3}//; s/.* -> //'
   ```

   The `sed` strips the 3-char porcelain status prefix and, for rename
   entries (`R  old -> new`), keeps only the destination path so a
   `tests/foo.ts -> src/foo.ts` rename is correctly flagged on `src/foo.ts`.

   Do NOT diff against `HEAD~N` or any historical commit — that captures
   the project's prior development work (which was authored by humans /
   other agents in earlier runs) and produces false-positive violations
   on every dispatch. The considerer's session boundary is the working
   tree, not the commit graph.

   If you run this prompt locally over a dirty tree (developer WIP), any
   matching uncommitted source edits WILL be flagged. That is correct
   behavior, not a false positive — it reflects the literal state at
   verdict time.

2. For each `p` in `ALL_PATHS`, if `p` matches `*.ts` / `*.js` / `*.py`
   AND does NOT start with `tests/`, add
   `{path: p, reason: "considerer must not modify source files outside tests/"}`
   to violations.

3. Emit `kind_boundary_violations[]` as a fact. The closure `consider`
   step reads it and emits `handoff-detail` if non-empty (Step 4-pre
   override).

4. Intent: always `next`. Transition target is `consider` (terminal
   closure). There is no retry path on this step.

## Do ONLY this

- Do not edit files, revert, or run `git restore` here.
- Do not inspect file contents; match on path strings only.
- Do not branch on `kind_at_triage` — it is audit-only.
- Do not emit intents other than `next`.
