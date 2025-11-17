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
import type { Command, MCPConfig, Registry } from "./types.ts";
import { DEFAULT_MCP_CONFIG } from "./types.ts";
import { describeCommand, searchCommands } from "./similarity.ts";

console.error("🚀 MCP Server starting...");
console.error(`📦 Climpt version: ${CLIMPT_VERSION}`);

/**
 * MCP configuration loaded from config.json
 */
let MCP_CONFIG: MCPConfig = DEFAULT_MCP_CONFIG;

/**
 * Registry cache: Maps agent name to their commands
 */
const REGISTRY_CACHE = new Map<string, Command[]>();

/**
 * Load or create MCP config.json
 */
async function loadOrCreateMCPConfig(): Promise<MCPConfig> {
  const configPaths = [
    ".agent/climpt/mcp/config.json",
    `${
      Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ""
    }/.agent/climpt/mcp/config.json`,
  ];

  // Try to load existing config
  for (const configPath of configPaths) {
    try {
      const configText = await Deno.readTextFile(configPath);
      const config = JSON.parse(configText) as MCPConfig;
      console.error(`⚙️ Loaded MCP config from ${configPath}`);
      return config;
    } catch {
      // Continue to next path
    }
  }

  // Create default config if not found
  const defaultConfigPath = ".agent/climpt/mcp/config.json";
  try {
    await Deno.mkdir(".agent/climpt/mcp", { recursive: true });
    await Deno.writeTextFile(
      defaultConfigPath,
      JSON.stringify(DEFAULT_MCP_CONFIG, null, 2),
    );
    console.error(`✨ Created default MCP config at ${defaultConfigPath}`);
    return DEFAULT_MCP_CONFIG;
  } catch (error) {
    console.error("⚠️ Failed to create MCP config:", error);
    return DEFAULT_MCP_CONFIG;
  }
}

/**
 * Load registry for a specific agent
 */
async function loadRegistryForAgent(agentName: string): Promise<Command[]> {
  // Check cache first
  if (REGISTRY_CACHE.has(agentName)) {
    return REGISTRY_CACHE.get(agentName)!;
  }

  const registryPath = MCP_CONFIG.registries[agentName];
  if (!registryPath) {
    console.error(`⚠️ No registry path configured for agent: ${agentName}`);
    return [];
  }

  try {
    let configText: string;

    try {
      configText = await Deno.readTextFile(registryPath);
    } catch {
      // If not found in current directory, try user's home directory
      const homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
      const homePath = `${homeDir}/${registryPath}`;
      configText = await Deno.readTextFile(homePath);
    }

    const config: Registry = JSON.parse(configText);
    const commands = config.tools?.commands || [];

    // Cache the commands
    REGISTRY_CACHE.set(agentName, commands);

    console.error(
      `⚙️ Loaded ${commands.length} commands for agent '${agentName}' from ${registryPath}`,
    );
    return commands;
  } catch (error) {
    console.error(
      `⚠️ Failed to load registry for agent '${agentName}':`,
      error,
    );
    return [];
  }
}

/**
 * Initialize MCP server: load config and default registry
 */
MCP_CONFIG = await loadOrCreateMCPConfig();

