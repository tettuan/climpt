---
stepId: closure.detail.verify-anchors
name: Verify Anchors From Considerer Comment
description: Glob/Grep verify each file path and symbol named in the considerer comment.
uvVariables:
  - issue
---

# Goal: Verify every file path and symbol cited by the considerer comment exists

This step does NOT decide a verdict and does NOT post any comment. It records
existence facts (`exists` per anchor); the terminal `closure.detail.compose-and-post`
step decides `handoff-impl` vs `blocked` with full context.

## Inputs (handoff)

- `considerer_comment_body` — from `closure.detail.scan-considerer`. May be `null`.
- `issue_acceptance_criteria` — from `closure.detail.scan-considerer`. Pass-through.
- `iterator_failure_context` — from `closure.detail.scan-considerer`. May be `null`.
  Pass-through; not consumed by this step. The terminal `compose-and-post`
  step uses it to differentiate the 2nd-pass spec from the 1st pass.
- `{uv-issue}` — GitHub issue number.

## Outputs

Schema: `closure.detail.verify-anchors` in `schemas/detailer.schema.json`.

- `anchor_verification_results: [{anchor, kind, exists}]` — one entry per
  distinct anchor extracted from `considerer_comment_body`. `kind` is
  `"file"` (path-shaped) or `"symbol"` (identifier-shaped).
- `missing_anchors: string[]` — subset of `anchor_verification_results` where
  `exists=false`. Empty array means every cited anchor was located.

## Action

1. If `considerer_comment_body` is `null`, set both
   `anchor_verification_results=[]` and `missing_anchors=[]` and proceed to
   Verdict (no commands to run).
2. Else extract anchors from `considerer_comment_body`:
   - File anchors: tokens matching the regex
     `[A-Za-z0-9._/-]+\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|toml|sh)`
     and any backtick-quoted token containing a `/`. Deduplicate.
   - Symbol anchors: backtick-quoted tokens that are valid identifiers
     (`[A-Za-z_][A-Za-z0-9_]*`) AND are not already in the file-anchor set.
     Also include `<symbol> at <path>:L<n>-L<n>` references — use the
     `<symbol>` token. Deduplicate.
3. For each `kind: "file"` anchor:
   - Run `Glob` with the anchor as pattern (or as `**/<basename>` when the
     anchor lacks a directory prefix). `exists=true` iff at least one match.
4. For each `kind: "symbol"` anchor:
   - Run `Grep` with `pattern=<anchor>` over the repository (no path
     restriction; output_mode=`files_with_matches`). `exists=true` iff at
     least one match.
5. Build `anchor_verification_results` preserving extraction order.
6. Build `missing_anchors` = list of `anchor` strings where `exists=false`.

## Verdict

- `next` — fact recording completed (including the empty-input case).
  Transitions to `closure.detail.compose-and-post`. This step never
  short-circuits.
- `repeat` — `Glob` / `Grep` invocation failure. Re-runs this step
  (idempotent: same inputs yield same outputs).

## Do ONLY this

- Do not read file contents — only existence checks via `Glob` (file) /
  `Grep files_with_matches` (symbol).
- Do not run `gh` commands. Do not post comments. Do not edit anything.
- Do not emit `verdict`, `final_summary`, `spec_comment_url`, or any
  artifact field beyond the four declared outputs (including the two
  pass-through fields).
