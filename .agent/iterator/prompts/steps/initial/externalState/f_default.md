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

This issue uses **external state completion** - the issue is considered complete when:
1. The GitHub Issue is closed
2. All implementation requirements are met
3. Changes are committed

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

### Step 3: External State Check
At the end of each iteration:
1. Check if GitHub Issue #{uv-issue_number} is closed
2. If closed, report completion
3. If open, continue working or close it when ready

## Issue Actions

### Report Progress
```issue-action
{"action":"progress","issue":{uv-issue_number},"body":"## Progress\n- [x] Task 1 done\n- [ ] Task 2 in progress"}
```

### Complete Issue

**Pre-close checklist:**
1. Run `git status` - ensure no uncommitted changes
2. If changes exist: `git add .` && `git commit -m "..."`
3. Verify clean state before closing

```issue-action
{"action":"close","issue":{uv-issue_number},"body":"## Resolution\n- Implementation summary\n- All changes committed"}
```

---

**Start NOW**: Use TodoWrite to create your task breakdown for Issue #{uv-issue_number}.
