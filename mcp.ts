#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run

/**
 * @module
 * MCP (Model Context Protocol) Server for Climpt
 *
 * This module provides an MCP server implementation that enables AI assistants
 * like Claude to interact with Climpt's command registry and execute development
 * tasks through a standardized protocol.
 *
 * ## Features
 *
 * - Dynamic tool loading from external configuration
 * - Support for all Climpt command categories (code, docs, git, meta, spec, test)
 * - Graceful fallback to defaults when configuration is unavailable
 * - Full JSR distribution support
 *
 * ## Important Note
 *
 * When using MCP, the `.deno/bin` directory is **not required**. The MCP server
 * executes commands directly through the protocol without needing local CLI binaries.
 *
 * ## Usage
 *
 * ### As an MCP Server
 *
 * Configure in your Claude or Cursor settings (`.mcp.json` or `~/.claude.json`):
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "climpt": {
 *       "command": "deno",
 *       "args": [
 *         "run",
 *         "--allow-read",
 *         "--allow-write",
 *         "--allow-net",
 *         "--allow-env",
 *         "--allow-run",
 *         "jsr:@aidevtool/climpt/mcp"
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * ### Direct Execution
 *
 * Run the MCP server directly:
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-net --allow-env --allow-run jsr:@aidevtool/climpt/mcp
 * ```
 *
 * ## Configuration
 *
 * ### Registry File Loading
 *
 * The MCP server automatically loads configuration from `.agent/climpt/registry.json`
 * at startup. This file contains:
 *
 * - **tools.availableConfigs**: Array of available tool configurations
 * - **tools.commands**: Full command registry with c1/c2/c3 definitions
 *
 * #### Loading Process
 *
 * 1. Server attempts to read `.agent/climpt/registry.json` from the project root
 * 2. If found, dynamically loads tool definitions and command mappings
 * 3. If not found or invalid, falls back to default built-in tools
 * 4. Each tool in `availableConfigs` becomes available as `climpt-{toolname}`
 *
 * #### Registry File Structure
 *
 * ```json
 * {
 *   "tools": {
 *     "availableConfigs": [
 *       {
 *         "name": "git",
 *         "description": "Git operations",
 *         "usage": "climpt-git create refinement-issue"
 *       }
 *     ],
 *     "commands": [
 *       {
 *         "c1": "git",
 *         "c2": "create",
 *         "c3": "refinement-issue",
 *         "description": "Create refinement issue from requirements"
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * ## Available Tools
 *
 * - **code**: Development task management
 * - **docs**: Documentation generation and management
 * - **git**: Git operations and repository management
 * - **meta**: Meta operations and command management
 * - **spec**: Specification analysis and management
 * - **test**: Testing and verification operations
 *
 * @example
 * ```typescript
 * // Import and run the MCP server programmatically
 * import mcpServer from "jsr:@aidevtool/climpt/mcp";
 *
 * await mcpServer();
 * ```
 */
export { default } from "./src/mcp/index.ts";
