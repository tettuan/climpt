/**
 * Message Handler - SDK Message Processing
 *
 * Handles extraction and logging of Claude Agent SDK messages.
 */

import type { Logger } from "./logger.ts";
import type { IterationSummary, SDKResultStats } from "./types.ts";

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
    const textBlocks = Array.isArray(content)
      // deno-lint-ignore no-explicit-any
      ? content.filter((b: any) => b.type === "text")
      : [];
    // deno-lint-ignore no-explicit-any
    const text = textBlocks.map((b: any) => b.text).join("\n");

    if (text) {
      await logger.write("assistant", text);
    }
  } else if (message.message?.role === "user") {
    const content = typeof message.message.content === "string"
      ? message.message.content
      : JSON.stringify(message.message.content);
    await logger.write("user", content);
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
