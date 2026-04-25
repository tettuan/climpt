# Triager — Ad-hoc Dispatcher

**Status: ad-hoc, not part of the product.**

This directory contains a temporary shell-level dispatcher that fans
out unlabeled open issues to the triager agent (which now operates in
per-issue dispatch mode via `--issue <N>`).

## Why

The product orchestrator (`agents/scripts/run-workflow.ts`) only
dispatches issues that already carry a phase-resolvable workflow label
(`agents/orchestrator/label-resolver.ts:25-56` returns null for unlabeled
issues; `agents/orchestrator/queue.ts:55-73` skips them; emitted as
"not actionable" in `agents/orchestrator/batch-runner.ts:254-258`). The
triager exists to assign those first labels — but it cannot be driven
by an orchestrator that requires a label as the entry condition.

Until climpt 本体 (the product orchestrator) supports an unlabeled-issue
dispatch path natively, this shell script bridges the gap. It uses only
`gh` and `deno task agent`; no TS, no orchestrator wiring.

## Lifetime

Discard when climpt 本体起動 supports unlabeled-issue dispatch. At
that point this directory should be deleted in the same commit that adds
the product path.

## Files

- `dispatch.sh` — list unlabeled open issues, run the triager agent
  once per issue, sequentially.

## How to run

```bash
bash .agent/triager/script/dispatch.sh
```

Optional environment overrides:

- `WORKFLOW` (default `.agent/workflow.json`) — workflow JSON used to
  derive the workflow label set.
- `LIMIT` (default `9`) — max number of issues to dispatch in one run.
- `DRY_RUN=1` — print the issue numbers that would be dispatched, do
  not invoke the agent.

## Why sequential

The triager picks the smallest unused `order:N` per issue by querying
`gh issue list` for existing `order:*` labels. Parallel dispatch would
race and produce duplicate `order:N` assignments. Sequential execution
is the only correctness guarantee available without a coordinator.