// Load default registry for climpt
const defaultCommands = await loadRegistryForAgent("climpt");
console.error(`✅ Initialized with ${defaultCommands.length} default commands`);

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
          "Pass a brief description of the command you want to execute. Finds the 3 most similar commands using cosine similarity against command descriptions. You can then select the most appropriate command from the results.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Brief description of what you want to do. Example: 'commit changes to git', 'generate API documentation', 'run tests'",
            },
            agent: {
              type: "string",
              description:
                "Optional agent name to search in (e.g., 'climpt', 'inspector'). Defaults to 'climpt' if not specified.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "describe",
        description:
          "Pass the c1, c2, c3 identifiers from search results. Returns all matching command details including usage instructions and available options. You can then choose the optimal option combination for your use case.",
        inputSchema: {
          type: "object",
          properties: {
            c1: {
              type: "string",
              description:
                "Domain identifier from search result (e.g., git, spec, test, code, docs, meta)",
            },
            c2: {
              type: "string",
              description:
                "Action identifier from search result (e.g., create, analyze, execute, generate)",
            },
            c3: {
              type: "string",
              description:
                "Target identifier from search result (e.g., unstaged-changes, quality-metrics, unit-tests)",
            },
            agent: {
              type: "string",
              description:
                "Optional agent name to describe from (e.g., 'climpt', 'inspector'). Defaults to 'climpt' if not specified.",
            },
          },
          required: ["c1", "c2", "c3"],
        },
      },
      {
        name: "execute",
        description:
          "Based on the detailed information obtained from describe, pass the four required parameters: <agent-name>, <c1>, <c2>, <c3>. Also include option arguments (-*/--* format) obtained from describe. Create values for options before passing to execute. The result from execute is an instruction document - follow the obtained instructions to proceed. Note: If you need STDIN support, execute the climpt command directly via CLI instead of using MCP.",
        inputSchema: {
          type: "object",
          properties: {
            agent: {
              type: "string",
              description:
                "Agent name from C3L specification (e.g., 'climpt', 'inspector', 'auditor'). Corresponds to the Agent-Domain model where agent is the autonomous executor.",
            },
            c1: {
              type: "string",
              description:
                "Domain identifier from describe result (e.g., git, spec, test, code, docs, meta)",
            },
            c2: {
              type: "string",
              description:
                "Action identifier from describe result (e.g., create, analyze, execute, generate)",
            },
            c3: {
              type: "string",
              description:
                "Target identifier from describe result (e.g., unstaged-changes, quality-metrics, unit-tests)",
            },
            options: {
              type: "array",
              description:
                "Optional command-line options from describe result (e.g., ['-f=file.txt']). These are passed directly to the command.",
              items: {
                type: "string",
              },
            },
          },
          required: ["agent", "c1", "c2", "c3"],
        },
      },
      {
        name: "reload",
        description:
          "Clear the registry cache and reload command definitions from registry.json files. Use this when you have updated registry.json and want to refresh the command definitions without restarting the MCP server. You can reload all agents or a specific agent.",
        inputSchema: {
          type: "object",
          properties: {
            agent: {
              type: "string",
              description:
                "Optional agent name to reload (e.g., 'climpt', 'inspector'). If not specified, clears cache for all agents and reloads all agents defined in MCP config file (.agent/climpt/mcp/config.json). This handles cases where agents are added, removed, or modified in the configuration.",
            },
          },
          required: [],
        },
      },
    ];

    return { tools };
  },
);

