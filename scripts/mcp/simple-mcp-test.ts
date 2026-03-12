#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
// deno-lint-ignore-file no-console prefer-ascii explicit-function-return-type

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  type ListToolsRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types";

console.error("🧪 Simple MCP Test Server starting...");

const server = new Server(
  {
    name: "simple-test",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Simple ping tool
server.setRequestHandler(
  ListToolsRequestSchema,
  (_request: ListToolsRequest) => {
    console.error("📋 ListToolsRequest received");
    return {
      tools: [
        {
          name: "ping",
          description: "Simple ping test",
          inputSchema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "Message to echo back",
              },
            },
            required: ["message"],
          },
        },
      ],
    };
  },
);

server.setRequestHandler(CallToolRequestSchema, (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;
  console.error(`🔧 CallToolRequest received for: ${name}`);
  console.error(`📥 Arguments:`, JSON.stringify(args));

  if (name === "ping") {
    const { message } = args as { message: string };
    return {
      content: [
        {
          type: "text",
          text: `Pong! You said: ${message}`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  console.error("🔌 Connecting to StdioServerTransport...");
  const transport = new StdioServerTransport();
  console.error("✅ Transport created, connecting server...");
  await server.connect(transport);
  console.error("🎉 Simple MCP Test Server connected and ready!");
}

if (import.meta.main) {
  console.error("📝 Script is main module, starting server...");
  main().catch((error) => {
    console.error("❌ Server error:", error);
    Deno.exit(1);
  });
}
