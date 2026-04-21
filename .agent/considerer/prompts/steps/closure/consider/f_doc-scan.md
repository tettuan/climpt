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
1. Run: `gh issue view {uv-issue} --json number,title,body` and capture the body text.
2. Run: `gh issue view {uv-issue} --comments` and capture each comment body.
3. Over the concatenated text of body + comments, extract every path matching the regex
   `(?:docs/[^\s)"'`]+|[^\s)"'`]*design[^\s)"'`]*\.md|agents/docs/[^\s)"'`]+)`; deduplicate
   while preserving first-seen order; emit the list as `doc_paths_required`.

## Do ONLY this
- Do not read any of the referenced files.
- Do not run commands other than `gh issue view` in Action steps 1 and 2.
- Do not emit any other artifact field.
- Do not emit intents other than `next` (on successful extraction, including empty list)
  or `repeat` (only on parse / gh failure).
