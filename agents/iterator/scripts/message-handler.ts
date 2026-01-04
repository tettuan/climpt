/**
 * Message Handler - SDK Message Processing
 *
 * Handles extraction and logging of Claude Agent SDK messages.
 */

import type { Logger } from "./logger.ts";
import { summarizeToolInput } from "./logger.ts";
import type {
  IssueAction,
  IssueActionParseResult,
  IterationSummary,
  ProjectPlan,
  ReviewResult,
  SDKResultStats,
} from "./types.ts";

/**
 * Check if message contains Skill invocation
 *
 * @param message - SDK message to check
 * @returns true if message contains delegate-climpt-agent Skill invocation
 */
// deno-lint-ignore no-explicit-any
export function isSkillInvocation(message: any): boolean {
  if (!message.message?.content) return false;

  const content = Array.isArray(message.message.content)
    ? message.message.content
    : [message.message.content];

  // deno-lint-ignore no-explicit-any
  return content.some((block: any) =>
    block.type === "tool_use" &&
    block.name === "Skill" &&
    block.input?.skill === "climpt-agent:delegate-climpt-agent"
  );
}

/**
 * Extract meaningful data from SDK message for iteration summary
 *
 * Captures:
 * - session_id from init messages
 * - assistant text responses
 * - tool names used
 * - final results
 * - errors from tool results
 *
 * @param message - SDK message to process
 * @param summary - Iteration summary to update
 */
export function captureIterationData(
  // deno-lint-ignore no-explicit-any
  message: any,
  summary: IterationSummary,
): void {
  // Capture session_id from init message
  if (
    message.type === "system" && message.subtype === "init" &&
    message.session_id
  ) {
    summary.sessionId = message.session_id;
  }

  // Capture assistant text responses and tool uses
  if (message.message?.role === "assistant") {
    const content = message.message.content;
    const blocks = Array.isArray(content) ? content : [];

    // Extract text blocks
    // deno-lint-ignore no-explicit-any
    const textBlocks = blocks.filter((b: any) => b.type === "text");
    // deno-lint-ignore no-explicit-any
    const text = textBlocks.map((b: any) => b.text).join("\n").trim();
    if (text && text.length > 0) {
      summary.assistantResponses.push(text);
    }

    // Extract tool uses (unique tool names only)
    // deno-lint-ignore no-explicit-any
    const toolUses = blocks.filter((b: any) => b.type === "tool_use");
    for (const tool of toolUses) {
      if (tool.name && !summary.toolsUsed.includes(tool.name)) {
        summary.toolsUsed.push(tool.name);
      }
    }
  }

  // Capture final result
  if (message.type === "result") {
    summary.finalResult = message.result || undefined;
  }

  // Capture errors from tool results
  if (message.message?.role === "user") {
    const content = message.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result" && block.is_error) {
          summary.errors.push(String(block.content || "Unknown error"));
        }
      }
    }
  }
}

/**
 * Log SDK message with appropriate log level
 *
 * Maps message types to log levels:
 * - result: "result" level
 * - assistant message: "assistant" level (text content extracted)
 * - user message: "user" level
 * - other: "system" level
 *
 * @param message - SDK message to log
 * @param logger - Logger instance
 */
export async function logSDKMessage(
  // deno-lint-ignore no-explicit-any
  message: any,
  logger: Logger,
): Promise<void> {
  // Remove apiKeySource from message before logging
  const sanitizedMessage = { ...message };
  if (sanitizedMessage.apiKeySource !== undefined) {
    delete sanitizedMessage.apiKeySource;
  }

  // Log raw message for debugging
  await logger.write("debug", "Raw SDK message", {
    rawMessage: JSON.stringify(sanitizedMessage, null, 2),
    messageType: message.type,
    messageRole: message.message?.role,
  });

  // Determine message type and extract content
  if (message.type === "result") {
    await logger.write("result", message.result || "(empty result)");
  } else if (message.message?.role === "assistant") {
    // Extract text content from assistant message
    const content = message.message.content;
    const blocks = Array.isArray(content) ? content : [];

    // Log tool_use blocks (for Guimpt statistics)
    // deno-lint-ignore no-explicit-any
    const toolUseBlocks = blocks.filter((b: any) => b.type === "tool_use");
    for (const toolUse of toolUseBlocks) {
      const inputSummary = summarizeToolInput(
        toolUse.name,
        toolUse.input || {},
      );
      await logger.logToolUse({
        toolName: toolUse.name,
        toolUseId: toolUse.id,
        inputSummary,
      });
    }

    // Log text content
    // deno-lint-ignore no-explicit-any
    const textBlocks = blocks.filter((b: any) => b.type === "text");
    // deno-lint-ignore no-explicit-any
    const text = textBlocks.map((b: any) => b.text).join("\n");

    if (text) {
      await logger.write("assistant", text);
    }
  } else if (message.message?.role === "user") {
    const content = message.message.content;

    // Log tool_result blocks (for Guimpt statistics)
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result") {
          await logger.logToolResult({
            toolUseId: block.tool_use_id,
            success: !block.is_error,
            errorMessage: block.is_error ? String(block.content || "") : undefined,
          });
        }
      }
    }

    // Log user message content
    const contentStr = typeof content === "string"
      ? content
      : JSON.stringify(content);
    await logger.write("user", contentStr);
  } else {
    // Generic system message (with apiKeySource removed)
    await logger.write("system", JSON.stringify(sanitizedMessage));
  }
}

