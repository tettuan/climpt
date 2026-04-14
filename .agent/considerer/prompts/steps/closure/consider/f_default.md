---
stepId: consider
name: Consider Implementation Request
description: Single-iteration — read, research, respond, close.
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

## Step 4 — Post response + signal completion

Considerer's responsibility ends at posting the response and signaling
completion. **Do NOT run `gh issue close`** — the orchestrator closes the
issue via `closeOnComplete: true` on phase transition to `done`. Doing it
yourself causes a double-close error.

Execute in order:

```bash
# Post the response
gh issue comment {uv-issue} --body-file <path-to-your-response>

# Signal completion by adding done label.
# (The orchestrator will also strip kind:* and apply done on phase
# transition, and will close the issue. This self-applied label is a
# safety net in case the transition fails.)
gh issue edit {uv-issue} --add-label "done"
```

Write the response to a scratch file under `$TMPDIR/considerer-{uv-issue}.md`
first, then pass it to `--body-file`. Do not embed multi-line markdown in a
shell argument.

## Step 5 — Final status

Output a single-line summary:

```
considerer: done #<N> (kind:consider → done, awaiting orchestrator close)
```

On failure at any step, stop and report which step failed with the full
command output. Do not retry silently. Do NOT attempt `gh issue close`.
