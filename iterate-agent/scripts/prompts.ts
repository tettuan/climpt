/**
 * Iterate Agent - System Prompt Builder
 *
 * Builds system prompts and initial prompts with variable substitution.
 */

import type { AgentOptions, IterationSummary } from "./types.ts";
import { fetchIssueRequirements, fetchProjectRequirements } from "./github.ts";

/**
 * Build system prompt from template with variable substitution
 *
 * @param templateContent - Raw template content
 * @param options - Agent options
 * @returns Processed system prompt
 */
export function buildSystemPrompt(
  templateContent: string,
  options: AgentOptions,
): string {
  const { issue, project, iterateMax } = options;

  // Determine completion criteria
  let completionCriteria: string;
  let completionCriteriaDetail: string;

  if (issue !== undefined) {
    completionCriteria = `closing Issue #${issue}`;
    completionCriteriaDetail =
      `Work on Issue #${issue} until it is closed. The issue will be checked periodically; when it's marked as CLOSED, your work is complete.`;
  } else if (project !== undefined) {
    completionCriteria = `completing Project #${project}`;
    completionCriteriaDetail =
      `Work on Project #${project} until all items are complete. The project status will be checked periodically; when all items are marked as Done or Closed, your work is complete.`;
  } else {
    completionCriteria = `${iterateMax} iterations`;
    completionCriteriaDetail = `Execute ${
      iterateMax === Infinity ? "unlimited" : iterateMax
    } iterations. After each iteration, decide on the next high-value task to tackle.`;
  }

  // Replace template variables
  return templateContent
    .replace(/\{\{AGENT\}\}/g, options.agentName)
    .replace(/\{\{COMPLETION_CRITERIA\}\}/g, completionCriteria)
    .replace(/\{\{COMPLETION_CRITERIA_DETAIL\}\}/g, completionCriteriaDetail);
}

/**
 * Build initial prompt based on completion criteria
 *
 * @param options - Agent options
 * @returns Initial prompt text
 */
export async function buildInitialPrompt(
  options: AgentOptions,
): Promise<string> {
  const { issue, project, iterateMax } = options;

  if (issue !== undefined) {
    return await buildIssuePrompt(issue);
  } else if (project !== undefined) {
    return await buildProjectPrompt(project);
  } else {
    return buildIterateOnlyPrompt(iterateMax);
  }
}

/**
 * Build Issue-based initial prompt
 *
 * @param issueNumber - GitHub Issue number
 * @returns Initial prompt with issue details
 */
async function buildIssuePrompt(issueNumber: number): Promise<string> {
  const issueContent = await fetchIssueRequirements(issueNumber);

  return `
You are starting work on GitHub Issue #${issueNumber}.

## Issue Details
${issueContent}

## Your Mission
1. Use the **delegate-climpt-agent** Skill to implement the required changes
2. After each task, evaluate progress toward closing this issue
3. Continue until the issue requirements are fully satisfied
4. The issue will be checked periodically; when it's closed, you're done

Start by analyzing the issue requirements and planning your first task.
  `.trim();
}

/**
 * Build Project-based initial prompt
 *
 * @param projectNumber - GitHub Project number
 * @returns Initial prompt with project details
 */
async function buildProjectPrompt(projectNumber: number): Promise<string> {
  const projectContent = await fetchProjectRequirements(projectNumber);

  return `
You are working on GitHub Project #${projectNumber}.

## Project Overview
${projectContent}

## Your Mission
1. Use the **delegate-climpt-agent** Skill to work through project tasks
2. Focus on making continuous progress across all project items
3. After each task, ask Climpt what to do next
4. Continue until all project items are complete

Start by reviewing the project board and selecting the first task to tackle.
  `.trim();
}

/**
 * Build Iterate-only initial prompt
 *
 * @param iterateMax - Maximum iterations
 * @returns Initial prompt for iterate-only mode
 */
function buildIterateOnlyPrompt(iterateMax: number): string {
  const iterations = iterateMax === Infinity ? "unlimited" : iterateMax;

  return `
You are running in autonomous development mode for ${iterations} iterations.

## Your Mission
1. Use the **delegate-climpt-agent** Skill to execute development tasks
2. After each task, ask Climpt for the next logical task via the Skill
3. Make continuous progress on improving the codebase

You have ${iterations} iterations to make meaningful contributions.
Start by assessing the current state of the project and identifying high-value tasks.
  `.trim();
}

/**
 * Build continuation prompt for next iteration
 *
 * @param options - Agent options
 * @param completedIterations - Number of completed iterations
 * @param previousSummary - Summary of what was accomplished in previous iteration
 * @returns Continuation prompt for next iteration
 */
export function buildContinuationPrompt(
  options: AgentOptions,
  completedIterations: number,
  previousSummary?: IterationSummary,
): string {
  const { issue, project, iterateMax } = options;

  // Build summary section if previous summary exists
  const summarySection = previousSummary
    ? formatIterationSummary(previousSummary)
    : "";

  if (issue !== undefined) {
    return `
You have completed ${completedIterations} iteration(s) working on GitHub Issue #${issue}.

${summarySection}

Based on what was accomplished, identify what remains to be done and determine the next action to take.

When the issue is closed, your work is complete.
    `.trim();
  } else if (project !== undefined) {
    return `
You have completed ${completedIterations} iteration(s) working on GitHub Project #${project}.

${summarySection}

Based on what was accomplished, identify what remains across project items and determine the next action to take.

When all project items are complete, your work is done.
    `.trim();
  } else {
    const remaining = iterateMax === Infinity
      ? "unlimited"
      : iterateMax - completedIterations;

    return `
You have completed ${completedIterations} iteration(s). ${
      iterateMax === Infinity
        ? "You can continue indefinitely."
        : `You have ${remaining} iteration(s) remaining.`
    }

${summarySection}

Based on what was accomplished, identify the next high-value task and determine how to proceed.
    `.trim();
  }
}

/**
 * Format iteration summary for inclusion in prompt
 *
 * @param summary - Iteration summary to format
 * @returns Formatted markdown string
 */
function formatIterationSummary(summary: IterationSummary): string {
  const parts: string[] = [];

  parts.push(`## Previous Iteration Summary (Iteration ${summary.iteration})`);

  // Include last assistant response (most likely to contain the summary)
  if (summary.assistantResponses.length > 0) {
    const lastResponse =
      summary.assistantResponses[summary.assistantResponses.length - 1];
    // Truncate if too long (keep it concise for context efficiency)
    const truncated = lastResponse.length > 1000
      ? lastResponse.substring(0, 1000) + "..."
      : lastResponse;
    parts.push(`### What was done:\n${truncated}`);
  }

  // Tools used gives context about actions taken
  if (summary.toolsUsed.length > 0) {
    parts.push(`### Tools used: ${summary.toolsUsed.join(", ")}`);
  }

  // Report errors so next iteration can address them
  if (summary.errors.length > 0) {
    const errorSummary = summary.errors.slice(0, 3).map((e) => `- ${e}`).join(
      "\n",
    );
    parts.push(`### Errors encountered:\n${errorSummary}`);
  }

  return parts.join("\n\n");
}
