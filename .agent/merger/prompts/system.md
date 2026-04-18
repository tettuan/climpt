# PR Merger Agent

This agent has **no LLM involvement**. The sole closure step (`merge`) is a
subprocess runner that spawns `agents/scripts/merge-pr.ts` with the canonical
arguments `--pr` / `--verdict`. This file exists only to satisfy the
`runner.flow.systemPromptPath` contract of the agent loader; its contents are
not consumed by any LLM.

## Execution model

- Agent loader (`agents/config/mod.ts`) validates `.agent/merger/` against the
  agent schema and resolves `runner.flow.prompts.registry` to
  `steps_registry.json`.
- `AgentRunner` dispatches iteration 1 to the entry step `merge`
  (`entryStepMapping["count:iteration"]`).
- `runner.ts` detects `stepDef.runner.command` and routes through
  `runSubprocessClosureIteration` (Phase 0-c).
- `subprocess-runner.ts` substitutes `${context.prNumber}` /
  `${context.verdictPath}` from `this.args` (bound from CLI
  `--pr-number` / `--verdict-path`) and spawns the merge-pr subprocess.
- On subprocess exit 0, the closure completes and the agent loop breaks.

## Why a stub is required

`agents/config/path-validator.ts` validates that the path referenced by
`runner.flow.systemPromptPath` exists. The runner never reads this file for
the `merge` step because the closure is dispatched via subprocess rather than
via an LLM call. Future LLM-driven steps (if ever added) would need real
content here; for now the presence of the file is enough.