/**
 * Capture SDK result statistics from a result message
 *
 * Extracts performance metrics and token usage from the SDK result message.
 *
 * @param message - SDK message to process
 * @returns SDKResultStats if message is a result message, null otherwise
 */
export function captureSDKResult(
  // deno-lint-ignore no-explicit-any
  message: any,
): SDKResultStats | null {
  if (message.type !== "result") {
    return null;
  }

  // Extract model usage from the message
  const modelUsage: SDKResultStats["modelUsage"] = {};

  if (message.modelUsage) {
    for (const [modelName, usage] of Object.entries(message.modelUsage)) {
      // deno-lint-ignore no-explicit-any
      const u = usage as any;
      modelUsage[modelName] = {
        inputTokens: u.input_tokens ?? u.inputTokens ?? 0,
        outputTokens: u.output_tokens ?? u.outputTokens ?? 0,
        cacheCreationInputTokens: u.cache_creation_input_tokens ??
          u.cacheCreationInputTokens,
        cacheReadInputTokens: u.cache_read_input_tokens ??
          u.cacheReadInputTokens,
        cost: u.cost,
      };
    }
  }

  return {
    durationMs: message.duration_ms ?? 0,
    durationApiMs: message.duration_api_ms ?? 0,
    numTurns: message.num_turns ?? 0,
    totalCostUsd: message.total_cost_usd ?? 0,
    modelUsage,
  };
}

// ============================================================
// Issue Action
// ============================================================

/**
 * Issue action format marker
 */
const ISSUE_ACTION_MARKER = "issue-action";

/**
 * Valid action types
 */
const VALID_ACTION_TYPES = ["progress", "question", "blocked", "close"] as const;

/**
 * Extract issue-action JSON block from text
 *
 * Looks for markdown code block with `issue-action` language tag:
 * ```issue-action
 * {"action":"progress","issue":1,"body":"..."}
 * ```
 *
 * @param text - Text to search for action block
 * @returns Extracted JSON string or null if not found
 */
export function extractIssueActionBlock(text: string): string | null {
  // Pattern: ```issue-action\n{...}\n```
  const pattern = new RegExp(
    "```" + ISSUE_ACTION_MARKER + "\\s*\\n([\\s\\S]*?)\\n```",
    "m",
  );
  const match = text.match(pattern);

  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
}

/**
 * Extract all issue-action JSON blocks from text
 *
 * @param text - Text to search for action blocks
 * @returns Array of extracted JSON strings
 */
export function extractAllIssueActionBlocks(text: string): string[] {
  const pattern = new RegExp(
    "```" + ISSUE_ACTION_MARKER + "\\s*\\n([\\s\\S]*?)\\n```",
    "gm",
  );
  const matches = text.matchAll(pattern);
  const results: string[] = [];

  for (const match of matches) {
    if (match[1]) {
      results.push(match[1].trim());
    }
  }

  return results;
}

/**
 * Parse and validate issue action JSON
 *
 * @param jsonString - JSON string to parse
 * @returns Parse result with success/error status
 */
