#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
// deno-lint-ignore-file no-console prefer-ascii explicit-function-return-type

import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import {
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types";

async function testMCPServer() {
  console.log("Starting MCP Server test...\n");

  // MCPサーバーを起動
  const transport = new StdioClientTransport({
    command: "deno",
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "--allow-env",
      "./src/mcp/index.ts",
    ],
  });

  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  try {
    await client.connect(transport);
    console.log("✅ Connected to MCP Server\n");

    // プロンプト一覧を取得
    console.log("📋 Getting prompts list...");
    const promptsResponse = await client.request({
      method: "prompts/list",
      params: {},
    }, ListPromptsResultSchema);
    console.log("Available prompts:", JSON.stringify(promptsResponse, null, 2));
    console.log();

    // プロンプトを実行
    console.log("🚀 Testing 'project' prompt...");
    const projectPrompt = await client.request({
      method: "prompts/get",
      params: {
        name: "project",
        arguments: {
          input: "ECサイトを作りたい",
          outputFormat: "markdown",
        },
      },
    }, GetPromptResultSchema);
    console.log(
      "Project prompt result:",
      JSON.stringify(projectPrompt, null, 2),
    );
    console.log();

    // ツール一覧を取得
    console.log("🔧 Getting tools list...");
    const toolsResponse = await client.request({
      method: "tools/list",
      params: {},
    }, ListToolsResultSchema);
    console.log("Available tools:", JSON.stringify(toolsResponse, null, 2));
    console.log();

    console.log("✅ All tests passed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await transport.close();
  }
}

if (import.meta.main) {
  await testMCPServer();
}
