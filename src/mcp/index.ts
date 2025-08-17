#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * @fileoverview MCP Server implementation for Climpt
 *
 * This module implements a Model Context Protocol (MCP) server that provides
 * AI assistants with access to Climpt's command registry and execution capabilities.
 * The server dynamically loads tool configurations from a registry file and
 * exposes them as both prompts and tools through the MCP protocol.
 *
 * @module mcp/index
 */

import { Server } from "npm:@modelcontextprotocol/sdk@0.7.0/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@0.7.0/server/stdio.js";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  type GetPromptRequest,
  GetPromptRequestSchema,
  type ListPromptsRequest,
  ListPromptsRequestSchema,
  type ListToolsRequest,
  ListToolsRequestSchema,
} from "npm:@modelcontextprotocol/sdk@0.7.0/types.js";
import { CLIMPT_VERSION } from "../version.ts";

console.error("🚀 MCP Server starting...");
console.error(`📦 Climpt version: ${CLIMPT_VERSION}`);

/**
 * Available tool configurations loaded from registry.json.
 * Defaults to standard configs if registry file is not found.
 *
 * @type {string[]}
 */
let AVAILABLE_CONFIGS: string[] = [];

/**
 * Valid commands loaded from registry.json.
 * Used for command validation.
 *
 * @type {Array<{c1: string, c2: string, c3: string}>}
 */
let VALID_COMMANDS: Array<{ c1: string; c2: string; c3: string }> = [];

try {
  // Try to load config from current working directory first
  let configPath = ".agent/climpt/registry.json";
  let configText: string;

  try {
    configText = await Deno.readTextFile(configPath);
  } catch {
    // If not found in current directory, try user's home directory
    const homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
    configPath = `${homeDir}/.agent/climpt/registry.json`;
    configText = await Deno.readTextFile(configPath);
  }

  const config = JSON.parse(configText);
  AVAILABLE_CONFIGS = config.tools?.availableConfigs || [];
  VALID_COMMANDS = config.tools?.commands || [];
  console.error(
    `⚙️ Loaded ${AVAILABLE_CONFIGS.length} configs and ${VALID_COMMANDS.length} commands from ${configPath}:`,
    AVAILABLE_CONFIGS,
  );
} catch (error) {
  console.error("⚠️ Failed to load config file, using defaults:", error);
  AVAILABLE_CONFIGS = ["code", "docs", "git", "meta", "spec", "test"];
  VALID_COMMANDS = [];
}

/**
 * Validates if a command is available in the registry.
 *
 * @param {string} config - The configuration name (c1)
 * @param {string[]} args - The command arguments to validate
 * @returns {boolean} True if command is valid, false otherwise
 */
function validateCommand(config: string, args: string[]): boolean {
  if (VALID_COMMANDS.length === 0) {
    // If no commands loaded, allow all for backward compatibility
    return true;
  }

  if (args.length < 2) {
    return false;
  }

  const [c2, c3] = args;
  return VALID_COMMANDS.some((cmd) =>
    cmd.c1 === config && cmd.c2 === c2 && cmd.c3 === c3
  );
}

const server = new Server(
  {
    name: "climpt-mcp",
    version: CLIMPT_VERSION,
  },
  {
    capabilities: {
      prompts: {},
      tools: {},
    },
  },
);

/**
 * Handler for listing available prompts.
 * Returns a list of prompts based on available configurations.
 *
 * @param {ListPromptsRequest} _request - The request for listing prompts
 * @returns {Object} Object containing array of prompt definitions
 */
server.setRequestHandler(
  ListPromptsRequestSchema,
  (_request: ListPromptsRequest) => {
    console.error("📋 ListPromptsRequest received");
    const prompts = AVAILABLE_CONFIGS.map((config) => ({
      name: config,
      description: `climpt ${config} プロンプト`,
      arguments: [
        {
          name: "input",
          description: "入力内容",
          required: true,
        },
      ],
    }));

    return { prompts };
  },
);

