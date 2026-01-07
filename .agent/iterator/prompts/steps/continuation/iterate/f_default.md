---
stepId: continuation.iterate
name: Iterate Continuation Prompt
description: Continuation prompt for iteration-based execution
uvVariables:
  - completed_iterations
  - remaining
customVariables:
  - remaining_text
  - summary_section
---

You are continuing in autonomous development mode.
You have completed {uv-completed_iterations} iteration(s). {remaining_text}

{summary_section}

## Your Mission
1. Review the Previous Iteration Summary above to understand what was accomplished
2. Based on the summary, identify the next high-value task to tackle
3. Use the **delegate-climpt-agent** Skill to execute the next development task
4. Make continuous progress on improving the codebase

**Next Step**: Analyze the summary above and determine the most logical next action to take.
