/**
 * Iterate Agent - System Prompt Builder
 *
 * Builds system prompts with variable substitution.
 *
 * Note: Initial and continuation prompts are now handled by CompletionHandler
 * implementations in the completion/ directory.
 */

import type { CompletionHandler } from "./completion/mod.ts";

/**
 * Build system prompt from template with variable substitution
 *
 * Replaces template variables:
 * - {{AGENT}} - Agent name
 * - {{COMPLETION_CRITERIA}} - Short completion criteria description
 * - {{COMPLETION_CRITERIA_DETAIL}} - Detailed completion criteria description
 *
 * @param templateContent - Raw template content
 * @param handler - Completion handler providing criteria
 * @param agentName - Agent name for substitution
 * @returns Processed system prompt
 */
export function buildSystemPrompt(
  templateContent: string,
  handler: CompletionHandler,
  agentName: string,
): string {
  const { criteria, detail } = handler.buildCompletionCriteria();

  return templateContent
    .replace(/\{\{AGENT\}\}/g, agentName)
    .replace(/\{\{COMPLETION_CRITERIA\}\}/g, criteria)
    .replace(/\{\{COMPLETION_CRITERIA_DETAIL\}\}/g, detail);
}