export function parseIssueAction(
  jsonString: string,
): IssueActionParseResult {
  try {
    const parsed = JSON.parse(jsonString);

    // Validate action field
    if (!VALID_ACTION_TYPES.includes(parsed.action)) {
      return {
        success: false,
        error: `Invalid 'action' field: expected one of ${VALID_ACTION_TYPES.join(", ")}, got "${parsed.action}"`,
        rawContent: jsonString,
      };
    }

    // Validate issue field
    if (typeof parsed.issue !== "number") {
      return {
        success: false,
        error: `Invalid or missing 'issue' field: expected number, got ${typeof parsed.issue}`,
        rawContent: jsonString,
      };
    }

    // Validate body field
    if (typeof parsed.body !== "string") {
      return {
        success: false,
        error: `Invalid or missing 'body' field: expected string, got ${typeof parsed.body}`,
        rawContent: jsonString,
      };
    }

    // Validate optional label field
    if (parsed.label !== undefined && typeof parsed.label !== "string") {
      return {
        success: false,
        error: `Invalid 'label' field: expected string, got ${typeof parsed.label}`,
        rawContent: jsonString,
      };
    }

    const action: IssueAction = {
      action: parsed.action,
      issue: parsed.issue,
      body: parsed.body,
      label: parsed.label,
    };

    return {
      success: true,
      action,
    };
  } catch (e) {
    return {
      success: false,
      error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      rawContent: jsonString,
    };
  }
}

/**
 * Detect and parse all issue actions from assistant message
 *
 * @param message - SDK message to check
 * @returns Array of parse results (may include failures)
 */
export function detectIssueActions(
  // deno-lint-ignore no-explicit-any
  message: any,
): IssueActionParseResult[] {
  // Only check assistant messages
  if (message.message?.role !== "assistant") {
    return [];
  }

  const content = message.message.content;
  const blocks = Array.isArray(content) ? content : [];

  // Extract text from all text blocks
  // deno-lint-ignore no-explicit-any
  const textBlocks = blocks.filter((b: any) => b.type === "text");
  // deno-lint-ignore no-explicit-any
  const fullText = textBlocks.map((b: any) => b.text).join("\n");

  // Extract all action blocks
  const jsonBlocks = extractAllIssueActionBlocks(fullText);
  if (jsonBlocks.length === 0) {
    return [];
  }

  // Parse each block
  return jsonBlocks.map(parseIssueAction);
}

/**
 * Build retry prompt for malformed issue action
 *
 * @param parseResult - Failed parse result
 * @param expectedIssue - Expected issue number
 * @returns Prompt to send back to LLM for correction
 */
export function buildIssueActionRetryPrompt(
  parseResult: IssueActionParseResult,
  expectedIssue: number,
): string {
  return `
Your issue action could not be parsed.

## Error
${parseResult.error}

## Your Output
\`\`\`
${parseResult.rawContent || "(empty)"}
\`\`\`

## Required Format
Please output the action in this exact format:

\`\`\`issue-action
{"action":"<type>","issue":${expectedIssue},"body":"Description or comment content"}
\`\`\`

Action types:
- "progress": Report work progress
- "question": Ask a question
- "blocked": Report a blocker (can include "label" field)
- "close": Mark issue as complete

Requirements:
- Use the \`issue-action\` code block marker
- JSON must have "action", "issue" (number), and "body" (string) fields
- Issue number must be ${expectedIssue}

Please output ONLY the corrected action block.
`.trim();
}

// ============================================================
// Project Plan and Review Result Parsing
// ============================================================

/**
 * Project plan format marker
 */
const PROJECT_PLAN_MARKER = "project-plan";

/**
 * Review result format marker
 */
const REVIEW_RESULT_MARKER = "review-result";

/**
 * Extract a JSON block with the specified marker from text
 *
 * @param text - Text to search
 * @param marker - Block marker (e.g., "project-plan", "review-result")
 * @returns Extracted JSON string or null if not found
 */
export function extractJsonBlock(text: string, marker: string): string | null {
  const pattern = new RegExp("```" + marker + "\\s*\\n([\\s\\S]*?)\\n```", "m");
  const match = text.match(pattern);
  if (!match || !match[1]) {
    return null;
  }
  return match[1].trim();
}

/**
 * Parse result for project plan
 */
export interface ProjectPlanParseResult {
  success: boolean;
  plan?: ProjectPlan;
  error?: string;
  rawContent?: string;
}

/**
 * Parse and validate project plan JSON
 *
 * @param jsonString - JSON string to parse
 * @returns Parse result with success/error status
 */