/**
 * Handler for executing a tool.
 * Handles search, describe, and execute commands.
 */
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    console.error(`⚡ CallToolRequest received for: ${name}`);

    try {
      if (name === "search") {
        const { query, agent } = args as { query: string; agent?: string };

        if (!query || typeof query !== "string") {
          throw new Error("query parameter is required and must be a string");
        }

        const agentName = agent || "climpt";
        const commands = await loadRegistryForAgent(agentName);

        if (commands.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `No commands found for agent '${agentName}'`,
                  agent: agentName,
                }),
              },
            ],
          };
        }

        const results = searchCommands(commands, query);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ results, agent: agentName }),
            },
          ],
        };
      } else if (name === "describe") {
        const { c1, c2, c3, agent } = args as {
          c1: string;
          c2: string;
          c3: string;
          agent?: string;
        };

        if (!c1 || !c2 || !c3) {
          throw new Error("c1, c2, and c3 parameters are all required");
        }

        const agentName = agent || "climpt";
        const allCommands = await loadRegistryForAgent(agentName);

        if (allCommands.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `No commands found for agent '${agentName}'`,
                  agent: agentName,
                }),
              },
            ],
          };
        }

        const commands = describeCommand(allCommands, c1, c2, c3);

        if (commands.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error:
                    `No commands found for c1="${c1}", c2="${c2}", c3="${c3}" in agent '${agentName}'`,
                  agent: agentName,
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ commands, agent: agentName }),
            },
          ],
        };
      } else if (name === "execute") {
        const { agent, c1, c2, c3, options } = args as {
          agent: string;
          c1: string;
          c2: string;
          c3: string;
          options?: string[];
        };

        if (!agent || !c1 || !c2 || !c3) {
          throw new Error(
            "agent, c1, c2, and c3 parameters are all required",
          );
        }

        // Construct config parameter based on agent value (C3L v0.5 specification)
        const configParam = agent === "climpt" ? c1 : `${agent}-${c1}`;

        // Build command arguments
        const commandArgs = [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-run",
          "--allow-net",
          "--no-config",
          "jsr:@aidevtool/climpt",
          `--config=${configParam}`,
          c2,
          c3,
        ];

        // Add optional arguments if provided
        if (options && Array.isArray(options) && options.length > 0) {
          commandArgs.push(...options);
        }

        const command = new Deno.Command("deno", {
          args: commandArgs,
          stdout: "piped",
          stderr: "piped",
        });

        const optionsStr = options && options.length > 0
          ? ` ${options.join(" ")}`
          : "";
        console.error(
          `🚀 Executing: deno run jsr:@aidevtool/climpt --config=${configParam} ${c2} ${c3}${optionsStr}`,
        );

        const { code, stdout, stderr } = await command.output();
        const stdoutText = new TextDecoder().decode(stdout);
        const stderrText = new TextDecoder().decode(stderr);

        // MCP specification: Return clean output to users, hiding internal implementation details
        // On success: return stdout content directly
        // On failure: return stderr with isError flag
        if (code === 0) {
          return {
            content: [
              {
                type: "text",
                text: stdoutText,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: stderrText || `Command failed with exit code ${code}`,
              },
            ],
            isError: true,
          };
        }
      } else if (name === "reload") {
        const { agent } = args as { agent?: string };

        if (agent) {
          // Reload specific agent
          REGISTRY_CACHE.delete(agent);
          console.error(`🔄 Cleared cache for agent: ${agent}`);

          const commands = await loadRegistryForAgent(agent);
          const message = commands.length > 0
            ? `Successfully reloaded ${commands.length} commands for agent '${agent}'`
            : `No commands found for agent '${agent}' - please check the registry path in MCP config`;

          console.error(`✅ ${message}`);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  agent,
                  commandCount: commands.length,
                  message,
                }),
              },
            ],
          };
        } else {
          // Clear all caches and reload all configured agents
          const cacheSize = REGISTRY_CACHE.size;
          REGISTRY_CACHE.clear();
          console.error(
            `🔄 Cleared cache for all agents (${cacheSize} agents)`,
          );

          // Reload all agents defined in MCP_CONFIG
          const configuredAgents = Object.keys(MCP_CONFIG.registries);
          const reloadResults: Array<{
            agent: string;
            commandCount: number;
            success: boolean;
          }> = [];

          for (const agentName of configuredAgents) {
            const commands = await loadRegistryForAgent(agentName);
            reloadResults.push({
              agent: agentName,
              commandCount: commands.length,
              success: commands.length > 0,
            });
            console.error(
              `✅ Reloaded ${commands.length} commands for agent '${agentName}'`,
            );
          }

          const totalCommands = reloadResults.reduce(
            (sum, result) => sum + result.commandCount,
            0,
          );
          const message =
            `Cleared cache for all agents and reloaded ${configuredAgents.length} agents with ${totalCommands} total commands`;

          console.error(`✅ ${message}`);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  clearedAgents: cacheSize,
                  reloadedAgents: reloadResults,
                  totalCommands,
                  message,
                }),
              },
            ],
          };
        }
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      console.error(`❌ Error executing tool ${name}:`, error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error
                ? error.message
                : "Unknown error occurred",
            }),
          },
        ],
        isError: true,
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
