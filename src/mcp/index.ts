#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * @fileoverview MCP Server implementation for Climpt
 * @module mcp/index
 *
 * MCP server providing search, describe, execute, reload tools.
 * Uses shared modules (types.ts, similarity.ts, registry.ts) with caching layer.
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
import type { Command, MCPConfig } from "./types.ts";
import { DEFAULT_MCP_CONFIG } from "./types.ts";
import { describeCommand, searchCommands } from "./similarity.ts";
import {
  loadMCPConfig,
  loadRegistryForAgent as loadRegistryBase,
} from "./registry.ts";
import { getPromptLogger, type PromptLogger } from "./prompt-logger.ts";

// deno-lint-ignore no-console
console.error("[START] MCP Server starting...");
// deno-lint-ignore no-console
console.error(`[INFO] Climpt version: ${CLIMPT_VERSION}`);

/**
 * MCP configuration loaded from config.json
 */
let MCP_CONFIG: MCPConfig = DEFAULT_MCP_CONFIG;

/**
 * Registry cache: Maps agent name to their commands
 */
const REGISTRY_CACHE = new Map<string, Command[]>();

/**
 * Load command registry for a specific agent with caching.
 *
 * Uses shared loadRegistryBase for actual loading, adds caching layer
 * for MCP server performance.
 *
 * @param agentName - Name of the agent whose registry to load (e.g., 'climpt', 'inspector')
 * @returns Promise that resolves to an array of commands for the agent
 *
 * @internal
 */
async function loadRegistryForAgent(agentName: string): Promise<Command[]> {
  // Check cache first
  const cached = REGISTRY_CACHE.get(agentName);
  if (cached) {
    return cached;
  }

  // Use shared loading utility
  const commands = await loadRegistryBase(MCP_CONFIG, agentName);

  // Cache the commands
  if (commands.length > 0) {
    REGISTRY_CACHE.set(agentName, commands);
  }

  return commands;
}

/**
 * Initialize MCP server: load config and default registry
 */
MCP_CONFIG = await loadMCPConfig();

// Load default registry for climpt
const defaultCommands = await loadRegistryForAgent("climpt");
// deno-lint-ignore no-console
console.error(
  `[OK] Initialized with ${defaultCommands.length} default commands`,
);

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
 *
 * Responds to MCP ListToolsRequest by returning the available tools:
 * - **search**: Semantic search for commands using natural language
 * - **describe**: Get detailed information about specific commands
 * - **execute**: Execute commands with specified parameters
 *
 * @param _request - The ListToolsRequest (unused)
 * @returns Object containing array of available tools with their schemas
 *
 * @internal
 */