export function parseProjectPlan(jsonString: string): ProjectPlanParseResult {
  try {
    const parsed = JSON.parse(jsonString);

    // Validate required fields
    if (typeof parsed.totalIssues !== "number") {
      return {
        success: false,
        error: `Invalid 'totalIssues': expected number, got ${typeof parsed.totalIssues}`,
        rawContent: jsonString,
      };
    }

    if (!["low", "medium", "high"].includes(parsed.estimatedComplexity)) {
      return {
        success: false,
        error: `Invalid 'estimatedComplexity': expected low|medium|high, got "${parsed.estimatedComplexity}"`,
        rawContent: jsonString,
      };
    }

    if (!Array.isArray(parsed.skillsNeeded)) {
      return {
        success: false,
        error: `Invalid 'skillsNeeded': expected array, got ${typeof parsed.skillsNeeded}`,
        rawContent: jsonString,
      };
    }

    if (!Array.isArray(parsed.skillsToDisable)) {
      return {
        success: false,
        error: `Invalid 'skillsToDisable': expected array, got ${typeof parsed.skillsToDisable}`,
        rawContent: jsonString,
      };
    }

    if (!Array.isArray(parsed.executionOrder)) {
      return {
        success: false,
        error: `Invalid 'executionOrder': expected array, got ${typeof parsed.executionOrder}`,
        rawContent: jsonString,
      };
    }

    const plan: ProjectPlan = {
      totalIssues: parsed.totalIssues,
      estimatedComplexity: parsed.estimatedComplexity,
      skillsNeeded: parsed.skillsNeeded,
      skillsToDisable: parsed.skillsToDisable,
      executionOrder: parsed.executionOrder,
      notes: parsed.notes,
    };

    return { success: true, plan };
  } catch (e) {
    return {
      success: false,
      error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      rawContent: jsonString,
    };
  }
}

/**
 * Parse result for review result
 */
export interface ReviewResultParseResult {
  success: boolean;
  result?: ReviewResult;
  error?: string;
  rawContent?: string;
}

/**
 * Parse and validate review result JSON
 *
 * @param jsonString - JSON string to parse
 * @returns Parse result with success/error status
 */
export function parseReviewResult(jsonString: string): ReviewResultParseResult {
  try {
    const parsed = JSON.parse(jsonString);

    // Validate result field
    if (!["pass", "fail"].includes(parsed.result)) {
      return {
        success: false,
        error: `Invalid 'result': expected pass|fail, got "${parsed.result}"`,
        rawContent: jsonString,
      };
    }

    // Validate summary field
    if (typeof parsed.summary !== "string") {
      return {
        success: false,
        error: `Invalid 'summary': expected string, got ${typeof parsed.summary}`,
        rawContent: jsonString,
      };
    }

    const result: ReviewResult = {
      result: parsed.result,
      summary: parsed.summary,
      details: parsed.details,
      issues: parsed.issues,
    };

    return { success: true, result };
  } catch (e) {
    return {
      success: false,
      error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      rawContent: jsonString,
    };
  }
}

/**
 * Detect and parse project plan from assistant message
 *
 * @param message - SDK message to check
 * @returns Parse result or null if no project-plan block found
 */
export function detectProjectPlan(
  // deno-lint-ignore no-explicit-any
  message: any,
): ProjectPlanParseResult | null {
  if (message.message?.role !== "assistant") {
    return null;
  }

  const content = message.message.content;
  const blocks = Array.isArray(content) ? content : [];

  // deno-lint-ignore no-explicit-any
  const textBlocks = blocks.filter((b: any) => b.type === "text");
  // deno-lint-ignore no-explicit-any
  const fullText = textBlocks.map((b: any) => b.text).join("\n");

  const jsonBlock = extractJsonBlock(fullText, PROJECT_PLAN_MARKER);
  if (!jsonBlock) {
    return null;
  }

  return parseProjectPlan(jsonBlock);
}

/**
 * Detect and parse review result from assistant message
 *
 * @param message - SDK message to check
 * @returns Parse result or null if no review-result block found
 */
export function detectReviewResult(
  // deno-lint-ignore no-explicit-any
  message: any,
): ReviewResultParseResult | null {
  if (message.message?.role !== "assistant") {
    return null;
  }

  const content = message.message.content;
  const blocks = Array.isArray(content) ? content : [];

  // deno-lint-ignore no-explicit-any
  const textBlocks = blocks.filter((b: any) => b.type === "text");
  // deno-lint-ignore no-explicit-any
  const fullText = textBlocks.map((b: any) => b.text).join("\n");

  const jsonBlock = extractJsonBlock(fullText, REVIEW_RESULT_MARKER);
  if (!jsonBlock) {
    return null;
  }

  return parseReviewResult(jsonBlock);
}
