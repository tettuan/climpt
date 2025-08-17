#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

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

// 設定ファイルから利用可能な設定を読み込み
let AVAILABLE_CONFIGS: string[] = [];

try {
  const configPath = new URL(
    "../../.agent/climpt/registry.json",
    import.meta.url,
  );
  const configText = await Deno.readTextFile(configPath);
  const config = JSON.parse(configText);
  AVAILABLE_CONFIGS = config.tools?.availableConfigs || [];
  console.error(
    `⚙️ Loaded ${AVAILABLE_CONFIGS.length} configs from external file:`,
    AVAILABLE_CONFIGS,
  );
} catch (error) {
  console.error("⚠️ Failed to load config file, using defaults:", error);
  AVAILABLE_CONFIGS = ["code", "docs", "git", "meta", "spec", "test"];
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

// プロンプト一覧を返す
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

// プロンプトの実行
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

    return {
      description: `climpt ${name} プロンプト`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: input,
          },
        },
      ],
    };
  },
);

// ツール一覧を返す
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

// ツールの実行
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

// MCP サーバーを起動
async function main() {
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
