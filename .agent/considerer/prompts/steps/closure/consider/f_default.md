---
stepId: consider
name: Consider Implementation Request
description: Single-iteration — read, research, respond, emit verdict, close.
uvVariables:
  - issue
---

# Task: Consider issue #{uv-issue}

## Step 1 — Read the issue

```bash
gh issue view {uv-issue} --json number,title,body,labels,author,comments
```

Parse:
- The question(s) in the body (sections `## 質問`, `## 回答期待`, etc.)
- Any embedded implementation request (`## 実装要望`)
- Prior comments

## Step 2 — Research

Investigate the question using read-only tools. Cite evidence.

- Use `Grep` / `Glob` / `Read` on the codebase for behavioral questions.
- Use `Read` on `docs/` and `.agent/**/README.md` for design/policy questions.
- Delegate deep investigation to a sub-agent via `Task` if the scope is
  broad.
- Use `WebFetch` only when the issue references an external URL.

## Step 3 — Compose response

Follow the response comment structure in the system prompt exactly.
Required sections:
- `### 質問への回答`
- `### 実装要望の評価`
- `### 次アクション`

Write in Japanese to match the issue language. Cite file paths with
`path:line` format.

## Step 4 — Judge the verdict

Before posting, decide `verdict` using the criteria in the system prompt.

Emit `handoff-detail` only when **both** hold:
1. You conclude that implementation **should** be done.
2. You can name **at least one** concrete anchor:
   - target file path (e.g., `agents/orchestrator/dispatcher.ts`)
   - function / type / symbol (e.g., `mapResultToOutcome`)
   - modification strategy (specific approach, not "refactor" or "improve")

Otherwise emit `done`. This includes:
- Question fully answered, no implementation needed.
- Not a bug / expected behavior / won't-fix / infeasible / duplicate.
- Implementation-recommended but only abstractly — close here rather than
  forwarding an under-specified request to the detailer.

Record the chosen anchor (file / symbol / strategy) inside
`### 次アクション` of the response comment so reviewers can audit the call.

## Step 5 — Post response + signal completion

Considerer's responsibility ends at posting the response and signaling
completion. **Do NOT run `gh issue close`** — the orchestrator closes the
issue based on phase transition. Doing it yourself causes a double-close
error.

Execute in order:

```bash
# Post the response
gh issue comment {uv-issue} --body-file <path-to-your-response>

# Signal completion by atomically swapping kind:consider → done.
# (The orchestrator will also reconcile labels on phase transition.
# This self-applied atomic swap is a safety net that avoids the
# invalid combined state `kind:consider` + `done` if a follow-up
# rotation aborts.)
gh issue edit {uv-issue} --remove-label "kind:consider" --add-label "done"
```

Write the response to a scratch file under `$TMPDIR/considerer-{uv-issue}.md`
first, then pass it to `--body-file`. Do not embed multi-line markdown in a
shell argument.

## Step 6 — Emit structured output

Return a JSON object matching `closure.consider` in
`schemas/considerer.schema.json`:

```json
{
  "stepId": "consider",
  "status": "completed",
  "summary": "<one-line summary of what was answered>",
  "next_action": { "action": "closing" },
  "verdict": "done",
  "final_summary": "<one-paragraph recap incl. verdict rationale>",
  "handoff_anchor": {
    "file": null,
    "symbol": null,
    "strategy": null
  }
}
```

Rules:
- `verdict` MUST be `"done"` or `"handoff-detail"`.
- For `verdict: "handoff-detail"`, at least one of
  `handoff_anchor.file`, `handoff_anchor.symbol`, `handoff_anchor.strategy`
  MUST be a non-empty string. All three may be filled.
- For `verdict: "done"`, `handoff_anchor` fields MAY all be `null`.
- `next_action.action` is always `"closing"` (single-iteration closure).

## Step 7 — Final status

Output a single-line summary:

```
considerer: <verdict> #<N> (kind:consider → <verdict>, awaiting orchestrator transition)
```

On failure at any step, stop and report which step failed with the full
command output. Do not retry silently. Do NOT attempt `gh issue close`.
