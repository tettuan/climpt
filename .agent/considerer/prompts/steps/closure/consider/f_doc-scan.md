---
stepId: closure.consider.doc-scan
name: Scan Issue For Required Doc Paths
description: Extract every doc path mentioned in issue body + comments.
uvVariables:
  - issue
---

# Goal: Extract every doc path mentioned in issue body and comments

## Inputs (handoff)
- `{uv-issue}` — GitHub issue number (entry-step UV; no upstream handoff fields).

## Outputs
- `doc_paths_required: [string]` — distinct file paths in canonical doc
  directories. Schema: `closure.consider.doc-scan` in
  `schemas/considerer.schema.json`. Matching prefixes:
  - `docs/**`
  - `agents/docs/**`

  Working / ephemeral directories (`tmp/`, `node_modules/`, `dist/`,
  `build/`, `.git/`) are excluded by definition — they are not permanent
  documentation, so a `diffed=false` reference to them does not signal
  "doc work unfinished" and must not gate the verdict.

## Action
1. Run: `gh issue view {uv-issue} --json number,title,body,comments` once and
   capture both `body` and each `comments[].body`. **Do not** use the bare
   `--comments` flag — it triggers a `repository.issue.projectCards`
   GraphQL deprecation error in current `gh` versions and aborts the call.
   `--json comments` queries a different field set and is unaffected.
2. Over the concatenated text of body + comments, extract every path
   matching the regex `(?:docs/[^\s)"'`]+|agents/docs/[^\s)"'`]+)`;
   deduplicate while preserving first-seen order; emit the list as
   `doc_paths_required`. **Do not include** paths starting with
   `tmp/`, `node_modules/`, `dist/`, `build/`, or `.git/` even if they
   contain `docs` or `design` substrings — those are working files, not
   permanent documentation.

## Verdict
- `next` — extraction completed (including empty list). Transitions to
  `closure.consider.doc-verify`.
- `repeat` — `gh issue view` parse / network failure. Re-runs this step.

## Do ONLY this
- Do not read any of the referenced files.
- Do not run commands other than the single `gh issue view --json …` call in Action step 1.
- Do not emit any other artifact field beyond `doc_paths_required`.
