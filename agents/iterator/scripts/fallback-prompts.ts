/**
 * Fallback Prompts - Embedded Default Prompts for Iterator Agent
 *
 * These prompts are used when user-defined prompt files don't exist.
 * Users can override these by creating files in .agent/iterator/prompts/
 *
 * Keys match the fallbackKey in steps_registry.json
 *
 * ## Prompt Categories
 *
 * ### Issue Mode
 * - initial.issue: Initial prompt when working on a single issue
 * - continuation.issue: Continuation prompt for issue iterations
 * - section.project_context: Project context section (when issue is part of project)
 *
 * ### Project Mode
 * - initial.project.preparation: Preparation phase prompt
 * - initial.project.processing: Processing phase prompt (delegates to issue)
 * - initial.project.review: Review phase prompt
 * - initial.project.again: Re-execution phase prompt
 * - initial.project.complete: Completion message
 * - continuation.project.preparation: Preparation continuation
 * - continuation.project.processing: Processing continuation (delegates to issue)
 * - continuation.project.review: Review continuation
 * - continuation.project.again: Again continuation
 *
 * ### Iterate Mode
 * - initial.iterate: Initial prompt for iteration-based execution
 * - continuation.iterate: Continuation prompt for iterations
 */

import type { FallbackPromptProvider } from "../../common/prompt-resolver.ts";

// =============================================================================
// Issue Mode Prompts
// =============================================================================

/**
 * Initial prompt for issue mode
 *
 * Variables:
 * - {project_context_section}: Optional project context (empty if standalone issue)
 * - {uv-issue_number}: Issue number
 * - {issue_content}: Fetched issue content
 * - {cross_repo_note}: Note for cross-repo issues
 */
export const ISSUE_INITIAL_DEFAULT = `
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
1. Mark task as \`in_progress\` in TodoWrite
2. **Delegate complex work to sub-agents** using Task tool:
   - Use \`subagent_type="Explore"\` for codebase investigation
   - Use \`subagent_type="general-purpose"\` for multi-step implementations
   - Use \`subagent_type="Plan"\` for architectural decisions
3. Use **delegate-climpt-agent** Skill for project-specific workflows
4. Mark task as \`completed\` when done

### Step 3: Track Progress
- Update TodoWrite after EACH task completion
- Report progress via issue-action every 2-3 tasks
- Keep momentum: one task at a time, always moving forward

## Sub-Agent Delegation Guide

Use Task tool to offload work:
| Situation | Sub-agent Type |
|-----------|----------------|
| Find files/understand structure | \`Explore\` |
| Implement a feature | \`general-purpose\` |
| Design implementation approach | \`Plan\` |
| Project-specific commands | \`delegate-climpt-agent\` Skill |

**Parallel execution**: Launch multiple independent agents simultaneously for efficiency.

## Issue Actions

Use these structured outputs. **Do NOT run \`gh\` commands directly.**

### Report Progress (RECOMMENDED every 2-3 tasks)
\`\`\`issue-action
{"action":"progress","issue":{uv-issue_number},"body":"## Progress\\n- [x] Task 1 done\\n- [x] Task 2 done\\n- [ ] Task 3 in progress"}
\`\`\`

### Complete Issue (REQUIRED when done)
\`\`\`issue-action
{"action":"close","issue":{uv-issue_number},"body":"## Resolution\\n- What was implemented\\n- How it was verified\\n- Tasks completed: N"}
\`\`\`

### Ask a Question (if blocked)
\`\`\`issue-action
{"action":"question","issue":{uv-issue_number},"body":"Need clarification on..."}
\`\`\`

### Report Blocker (if cannot proceed)
\`\`\`issue-action
{"action":"blocked","issue":{uv-issue_number},"body":"Cannot proceed because...","label":"need clearance"}
\`\`\`

---

**Start NOW**: Use TodoWrite to create your task breakdown for Issue #{uv-issue_number}.
`.trim();

