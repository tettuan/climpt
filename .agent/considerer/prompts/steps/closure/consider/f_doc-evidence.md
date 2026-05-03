---
stepId: closure.consider.doc-evidence
name: Collect Commit Evidence For Diffed Doc Paths
description: For each path with diffed=true, gather commit metadata (sha, date, subject, --stat) since the issue baseline. Fact-gathering only; no LLM judgment, no relevance evaluation.
uvVariables:
  - issue
---

# Goal: Collect commit evidence for paths the issue requires

This step is fact-gathering only. It enumerates commit metadata for each
`diffed=true` path so the downstream `consider` terminal step can decide
verdict (`done` vs `handoff-detail`) with full context. **Do not judge whether
the commits resolve the issue** — that is `consider`'s job.

## Inputs (handoff)
- `doc_paths_required` — list from `closure.consider.doc-scan`.
- `doc_diff_results` — per-path diff outcomes from `closure.consider.doc-verify`.
- `{uv-issue}` — issue id, used to re-fetch `createdAt` as baseline.

## Outputs
- `doc_evidence: [{path, diffed, commits: [{sha, date, subject, stat}], truncated}]`
  — one entry per path in `doc_paths_required`, in input order. Schema:
  `closure.consider.doc-evidence` in `schemas/considerer.schema.json`.

  Example shape:

  ```json
  {
    "stepId": "closure.consider.doc-evidence",
    "status": "completed",
    "summary": "collected commit evidence for <N> diffed doc paths",
    "next_action": { "action": "next" },
    "doc_paths_required": <uv-doc_paths_required verbatim>,
    "doc_diff_results": <uv-doc_diff_results verbatim>,
    "doc_evidence": [
      {
        "path": "tmp/v1.14-project-orchestration/design.md",
        "diffed": true,
        "commits": [
          {
            "sha": "abc1234",
            "date": "2026-04-22T10:30:00Z",
            "subject": "fix design verification gaps for #488",
            "stat": "1 file changed, 12 insertions(+), 3 deletions(-)"
          }
        ],
        "truncated": false
      }
    ]
  }
  ```

## Action

1. `BASELINE_TIME` = `gh issue view {uv-issue} --json createdAt -q .createdAt`
   (ISO-8601 timestamp).
2. For each `path` in `doc_paths_required`:
   - If the matching `doc_diff_results` entry has `diffed=false`:
     - Emit `{path, diffed: false, commits: [], truncated: false}`. Skip git
       calls for this path.
   - Else (`diffed=true`):
     - Enumerate commits since baseline:

       ```bash
       git log --first-parent \
         --since="$BASELINE_TIME" \
         --max-count=20 \
         --format='%H%x09%cI%x09%s' \
         -- "$path"
       ```

       Tab-separated: `<sha>\t<committer-iso-date>\t<subject>`.
     - For each commit, fetch its `--stat` for this path only:

       ```bash
       git show --stat --format= "$sha" -- "$path"
       ```

       Capture the single-line stat summary (e.g.
       `1 file changed, 12 insertions(+), 3 deletions(-)`). Trim whitespace.
     - If `git log` returned exactly 20 commits, set `truncated: true` (more
       commits may exist beyond the cap). Else `truncated: false`.
3. Collect entries into `doc_evidence` in the same order as `doc_paths_required`.

## Verdict
- `next` — evidence collection completed. Transitions to
  `closure.consider.precheck-kind-read`.
- `repeat` — `gh issue view` / `git log` / `git show` failure. Re-runs this
  step (no partial output; runner will retry). `next_action.reason` should
  describe the failing call.

## Do ONLY this
- Run the `gh issue view ... --json createdAt` call once.
- Run `git log --first-parent --since=... --max-count=20 -- "$path"` per `diffed=true` path.
- Run `git show --stat --format= "$sha" -- "$path"` per enumerated commit.
- Do not read the diff body (`git show` without `--stat`, `git diff`, etc.). Hunk-level
  content is intentionally out of scope here — the `consider` terminal step has
  full read access if it needs to drill in.
- Do not judge whether any commit "resolves" the issue. Relevance is for `consider` to
  decide.
- Do not read the issue body, comments, or any source file.
- Do not post issue comments or modify any state.
- Do not exceed `--max-count=20`. The cap is intentional to bound cost on long-lived
  issues; `truncated: true` signals the cap was hit.
