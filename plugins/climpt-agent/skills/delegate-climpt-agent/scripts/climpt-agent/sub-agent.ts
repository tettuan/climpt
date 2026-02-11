// deno-lint-ignore-file prefer-ascii no-await-in-loop
/**
 * @fileoverview Sub-agent execution for Climpt Agent
 * @module climpt-plugins/skills/delegate-climpt-agent/scripts/sub-agent
 */

import { query } from "npm:@anthropic-ai/claude-agent-sdk@^0.2.39";
import type {
  Options,
  SDKMessage,
} from "npm:@anthropic-ai/claude-agent-sdk@^0.2.39";

import type { Logger } from "./logger.ts";
import { resolvePluginPathsSafe } from "../../../../lib/plugin-resolver.ts";

/**
 * Run Claude Agent SDK with the obtained prompt
 *
 * Note: When running from Claude Code's sandbox, the parent sandbox restrictions
 * are inherited. The SDK's sandbox option only controls the child's command execution,
 * not the parent sandbox. To run this script from Claude Code, you must use:
 *   Bash tool with dangerouslyDisableSandbox: true
 */
export async function runSubAgent(
  agentName: string,
  prompt: string,
  cwd: string,
  logger: Logger,
): Promise<void> {
  // Resolve dynamic plugins from settings
  const dynamicPlugins = await resolvePluginPathsSafe(
    cwd,
    async (error: Error, message: string) => {
      await logger.writeError(`${message}: ${error.message}`);
    },
  );

  if (dynamicPlugins.length > 0) {
    await logger.write(
      `Dynamic plugins resolved: ${
        dynamicPlugins.map((p) => p.path).join(", ")
      }`,
    );
  }

  const options: Options = {
    // model: 省略 = 親エージェントから継承（意図的）
    cwd,
    settingSources: ["project"],
    allowedTools: [
      "Skill",
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "Task",
    ],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
    },
    plugins: dynamicPlugins.length > 0 ? dynamicPlugins : undefined,
  };

  await logger.write(`Starting sub-agent: ${agentName}`);

  const queryResult = query({
    prompt,
    options,
  });

  // Check if SDK JSON errors should be strictly handled
  // Set STRICT_SDK_JSON=1 to throw on JSON parse errors instead of ignoring
  const strictJsonMode = Deno.env.get("STRICT_SDK_JSON") === "1";

  try {
    for await (const message of queryResult) {
      try {
        await handleMessage(message, logger);
      } catch (error) {
        // SDK may emit malformed JSON during message handling
        if (error instanceof SyntaxError && error.message.includes("JSON")) {
          await logger.writeError(
            `SDK JSON parse warning in handler: ${error.message}`,
          );
          if (strictJsonMode) {
            throw error;
          }
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    // SDK may emit malformed JSON during streaming iteration (typically at stream end)
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      await logger.writeError(
        `SDK JSON parse error in stream (task may have completed): ${error.message}`,
      );
      if (strictJsonMode) {
        throw error;
      }
      return;
    }
    throw error;
  }
}

/**
 * Handle SDK message types
 *
 * SDKMessage types per SDK documentation:
 * - assistant: Model response with content blocks
 * - result: Task completion (success/error)
 * - system: Initialization info
 * - user: User message echo (ignored)
 * - tool_use: Tool invocation
 * - tool_result: Tool execution result
 * - stream_event: Partial streaming data (ignored)
 * - compact_boundary: Context compaction marker (ignored)
 *
 * Note: SDK type definitions may not include all message types.
 * We handle them via runtime type checking.
 *
 * @internal Exported for testing
 */
export async function handleMessage(
  message: SDKMessage,
  logger: Logger,
): Promise<void> {
  // Cast to unknown for runtime type checking of undocumented message types
  const msg = message as unknown as Record<string, unknown>;
  const msgType = msg.type as string;

  switch (msgType) {
    case "assistant": {
      const assistantMsg = message as SDKMessage & {
        message: { content?: Array<{ type: string; text?: string }> };
      };
      if (assistantMsg.message.content) {
        for (const block of assistantMsg.message.content) {
          if (block.type === "text" && block.text) {
            await logger.writeAssistant(block.text);
          }
        }
      }
      break;
    }

    case "result": {
      const resultMsg = msg as {
        subtype?: string;
        total_cost_usd?: number;
        errors?: string[];
      };
      if (resultMsg.subtype === "success") {
        await logger.writeResult("success", resultMsg.total_cost_usd);
      } else {
        const errors = resultMsg.errors ?? [];
        await logger.writeResult("error", undefined, { errors });
      }
      break;
    }

    case "system": {
      const systemMsg = msg as {
        subtype?: string;
        session_id?: string;
        model?: string;
        permissionMode?: string;
        mcp_servers?: Array<{ name: string; status: string }>;
        tools?: string[];
      };
      if (systemMsg.subtype === "init") {
        await logger.writeSystem(
          `Session: ${systemMsg.session_id}, Model: ${systemMsg.model}`,
          {
            permissionMode: systemMsg.permissionMode,
            mcp_servers: systemMsg.mcp_servers,
          },
        );
      }
      break;
    }

    case "tool_use": {
      const toolMsg = msg as {
        tool_name: string;
        tool_use_id?: string;
        input?: Record<string, unknown>;
      };
      await logger.writeToolUse({
        toolName: toolMsg.tool_name,
        toolUseId: toolMsg.tool_use_id,
        inputSummary: summarizeToolInput(toolMsg.tool_name, toolMsg.input),
      });
      break;
    }

    case "tool_result": {
      const toolResultMsg = msg as {
        tool_use_id?: string;
        is_error?: boolean;
        error_message?: string;
      };
      await logger.writeToolResult({
        toolUseId: toolResultMsg.tool_use_id,
        success: !toolResultMsg.is_error,
        errorMessage: toolResultMsg.error_message,
      });
      break;
    }

    case "user":
      // User message echo - no action needed
      break;

    default:
      // Handle unknown/new message types gracefully
      break;
  }
}

/**
 * Summarize tool input for logging (privacy-aware)
 */
function summarizeToolInput(
  toolName: string,
  input?: Record<string, unknown>,
): string {
  if (!input) return "";

  switch (toolName) {
    case "Read":
      return `file_path: ${input.file_path}`;
    case "Write":
      return `file_path: ${input.file_path}, content: ${
        String(input.content || "").length
      } chars`;
    case "Edit":
      return `file_path: ${input.file_path}`;
    case "Bash":
      return `command: ${String(input.command || "").substring(0, 100)}...`;
    case "Glob":
      return `pattern: ${input.pattern}`;
    case "Grep":
      return `pattern: ${input.pattern}, path: ${input.path || "."}`;
    case "Skill":
      return `skill: ${input.skill}${
        input.args ? `, args: ${input.args}` : ""
      }`;
    case "Task":
      return `subagent: ${input.subagent_type}, desc: ${input.description}`;
    default:
      return JSON.stringify(input).substring(0, 200);
  }
}
