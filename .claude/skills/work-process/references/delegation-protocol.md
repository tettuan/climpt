# Delegation Protocol

## Agent Tool Parameters

| Parameter | Values | When to use |
|-----------|--------|-------------|
| `subagent_type` | `Explore`, `Plan`, `general-purpose` | Match to task purpose (see table below) |
| `run_in_background` | `true` | Independent tasks that don't block next steps |
| `isolation` | `"worktree"` | Parallel implementation agents editing files |
| `model` | `sonnet`, `haiku`, `opus` | Cost optimization (e.g., haiku for exploration) |

## Agent Type by Purpose

| Purpose | Agent Type (`subagent_type`) | Tools | Notes |
|---------|----------------------------|-------|-------|
| File exploration, code search | `Explore` | Read-only | Uses haiku model by default. Fast, low-latency |
| Design comparison, architecture planning | `Plan` | Read-only | Inherits parent model |
| Implementation, testing, verification | `general-purpose` | Full access | Inherits parent model. Use `isolation: "worktree"` for parallel edits |

## Agent Prompt Structure

Every sub agent launch must specify these elements:

| Element | Required | Example |
|---------|----------|---------|
| Goal | Yes | "Find all consumers of createCompletionHandler" |
| Input | Yes | "Start from agents/verdict/factory.ts" |
| Expected output | Yes | "List of file:line pairs with import/call sites" |
| `subagent_type` | Yes | `Explore` / `Plan` / `general-purpose` |
| `run_in_background` | When independent | `true` for tasks that don't block next steps |
| `isolation` | When parallel edits | `"worktree"` for implementation agents editing files |
| `model` | When cost matters | `haiku` for exploration, `opus` for complex reasoning |

## Sub Agent Constraints

| Constraint | Impact |
|-----------|--------|
| Cannot spawn other sub agents | Delegation must be flat: conductor → sub agents |
| Foreground blocks main conversation | Use `run_in_background: true` for independent tasks |
| Background auto-denies unpermitted tools | Pre-approve permissions before background launch |
| Results return to main context | Many detailed results can consume significant context |

## Multi-Agent Conflict Resolution

When two sub agents edit the same file, conductor judges the merge manually. Do not auto-combine.

```
sub agent A edits factory.ts (lines 10-30)
sub agent B edits factory.ts (lines 25-50)
→ Conductor reads both diffs, decides which changes to keep, applies manually
```

When using `isolation: "worktree"`, each sub agent works on an isolated copy. The worktree is automatically cleaned up if no changes are made.

## Resuming Sub Agents

When a sub agent returns incomplete results, use `SendMessage` with the agent's ID to resume it with full context preserved, instead of launching a new agent from scratch.

| Situation | Action |
|-----------|--------|
| Incomplete result | SendMessage with clarifying prompt |
| Need follow-up analysis | SendMessage to continue from where it stopped |
| New independent task | Launch new Agent (fresh context) |