server.setRequestHandler(
  ListToolsRequestSchema,
  (_request: ListToolsRequest) => {
    // deno-lint-ignore no-console
    console.error("[TOOLS] ListToolsRequest received");

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
                "Optional agent name to reload (e.g., 'climpt', 'inspector'). If not specified, clears cache for all agents and reloads all agents defined in registry config file (.agent/climpt/config/registry_config.json). This handles cases where agents are added, removed, or modified in the configuration.",
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
 *
 * Processes MCP CallToolRequest for the three available tools:
 * - **search**: Performs semantic search across commands
 * - **describe**: Retrieves detailed command information
 * - **execute**: Runs the specified command and returns results
 *
 * @param request - The CallToolRequest containing tool name and arguments
 * @returns Promise that resolves to tool execution results with content array
 *
 * @throws Error if required parameters are missing or tool name is unknown
 *
 * @internal
 */
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    // deno-lint-ignore no-console
    console.error(`[CALL] CallToolRequest received for: ${name}`);

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
        // deno-lint-ignore no-console
        console.error(
          `[EXEC] Executing: deno run jsr:@aidevtool/climpt --config=${configParam} ${c2} ${c3}${optionsStr}`,
        );

        // Parse edition and adaptation from options
        let edition: string | undefined;
        let adaptation: string | undefined;
        if (options && Array.isArray(options)) {
          for (const opt of options) {
            if (opt.startsWith("-e=") || opt.startsWith("--edition=")) {
              edition = opt.split("=")[1];
            } else if (
              opt.startsWith("-a=") || opt.startsWith("--adaptation=")
            ) {
              adaptation = opt.split("=")[1];
            }
          }
        }

        // Start execution tracking for structured logging
        let tracker:
          | Awaited<
            ReturnType<PromptLogger["startExecution"]>
          >
          | null = null;
        try {
          const logger = await getPromptLogger();
          tracker = logger.startExecution(
            { c1, c2, c3 },
            {
              agent,
              edition,
              adaptation,
              options: options && options.length > 0 ? options : undefined,
            },
            "mcp",
          );
        } catch (logError) {
          // Log errors should not block execution
          // deno-lint-ignore no-console
          console.error(
            "[WARN] Failed to start execution logging:",
            logError,
          );
        }

        const { code, stdout, stderr } = await command.output();
        const stdoutText = new TextDecoder().decode(stdout);
        const stderrText = new TextDecoder().decode(stderr);

        // Log execution result
        if (tracker) {
          try {
            await tracker.complete({
              success: code === 0,
              exitCode: code,
              errorMessage: code !== 0 ? stderrText : undefined,
            });
          } catch {
            // Logging errors should not block response
          }
        }

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
          // deno-lint-ignore no-console
          console.error(`[RELOAD] Cleared cache for agent: ${agent}`);

          const commands = await loadRegistryForAgent(agent);
          const message = commands.length > 0
            ? `Successfully reloaded ${commands.length} commands for agent '${agent}'`
            : `No commands found for agent '${agent}' - please check the registry path in MCP config`;

          // deno-lint-ignore no-console
          console.error(`[OK] ${message}`);

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
          // deno-lint-ignore no-console
          console.error(
            `[RELOAD] Cleared cache for all agents (${cacheSize} agents)`,
          );

          // Reload all agents defined in MCP_CONFIG in parallel
          const configuredAgents = Object.keys(MCP_CONFIG.registries);

          const reloadResults = await Promise.all(
            configuredAgents.map(async (agentName) => {
              const commands = await loadRegistryForAgent(agentName);
              // deno-lint-ignore no-console
              console.error(
                `[OK] Reloaded ${commands.length} commands for agent '${agentName}'`,
              );
              return {
                agent: agentName,
                commandCount: commands.length,
                success: commands.length > 0,
              };
            }),
          );

          const totalCommands = reloadResults.reduce(
            (sum, result) => sum + result.commandCount,
            0,
          );
          const message =
            `Cleared cache for all agents and reloaded ${configuredAgents.length} agents with ${totalCommands} total commands`;

          // deno-lint-ignore no-console
          console.error(`[OK] ${message}`);

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
      // deno-lint-ignore no-console
      console.error(`[ERROR] Error executing tool ${name}:`, error);
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
 *
 * Initializes the Model Context Protocol (MCP) server with stdio transport
 * and connects it to enable AI assistant interactions. The server loads
 * command registries from configuration files and provides semantic search
 * capabilities for discovering and executing development commands.
 *
 * This function:
 * 1. Loads registry configuration from `.agent/climpt/config/registry_config.json`
 * 2. Initializes command registries for configured agents
 * 3. Sets up stdio transport for communication
 * 4. Connects the server and starts listening for requests
 *
 * @returns Promise that resolves when the server is connected and ready
 *
 * @throws Error if the server fails to initialize or connect
 *
 * @example
 * ```typescript
 * import main from "./src/mcp/index.ts";
 *
 * // Start the MCP server
 * await main();
 * ```
 */
async function main(): Promise<void> {
  // deno-lint-ignore no-console
  console.error("[+] Connecting to StdioServerTransport...");
  const transport = new StdioServerTransport();
  // deno-lint-ignore no-console
  console.error("[OK] Transport created, connecting server...");
  await server.connect(transport);
  // deno-lint-ignore no-console
  console.error("[OK] MCP Server connected and ready!");
}

// Export main function for programmatic use
export default main;

if (import.meta.main) {
  // deno-lint-ignore no-console
  console.error("[*] Script is main module, starting server...");
  main().catch((error) => {
    // deno-lint-ignore no-console
    console.error("[ERROR] Server error:", error);
    Deno.exit(1);
  });
}