/**
 * Continuation prompt for issue mode
 *
 * Variables:
 * - {project_header}: Optional project header
 * - {uv-issue_number}: Issue number
 * - {uv-completed_iterations}: Number of completed iterations
 * - {cross_repo_note}: Note for cross-repo issues
 * - {summary_section}: Previous iteration summary
 */
export const ISSUE_CONTINUATION_DEFAULT = `
{project_header}You are continuing work on Issue #{uv-issue_number}.
Iterations completed: {uv-completed_iterations}{cross_repo_note}

{summary_section}

## Continue: Task-Driven Execution

### Check Your Progress
1. **Review TodoWrite** - What tasks are pending/in_progress?
2. If no todos exist, create them now (5-10 specific tasks)
3. Mark current task as \`in_progress\`

### Execute Next Task
1. **Delegate complex work** using Task tool:
   - \`subagent_type="Explore"\` - codebase investigation
   - \`subagent_type="general-purpose"\` - multi-step implementation
   - \`subagent_type="Plan"\` - architectural decisions
2. Use **delegate-climpt-agent** Skill for project-specific workflows
3. Mark task as \`completed\` when done, move to next

### Track & Report
- Update TodoWrite after EACH task
- Report progress via issue-action every 2-3 tasks
- Only one task should be \`in_progress\` at a time

## Issue Actions

\`\`\`issue-action
{"action":"progress","issue":{uv-issue_number},"body":"## Progress\\n- [x] Completed tasks...\\n- [ ] Current task..."}
\`\`\`

\`\`\`issue-action
{"action":"close","issue":{uv-issue_number},"body":"## Resolution\\n- Implementation summary\\n- Verification done\\n- Tasks: N completed"}
\`\`\`

---

**Now**: Check TodoWrite, pick next task, execute with delegation.
`.trim();

/**
 * Project context section (inserted into issue prompts when part of a project)
 *
 * Variables:
 * - {uv-project_number}: Project number
 * - {uv-project_title}: Project title
 * - {uv-label_info}: Label filter info
 * - {desc_section}: Project description section
 * - {readme_section}: Project readme section
 * - {uv-current_index}: Current issue index
 * - {uv-total_issues}: Total issues count
 * - {remaining_list}: List of remaining issue titles
 * - {more_text}: "... and N more" text if many remaining
 */
export const SECTION_PROJECT_CONTEXT_DEFAULT = `## Project Overview

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}
{desc_section}{readme_section}
**Progress**: Issue {uv-current_index} of {uv-total_issues}

### Remaining Issues (for context only)
{remaining_list}{more_text}

---

`.trim();

// =============================================================================
// Project Mode Prompts
// =============================================================================

/**
 * Preparation phase prompt for project mode
 *
 * Variables:
 * - {uv-project_number}: Project number
 * - {uv-project_title}: Project title
 * - {uv-label_info}: Label filter info
 * - {desc_section}: Project description section
 * - {readme_section}: Project readme section
 * - {uv-total_issues}: Total issues count
 * - {issue_list}: Full list of issues
 */
export const PROJECT_PREPARATION_DEFAULT = `
## Project Overview

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}{desc_section}{readme_section}

## Issues to Process ({uv-total_issues} total)

{issue_list}

## Your Task

Analyze this project and prepare for execution:
1. Review all issues and understand the overall requirements
2. Identify which skills and sub-agents are needed
3. Note any dependencies between issues
4. Create an execution plan

Output your plan in the specified project-plan format.
`.trim();

/**
 * Preparation phase with no issues
 *
 * Variables:
 * - {uv-project_number}: Project number
 * - {uv-project_title}: Project title
 * - {uv-label_info}: Label filter info
 * - {desc_section}: Project description section
 * - {readme_section}: Project readme section
 * - {uv-label_filter}: Label filter (or empty)
 */
export const PROJECT_PREPARATION_NO_ISSUES_DEFAULT = `
## Project Overview

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}{desc_section}{readme_section}

## Status

No{uv-label_filter} issues to process.
Project preparation complete with no work needed.
`.trim();

