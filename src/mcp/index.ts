#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * @fileoverview MCP Server implementation for Climpt
 *
 * This module implements a Model Context Protocol (MCP) server that provides
 * AI assistants with semantic search and command discovery capabilities.
 * The server dynamically loads command definitions from a registry file and
 * provides two core tools: search (semantic similarity) and describe (detailed lookup).
 *
 * @module mcp/index
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  type ListToolsRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types";
import { CLIMPT_VERSION } from "../version.ts";
import type { Command, Registry } from "./types.ts";
import { describeCommand, searchCommands } from "./similarity.ts";

console.error("🚀 MCP Server starting...");
console.error(`📦 Climpt version: ${CLIMPT_VERSION}`);

/**
 * Valid commands loaded from registry.json.
 */
let VALID_COMMANDS: Command[] = [];

/**
 * Load registry configuration
 */
try {
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

  const config: Registry = JSON.parse(configText);
  VALID_COMMANDS = config.tools?.commands || [];
  console.error(
    `⚙️ Loaded ${VALID_COMMANDS.length} commands from ${configPath}`,
  );
} catch (error) {
  console.error("⚠️ Failed to load config file:", error);
  VALID_COMMANDS = [];
}

const server = new Server(
  {
    name: "climpt-mcp",
    version: CLIMPT_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

/**
 * Handler for listing available tools.
 * Returns search and describe tools.
 */
server.setRequestHandler(
  ListToolsRequestSchema,
  (_request: ListToolsRequest) => {
    console.error("🔧 ListToolsRequest received");

    const tools = [
      {
        name: "search",
        description:
          "Search for commands using semantic similarity based on natural language descriptions",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "English description of the desired command",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "describe",
        description:
          "Retrieve complete command definitions including all options and variations",
        inputSchema: {
          type: "object",
          properties: {
            c1: {
              type: "string",
              description: "Domain name (e.g., git, spec, test)",
            },
            c2: {
              type: "string",
              description: "Action name (e.g., create, analyze)",
            },
            c3: {
              type: "string",
              description: "Target name (e.g., refinement-issue, quality-metrics)",
            },
          },
          required: ["c1", "c2", "c3"],
        },
      },
    ];

    return { tools };
  },
);

/**
 * Handler for executing a tool.
 * Handles both search and describe commands.
 */
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    console.error(`⚡ CallToolRequest received for: ${name}`);

    try {
      if (name === "search") {
        const { query } = args as { query: string };

        if (!query || typeof query !== "string") {
          throw new Error("query parameter is required and must be a string");
        }

        const results = searchCommands(VALID_COMMANDS, query);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ results }, null, 2),
            },
          ],
        };
      } else if (name === "describe") {
        const { c1, c2, c3 } = args as { c1: string; c2: string; c3: string };

        if (!c1 || !c2 || !c3) {
          throw new Error("c1, c2, and c3 parameters are all required");
        }

        const commands = describeCommand(VALID_COMMANDS, c1, c2, c3);

        if (commands.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: `No commands found for c1="${c1}", c2="${c2}", c3="${c3}"`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ commands }, null, 2),
            },
          ],
        };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      console.error(`❌ Error executing tool ${name}:`, error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: error instanceof Error
                  ? error.message
                  : "Unknown error occurred",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
);

/**
 * Main function to start the MCP server.
 * Initializes the stdio transport and connects the server.
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
