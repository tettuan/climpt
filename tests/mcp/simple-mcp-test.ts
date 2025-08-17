#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import { Server } from "npm:@modelcontextprotocol/sdk@0.7.0/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@0.7.0/server/stdio.js";
import { 
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type ListToolsRequest,
  type CallToolRequest,
} from "npm:@modelcontextprotocol/sdk@0.7.0/types.js";

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
server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => {
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
});

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
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