/**
 * Processing phase with no current issue
 *
 * Variables:
 * - {uv-project_number}: Project number
 * - {uv-label_info}: Label filter info
 * - {uv-project_title}: Project title
 * - {desc_section}: Project description section
 * - {readme_section}: Project readme section
 * - {uv-label_filter}: Label filter (or empty)
 */
export const PROJECT_PROCESSING_EMPTY_DEFAULT = `
You are working on GitHub Project #{uv-project_number}{uv-label_info}.

## Project Overview
**{uv-project_title}**{desc_section}{readme_section}

## Status
All{uv-label_filter} issues in this project are already complete! No work needed.
`.trim();

/**
 * Review phase prompt
 *
 * Variables:
 * - {uv-project_number}: Project number
 * - {uv-project_title}: Project title
 * - {uv-label_info}: Label filter info
 * - {uv-issues_completed}: Number of issues completed
 * - {completed_list}: List of completed issue numbers
 * - {uv-label_filter}: Label filter (or "any")
 */
export const PROJECT_REVIEW_DEFAULT = `
## Project Review

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}

## Work Completed

{uv-issues_completed} issue(s) closed:
{completed_list}

## Your Task

Review the project completion status:
1. Verify all issues with "{uv-label_filter}" label are properly closed
2. Check each issue's resolution quality
3. Identify any remaining work needed

Output your review in the specified review-result format.
`.trim();

/**
 * Again phase prompt (re-execution after failed review)
 *
 * Variables:
 * - {uv-project_number}: Project number
 * - {uv-project_title}: Project title
 * - {uv-label_info}: Label filter info
 * - {review_summary}: Review summary message
 * - {review_findings}: List of issues needing attention
 */
export const PROJECT_AGAIN_DEFAULT = `
## Re-execution Required

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}

## Review Findings

The previous review found these issues:
{review_summary}

Issues needing attention:
{review_findings}

## Your Task

Address the review findings:
1. Analyze each issue that needs attention
2. Complete any remaining work
3. Fix any problems identified
4. Report completion when done

After addressing all findings, the system will run another review.
`.trim();

/**
 * Complete phase message
 *
 * Variables:
 * - {uv-project_number}: Project number
 * - {uv-label_info}: Label filter info
 * - {uv-issues_completed}: Number of issues completed
 */
export const PROJECT_COMPLETE_DEFAULT = `
Project #{uv-project_number}{uv-label_info} is complete!
{uv-issues_completed} issue(s) have been closed.
`.trim();

/**
 * Preparation continuation prompt
 *
 * Variables:
 * - {uv-completed_iterations}: Number of completed iterations
 */
export const PROJECT_CONTINUATION_PREPARATION_DEFAULT = `
Continue preparing the project plan.
Iterations completed: {uv-completed_iterations}

If you have analyzed all issues, output the project-plan JSON.
`.trim();

/**
 * Processing continuation when all issues done
 *
 * Variables:
 * - {uv-project_number}: Project number
 * - {uv-completed_iterations}: Number of completed iterations
 * - {uv-issues_completed}: Number of issues completed
 */
export const PROJECT_CONTINUATION_PROCESSING_DONE_DEFAULT = `
All issues in Project #{uv-project_number} have been processed!
Iterations: {uv-completed_iterations}, Issues closed: {uv-issues_completed}

Moving to review phase.
`.trim();

/**
 * Review continuation prompt
 *
 * Variables:
 * - {uv-completed_iterations}: Number of completed iterations
 */
export const PROJECT_CONTINUATION_REVIEW_DEFAULT = `
Continue reviewing the project.
Iterations completed: {uv-completed_iterations}

Output your review in the review-result format.
`.trim();

/**
 * Again continuation prompt
 *
 * Variables:
 * - {uv-completed_iterations}: Number of completed iterations
 */
export const PROJECT_CONTINUATION_AGAIN_DEFAULT = `
Continue addressing review findings.
Iterations completed: {uv-completed_iterations}

Work on the issues identified in the review.
`.trim();