/**
 * Handler for executing a specific prompt.
 * Retrieves and executes the prompt with the given name and arguments.
 *
 * @param {GetPromptRequest} request - The request containing prompt name and arguments
 * @returns {Object} Object containing prompt description and messages
 * @throws {Error} If the requested prompt is not in available configurations
 */
server.setRequestHandler(
  GetPromptRequestSchema,
  (request: GetPromptRequest) => {
    const { name, arguments: args } = request.params;
    console.error(`🎯 GetPromptRequest received for: ${name}`);

    // 利用可能な設定かチェック
    if (!AVAILABLE_CONFIGS.includes(name)) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    const input = args?.input || "";

    // 空のinputの場合はデフォルトメッセージを使用
    const promptText = input.trim() ||
      `Please help me with ${name} related tasks.`;

    // Ensure promptText is never empty to prevent API errors
    if (!promptText.trim()) {
      throw new Error("Prompt text cannot be empty after processing");
    }

    return {
      description: `climpt ${name} プロンプト`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: promptText,
          },
        },
      ],
    };
  },
);

/**
 * Handler for listing available tools.
 * Returns a list of tools based on available configurations.
 *
 * @param {ListToolsRequest} _request - The request for listing tools
 * @returns {Object} Object containing array of tool definitions with schemas
 */
server.setRequestHandler(
  ListToolsRequestSchema,
  (_request: ListToolsRequest) => {
    console.error("🔧 ListToolsRequest received");

    const tools = AVAILABLE_CONFIGS.map((config) => ({
      name: config,
      description: `climpt ${config} コマンドを実行 (--config=${config})`,
      inputSchema: {
        type: "object",
        properties: {
          args: {
            type: "array",
            items: {
              type: "string",
            },
            description: `${config}コマンドの引数`,
          },
        },
        required: ["args"],
      },
    }));

    return { tools };
  },
);

/**
 * Handler for executing a tool.
 * Runs the specified Climpt command with the provided arguments.
 *
 * @param {CallToolRequest} request - The request containing tool name and arguments
 * @returns {Promise<Object>} Promise resolving to tool execution result
 * @throws {Error} If the requested tool is not in available configurations
 */
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    console.error(`⚡ CallToolRequest received for: ${name}`);

    // 利用可能な設定かチェック
    if (!AVAILABLE_CONFIGS.includes(name)) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const { args: commandArgs } = args as {
      args: string[];
    };

    // コマンドバリデーション
    if (!validateCommand(name, commandArgs)) {
      const availableCommands = VALID_COMMANDS
        .filter((cmd) => cmd.c1 === name)
        .map((cmd) => `${cmd.c2} ${cmd.c3}`)
        .join(", ");

      throw new Error(
        `Invalid command: ${
          commandArgs.join(" ")
        }. Available commands for ${name}: ${availableCommands}`,
      );
    }

    // 汎用的なclimptコマンド実行
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        "--allow-net",
        "--no-config",
        "jsr:@aidevtool/climpt",
        `--config=${name}`,
        ...commandArgs,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();
    const outputText = new TextDecoder().decode(output.stdout);
    const errorText = new TextDecoder().decode(output.stderr);

    if (!output.success) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing climpt ${name}: ${errorText}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: outputText,
        },
      ],
    };
  },
);

/**
 * Main function to start the MCP server.
 * Initializes the stdio transport and connects the server.
 *
 * @returns {Promise<void>} Promise that resolves when server is connected
 * @example
 * ```typescript
 * import main from "./mcp/index.ts";
 * await main();
 * ```
 */
async function main(): Promise<void> {
  console.error("🔌 Connecting to StdioServerTransport...");
  const transport = new StdioServerTransport();
  console.error("✅ Transport created, connecting server...");
  await server.connect(transport);
  console.error("🎉 MCP Server connected and ready!");
}

// Export main function for programmatic use
export default main;

if (import.meta.main) {
  console.error("📝 Script is main module, starting server...");
  main().catch((error) => {
    console.error("❌ Server error:", error);
    Deno.exit(1);
  });
}
