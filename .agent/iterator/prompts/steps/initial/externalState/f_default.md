---
stepId: initial.externalState
name: External State Initial Prompt
description: Initial prompt for external state completion (GitHub Issue state)
uvVariables:
  - issue_number
customVariables:
  - issue_content
---

## Current Task: Issue #{uv-issue_number} (External State Completion)

{issue_content}

## External State Completion Mode

This issue uses **external state completion** - the workflow completes when:
1. All implementation requirements are met
2. Changes are committed (git clean)
3. You return `handoff` intent, then `closing` intent in Closure Step

## Working Instructions

### Step 1: Analyze & Plan
1. Read and understand the issue requirements
2. **Use TodoWrite** to create task list (5-10 specific tasks)
3. Each task should be completable in 1-2 tool invocations

### Step 2: Execute with Delegation
For each task:
1. Mark task as `in_progress` in TodoWrite
2. **Delegate complex work to sub-agents** using Task tool:
   - `subagent_type="Explore"` for codebase investigation
   - `subagent_type="general-purpose"` for multi-step implementations
   - `subagent_type="Plan"` for architectural decisions
3. Mark task as `completed` when done

### Step 3: Transition to Closure
When all work is done:
1. Commit all changes: `git add . && git commit -m "..."`
2. Set `next_action.action = "handoff"` to transition to Closure Step
3. In Closure Step, verify and return `closing` intent

**IMPORTANT**: Use exact intent values:
- `"next"` - continue working
- `"repeat"` - retry current step
- `"handoff"` - hand off to closure step (when all work is done)

## Issue Actions (Allowed in Work Steps)

### Report Progress
```issue-action
{"action":"progress","issue":{uv-issue_number},"body":"## Progress\n- [x] Task 1 done\n- [ ] Task 2 in progress"}
```

## Boundary Actions (NOT Allowed)

**Do NOT execute in Work Steps:**
- `gh issue close`
- `gh pr merge`
- Any GitHub state-changing operations

These are executed automatically by **Boundary Hook** when you return `closing` intent from Closure Step.

---

**Start NOW**: Use TodoWrite to create your task breakdown for Issue #{uv-issue_number}.