/**
 * Complete continuation message
 *
 * Variables:
 * - {uv-project_number}: Project number
 */
export const PROJECT_CONTINUATION_COMPLETE_DEFAULT =
  `Project #{uv-project_number} is complete!`.trim();

// =============================================================================
// Iterate Mode Prompts
// =============================================================================

/**
 * Initial prompt for iterate mode
 *
 * Variables:
 * - {uv-iterations}: Number of iterations (or "unlimited")
 */
export const ITERATE_INITIAL_DEFAULT = `
You are running in autonomous development mode for {uv-iterations} iterations.

## Your Mission
1. Use the **delegate-climpt-agent** Skill to execute development tasks
2. After each task, ask Climpt for the next logical task via the Skill
3. Make continuous progress on improving the codebase

You have {uv-iterations} iterations to make meaningful contributions.
Start by assessing the current state of the project and identifying high-value tasks.
`.trim();

/**
 * Continuation prompt for iterate mode
 *
 * Variables:
 * - {uv-completed_iterations}: Number of completed iterations
 * - {uv-remaining}: Number of remaining iterations (or "unlimited")
 * - {remaining_text}: Description of remaining iterations
 * - {summary_section}: Previous iteration summary
 */
export const ITERATE_CONTINUATION_DEFAULT = `
You are continuing in autonomous development mode.
You have completed {uv-completed_iterations} iteration(s). {remaining_text}

{summary_section}

## Your Mission
1. Review the Previous Iteration Summary above to understand what was accomplished
2. Based on the summary, identify the next high-value task to tackle
3. Use the **delegate-climpt-agent** Skill to execute the next development task
4. Make continuous progress on improving the codebase

**Next Step**: Analyze the summary above and determine the most logical next action to take.
`.trim();

// =============================================================================
// Fallback Provider
// =============================================================================

/**
 * All fallback prompts indexed by key
 */
export const FALLBACK_PROMPTS: Record<string, string> = {
  // Issue mode
  "issue_initial_default": ISSUE_INITIAL_DEFAULT,
  "issue_continuation_default": ISSUE_CONTINUATION_DEFAULT,
  "section_project_context_default": SECTION_PROJECT_CONTEXT_DEFAULT,

  // Project mode
  "project_preparation_default": PROJECT_PREPARATION_DEFAULT,
  "project_preparation_no_issues_default":
    PROJECT_PREPARATION_NO_ISSUES_DEFAULT,
  "project_processing_empty_default": PROJECT_PROCESSING_EMPTY_DEFAULT,
  "project_review_default": PROJECT_REVIEW_DEFAULT,
  "project_again_default": PROJECT_AGAIN_DEFAULT,
  "project_complete_default": PROJECT_COMPLETE_DEFAULT,
  "project_continuation_preparation_default":
    PROJECT_CONTINUATION_PREPARATION_DEFAULT,
  "project_continuation_processing_done_default":
    PROJECT_CONTINUATION_PROCESSING_DONE_DEFAULT,
  "project_continuation_review_default": PROJECT_CONTINUATION_REVIEW_DEFAULT,
  "project_continuation_again_default": PROJECT_CONTINUATION_AGAIN_DEFAULT,
  "project_continuation_complete_default":
    PROJECT_CONTINUATION_COMPLETE_DEFAULT,

  // Iterate mode
  "iterate_initial_default": ITERATE_INITIAL_DEFAULT,
  "iterate_continuation_default": ITERATE_CONTINUATION_DEFAULT,
};

/**
 * Create fallback prompt provider for iterator agent
 *
 * @returns FallbackPromptProvider instance
 */
export function createIteratorFallbackProvider(): FallbackPromptProvider {
  return {
    getPrompt(key: string): string | undefined {
      return FALLBACK_PROMPTS[key];
    },
    hasPrompt(key: string): boolean {
      return key in FALLBACK_PROMPTS;
    },
  };
}
