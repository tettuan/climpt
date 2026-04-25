---
stepId: closure.consider.doc-scan
name: Scan Issue For Required Doc Paths
description: Extract every doc path mentioned in issue body + comments.
uvVariables:
  - issue
---

# Goal: Extract every doc path mentioned in issue body and comments

## Inputs
- `{uv-issue}` — GitHub issue number

## Outputs
- `doc_paths_required: [string]` — distinct file paths that match any of:
  - `docs/**`
  - `**/design*.md`
  - `agents/docs/**`

## Action
1. Run: `gh issue view {uv-issue} --json number,title,body,comments` once and
   capture both `body` and each `comments[].body`. **Do not** use the bare
   `--comments` flag — it triggers a `repository.issue.projectCards`
   GraphQL deprecation error in current `gh` versions and aborts the call.
   `--json comments` queries a different field set and is unaffected.
2. Over the concatenated text of body + comments, extract every path matching the regex
   `(?:docs/[^\s)"'`]+|[^\s)"'`]*design[^\s)"'`]*\.md|agents/docs/[^\s)"'`]+)`; deduplicate
   while preserving first-seen order; emit the list as `doc_paths_required`.

## Do ONLY this
- Do not read any of the referenced files.
- Do not run commands other than the single `gh issue view --json …` call in Action step 1.
- Do not emit any other artifact field.
- Do not emit intents other than `next` (on successful extraction, including empty list)
  or `repeat` (only on parse / gh failure).
