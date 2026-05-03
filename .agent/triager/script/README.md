# Triager — Ad-hoc Dispatcher

**Status: ad-hoc, not part of the product.**

This directory contains a temporary shell-level dispatcher that fans
out kind-less open issues to the triager agent (which operates in
per-issue dispatch mode via `--issue <N>`).

## Why

The product orchestrator (`agents/scripts/run-workflow.ts`) only
dispatches issues that already carry a phase-resolvable workflow label
(`agents/orchestrator/label-resolver.ts:25-56` returns null for kind-less
issues; `agents/orchestrator/queue.ts:55-73` skips them; emitted as
"not actionable" in `agents/orchestrator/batch-runner.ts:254-258`). The
triager exists to assign the first `kind:*` label — but it cannot be
driven by an orchestrator that requires a label as the entry condition.

Until climpt 本体 (the product orchestrator) supports a kind-less-issue
dispatch path natively, this shell script bridges the gap. It uses only
`gh` and `deno task agent`; no TS, no orchestrator wiring.

## Lifetime

Discard when climpt 本体起動 supports kind-less-issue dispatch. At
that point this directory should be deleted in the same commit that adds
the product path.

## Files

- `dispatch.sh` — list open issues that carry no `kind:*` label, run
  the triager agent once per issue, sequentially.

## How to run

```bash
bash .agent/triager/script/dispatch.sh
```

Optional environment overrides:

- `WORKFLOW` (default `.agent/workflow.json`) — workflow JSON used to
  derive the workflow label set.
- `LIMIT` (default `9`) — max number of issues to dispatch in one run.
- `PROJECT` (default unset) — `<owner>/<number>` (e.g. `tettuan/41`).
  When set, the candidate set is intersected with the issues that belong
  to this GitHub Project v2; only those are triaged. Project membership
  is resolved via `gh project item-list`.
- `DRY_RUN=1` — print the issue numbers that would be dispatched, do
  not invoke the agent.

Example — triage only issues that belong to Project #41 owned by `tettuan`:

```bash
PROJECT=tettuan/41 bash .agent/triager/script/dispatch.sh
```

## Why sequential

Triager classify-only has no global state to race on (each invocation
labels its own target's `kind:*`). Sequential execution is kept for log
clarity and to bound concurrent gh API calls; it is not a correctness
requirement. Priority assignment (`order:N`) — which IS a global decision
— is the prioritizer's responsibility, not this dispatcher's.
