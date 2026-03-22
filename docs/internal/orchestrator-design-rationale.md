# Orchestrator Design Rationale

Design provenance, pattern analysis, and deferred decisions for the orchestrator
system (`agents/orchestrator/`).

## Design Provenance

The orchestrator design synthesizes three sources:

1. **guimpt workflow patterns** — GUI version of Climpt with verified
   workflow.json schema, phase types, and transition patterns
2. **Google ADK patterns** — Agent Development Kit orchestration primitives
   (Sequential, Loop, Generator-Critic)
3. **coordination-config.json** — Legacy static handoff configuration, absorbed
   into workflow.json

## ADK Pattern Mapping

Applicable ADK patterns mapped to orchestrator equivalents:

| ADK Pattern              | Orchestrator Equivalent                                |
| ------------------------ | ------------------------------------------------------ |
| SequentialAgent          | Main loop steps 3→12 (resolve → dispatch → transition) |
| LoopAgent                | Main loop itself (cycle 1..maxCycles)                  |
| LoopAgent.max_iterations | `rules.maxCycles`                                      |
| LoopAgent escalate       | Terminal / blocking phase transition                   |
| Generator-Critic         | iterator (transformer) → reviewer (validator) cycle    |
| Shared Session State     | GitHub issue labels + IssueWorkflowState               |
| output_key               | Agent structured output → outcome → phase transition   |
| Callback (before_agent)  | Step 6: cycle exceeded check                           |
| Callback (after_agent)   | Steps 8-12: transition + label update + comment        |
| CustomAgent branching    | Validator outputPhases branching                       |
| Reflect and Retry        | fallbackPhase + maxCycles iterative recovery           |

### Patterns Not Adopted

| ADK Pattern         | Reason                                                                |
| ------------------- | --------------------------------------------------------------------- |
| LLM-Driven Transfer | Label-based deterministic routing preferred for predictability        |
| AgentTool           | One-way dependency (orchestrator → runner); no inter-agent tool calls |
| ParallelAgent       | Sequential execution only; no concurrency control needed              |

### Key Difference: Label-Based vs Code-First

| Aspect             | ADK (Code-First)          | Climpt (Declarative JSON)   |
| ------------------ | ------------------------- | --------------------------- |
| Definition         | Python/TS code            | workflow.json               |
| Branching          | CustomAgent if/else       | labelMapping + outputPhases |
| Transition trigger | Explicit code / escalate  | GitHub label change         |
| Execution context  | InvocationContext + state | GitHub issue + labels       |
| Type safety        | Language type system      | JSON Schema validation      |
| Visibility         | Requires code reading     | JSON declaratively viewable |

The label-based approach prioritizes:

1. **Visibility** — Workflow state is always visible on GitHub issues
2. **Persistence** — GitHub manages state (no separate SessionService)
3. **Human integration** — GitHub UI is the control panel
4. **Predictability** — Declarative constraints over arbitrary code

## guimpt Pattern Reference

Patterns extracted from guimpt (GUI Climpt) and applied to CLI orchestration:

### Phase Types

| Type         | Description          | Agent Execution |
| ------------ | -------------------- | --------------- |
| `actionable` | Agent processes work | yes             |
| `terminal`   | Workflow complete    | no              |
| `blocking`   | Awaiting human input | no              |

### Agent Roles

- **Transformer**: Single output path. `outputPhase` (success) / `fallbackPhase`
  (error). Example: iterator agent.
- **Validator**: Multiple output paths via `outputPhases` mapping. Example:
  reviewer agent with approved/rejected.
- **Orchestrator**: Meta-coordination role (reserved for future expansion).

### Execution Patterns from guimpt

- Queue-based execution with priority ordering
- Label synchronization (add/remove on agent start/completion)
- Batch enqueue (`climpt workflow enqueue --label ready`)
- Auto-polling with backoff (deferred)
- DAG visualization (deferred)

## coordination-config Migration

The `agents/common/coordination-config.json` and related files were absorbed
into workflow.json:

| coordination-config Field    | workflow.json Destination                       | Rationale                            |
| ---------------------------- | ----------------------------------------------- | ------------------------------------ |
| `labels.*`                   | `labelMapping`                                  | Unified label → phase ID mapping     |
| `handoff.*`                  | `handoff.commentTemplates` + `handoff.gapIssue` | Separated from agent transition defs |
| `retry.*`                    | Removed                                         | Retry is runner's responsibility     |
| `orchestration.maxCycles`    | `rules.maxCycles`                               | Same concept                         |
| `orchestration.cycleDelayMs` | `rules.cycleDelayMs`                            | Same concept                         |
| `orchestration.autoTrigger`  | CLI option                                      | Runtime option, not config file      |
| `logging.*`                  | Removed                                         | Logging is runner's responsibility   |
| `traceability.*`             | Removed                                         | Unnecessary complexity               |

### Deleted Files

- `agents/common/coordination-config.json`
- `agents/common/coordination-config.schema.json`
- `agents/common/coordination-types.ts`
- `agents/common/coordination.ts`
- `agents/common/coordination_test.ts`

### Function Migration

| coordination Function                 | Migrated To                              |
| ------------------------------------- | ---------------------------------------- |
| `loadCoordinationConfig()`            | `workflow-loader.ts` `loadWorkflow()`    |
| `getLabel()`                          | `label-resolver.ts` `resolvePhase()`     |
| `renderHandoffComment()`              | `phase-transition.ts` template rendering |
| `generateCorrelationId()`             | `cycle-tracker.ts` correlation ID gen    |
| `LabelConfig` / `HandoffConfig` types | `workflow-types.ts`                      |

## Deferred Decisions

| Item              | Options                            | Decision Timing             |
| ----------------- | ---------------------------------- | --------------------------- |
| DAG visualization | CLI table vs guimpt integration    | After guimpt implementation |
| Auto-polling mode | `--watch` flag vs separate command | v2                          |

## Sources

- guimpt workflow definitions (internal)
- [Google ADK Documentation](https://google.github.io/adk-docs/)
- [ADK Workflow Agents](https://google.github.io/adk-docs/agents/workflow-agents/)
- [ADK Custom Agents](https://google.github.io/adk-docs/agents/custom-agents/)
- [ADK Multi-Agent Systems](https://google.github.io/adk-docs/agents/multi-agents/)
- [ADK State Management](https://google.github.io/adk-docs/sessions/state/)
- [ADK Callbacks](https://google.github.io/adk-docs/callbacks/types-of-callbacks/)
