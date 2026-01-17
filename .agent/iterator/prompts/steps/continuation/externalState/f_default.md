---
stepId: continuation.externalState
name: External State Continuation Prompt
description: Continuation prompt for external state completion
uvVariables:
  - issue_number
  - completed_iterations
customVariables:
  - summary_section
---

You are continuing work on Issue #{uv-issue_number}.
Iterations completed: {uv-completed_iterations}

{summary_section}

## Continue: External State Completion

### Check Progress
1. **Review TodoWrite** - What tasks are pending/in_progress?
2. If no todos exist, create them now
3. Mark current task as `in_progress`

### Execute Next Task
1. **Delegate complex work** using Task tool:
   - `subagent_type="Explore"` - codebase investigation
   - `subagent_type="general-purpose"` - multi-step implementation
2. Mark task as `completed` when done

### External State Check
After completing work:
1. **Check Issue State**: Is GitHub Issue #{uv-issue_number} closed?
2. If **closed**: Report `next_action.action = "closing"`
3. If **open**: Continue working or close when ready

## Issue Actions

### Report Progress
```issue-action
{"action":"progress","issue":{uv-issue_number},"body":"## Progress\n- [x] Completed tasks...\n- [ ] Current task..."}
```

### Complete Issue

**Before closing:**
- Ensure all changes are committed (`git status` must be clean)
- Run `git add .` && `git commit` if needed

```issue-action
{"action":"close","issue":{uv-issue_number},"body":"## Resolution\n- Implementation summary\n- Tasks completed: N"}
```

---

**Now**: Check TodoWrite, pick next task, execute with delegation.
