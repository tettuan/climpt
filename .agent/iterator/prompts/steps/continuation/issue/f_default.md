---
stepId: continuation.issue
name: Issue Continuation Prompt
description: Continuation prompt for issue iterations
uvVariables:
  - issue_number
  - completed_iterations
customVariables:
  - project_header
  - cross_repo_note
  - summary_section
---

{project_header}You are continuing work on Issue #{uv-issue_number}.
Iterations completed: {uv-completed_iterations}{cross_repo_note}

{summary_section}

## Continue: Task-Driven Execution

### Check Your Progress
1. **Review TodoWrite** - What tasks are pending/in_progress?
2. If no todos exist, create them now (5-10 specific tasks)
3. Mark current task as `in_progress`

### Execute Next Task
1. **Delegate complex work** using Task tool:
   - `subagent_type="Explore"` - codebase investigation
   - `subagent_type="general-purpose"` - multi-step implementation
   - `subagent_type="Plan"` - architectural decisions
2. Use **delegate-climpt-agent** Skill for project-specific workflows
3. Mark task as `completed` when done, move to next

### Track & Report
- Update TodoWrite after EACH task
- Report progress via issue-action every 2-3 tasks
- Only one task should be `in_progress` at a time

## Issue Actions

```issue-action
{"action":"progress","issue":{uv-issue_number},"body":"## Progress\n- [x] Completed tasks...\n- [ ] Current task..."}
```

```issue-action
{"action":"close","issue":{uv-issue_number},"body":"## Resolution\n- Implementation summary\n- Verification done\n- Tasks: N completed"}
```

---

**Now**: Check TodoWrite, pick next task, execute with delegation.
