---
stepId: closure.detail.scan-considerer
name: Scan Issue Body And Considerer Comment
description: Read-only scan of issue body and the latest considerer comment.
uvVariables:
  - issue
---

# Goal: Read issue #{uv-issue} body and the latest considerer comment

This step does NOT decide a verdict, does NOT verify anchors, and does NOT
post any comment. It only extracts the raw textual evidence the downstream
steps need.

## Inputs (handoff)

- `{uv-issue}` — GitHub issue number (entry-step UV; no upstream handoff fields).

## Outputs

Schema: `closure.detail.scan-considerer` in `schemas/detailer.schema.json`.

- `considerer_comment_body: string | null` — full markdown body of the latest
  considerer comment. Null only if no comment beginning with `## 検討結果`
  exists.
- `issue_acceptance_criteria: string[]` — bullet items / checkbox items from
  the issue body that state acceptance criteria, expected behavior, or
  requirements. Empty array when none are present.

## Action

1. Run exactly:

   ```bash
   gh issue view {uv-issue} --json number,title,body,labels,author,comments
   ```

2. From `comments[]`, locate the latest entry whose `body` begins with
   `## 検討結果` (newest by `createdAt`). Capture its full `body` verbatim
   into `considerer_comment_body`. If no such comment exists, set
   `considerer_comment_body` to `null`.
3. From the issue `body`, extract acceptance-criteria-style lines:
   - Markdown checkbox items under `## Acceptance Criteria`,
     `## 受入条件`, `## 期待動作`, `## 完了条件`, or equivalent headings.
   - If no dedicated section exists, capture top-level bullet items that
     describe expected outcomes verbatim.
   - Trim each item; do not paraphrase. Preserve original order.
   - Emit `[]` (empty array) if none can be extracted.

## Verdict

- `next` — extraction completed (including `considerer_comment_body=null` and
  `issue_acceptance_criteria=[]`). Transitions to
  `closure.detail.verify-anchors`.
- `repeat` — `gh issue view` parse / network failure. Re-runs this step.

## Do ONLY this

- Do not run any command other than the single `gh issue view --json …` call
  in Action step 1.
- Do not call `Read` / `Glob` / `Grep` against the repository — anchor
  verification is the next step's responsibility.
- Do not post any comment.
- Do not emit `verdict`, `final_summary`, `spec_comment_url`, or any
  other artifact field beyond the two declared outputs.
