---
stepId: initial.issue
name: Issue Initial Prompt
description: Initial prompt when working on a single GitHub issue
uvVariables:
  - issue_number
customVariables:
  - project_context_section
  - issue_content
  - cross_repo_note
---

{project_context_section}## Current Task: Issue #{uv-issue_number}

{issue_content}
{cross_repo_note}
## Working Style: Task-Driven & Progressive

**IMPORTANT**: Work in small, trackable steps with frequent progress updates.

### Step 1: Analyze & Break Down
1. Read and understand the issue requirements thoroughly
2. **Use TodoWrite** to create fine-grained task list (5-10 specific tasks)
3. Each task should be completable in 1-2 tool invocations

### Step 2: Execute with Delegation
For each task:
1. Mark task as `in_progress` in TodoWrite
2. **Delegate complex work to sub-agents** using Task tool:
   - Use `subagent_type="Explore"` for codebase investigation
   - Use `subagent_type="general-purpose"` for multi-step implementations
   - Use `subagent_type="Plan"` for architectural decisions
3. Use **delegate-climpt-agent** Skill for project-specific workflows
4. Mark task as `completed` when done

### Step 3: Track Progress
- Update TodoWrite after EACH task completion
- Report progress via issue-action every 2-3 tasks
- Keep momentum: one task at a time, always moving forward

## Sub-Agent Delegation Guide

Use Task tool to offload work:
| Situation | Sub-agent Type |
|-----------|----------------|
| Find files/understand structure | `Explore` |
| Implement a feature | `general-purpose` |
| Design implementation approach | `Plan` |
| Project-specific commands | `delegate-climpt-agent` Skill |

**Parallel execution**: Launch multiple independent agents simultaneously for efficiency.

## Issue Actions

Use these structured outputs. **Do NOT run `gh` commands directly.**

### Report Progress (RECOMMENDED every 2-3 tasks)
```issue-action
{"action":"progress","issue":{uv-issue_number},"body":"## Progress\n- [x] Task 1 done\n- [x] Task 2 done\n- [ ] Task 3 in progress"}
```

### Complete Issue (REQUIRED when done)
```issue-action
{"action":"close","issue":{uv-issue_number},"body":"## Resolution\n- What was implemented\n- How it was verified\n- Tasks completed: N"}
```

### Ask a Question (if blocked)
```issue-action
{"action":"question","issue":{uv-issue_number},"body":"Need clarification on..."}
```

### Report Blocker (if cannot proceed)
```issue-action
{"action":"blocked","issue":{uv-issue_number},"body":"Cannot proceed because...","label":"need clearance"}
```

---

**Start NOW**: Use TodoWrite to create your task breakdown for Issue #{uv-issue_number}.
