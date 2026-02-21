/**
 * @fileoverview Plugin sync tests for registry module
 * @module tests/plugin-sync/registry-sync_test
 *
 * Verifies that MCP and Plugin versions of registry loading functions
 * produce identical Command[] outputs for identical configurations.
 *
 * Note: The MCP version uses logger for info/warn/error messages while the
 * Plugin version is silent. These logging differences are intentionally ignored.
 * Tests focus on functional equivalence of returned data.
 */

import { assertEquals } from "@std/assert";
import { createTestLogger } from "../test-utils.ts";

import {
  loadMCPConfig as mcpLoadMCPConfig,
  loadRegistryForAgent as mcpLoadRegistryForAgent,
} from "../../src/mcp/registry.ts";

const logger = createTestLogger("plugin-registry");

import {
  loadMCPConfig as pluginLoadMCPConfig,
  loadRegistryForAgent as pluginLoadRegistryForAgent,
} from "../../plugins/climpt-agent/lib/registry.ts";

import type { MCPConfig as MCPConfigType } from "../../src/mcp/types.ts";
import { DEFAULT_MCP_CONFIG } from "../../src/mcp/types.ts";
import { DEFAULT_MCP_CONFIG as PLUGIN_DEFAULT_MCP_CONFIG } from "../../plugins/climpt-agent/lib/types.ts";

// ============================================================================
// DEFAULT_MCP_CONFIG Sync Tests
// ============================================================================

Deno.test("plugin-sync/registry: DEFAULT_MCP_CONFIG is identical between MCP and Plugin", () => {
  assertEquals(DEFAULT_MCP_CONFIG, PLUGIN_DEFAULT_MCP_CONFIG);
});

// ============================================================================
// loadMCPConfig() Sync Tests
// ============================================================================

Deno.test("plugin-sync/registry: loadMCPConfig returns identical config from same file", async () => {
  // Both functions should find the same config file and return the same result.
  // When no config file exists, both should return DEFAULT_MCP_CONFIG.
  // We test this by running both in the same directory context.
  const mcpConfig = await mcpLoadMCPConfig();
  const pluginConfig = await pluginLoadMCPConfig();
  logger.debug("loadMCPConfig result", {
    mcpRegistries: mcpConfig.registries,
    pluginRegistries: pluginConfig.registries,
  });

  // Compare structure (ignoring logging side effects)
  assertEquals(mcpConfig.registries, pluginConfig.registries);
});

// ============================================================================
// loadRegistryForAgent() Sync Tests
// ============================================================================

Deno.test("plugin-sync/registry: loadRegistryForAgent returns identical commands for same config", async () => {
  // Use a config pointing to the actual registry file in this project
  const config: MCPConfigType = {
    registries: {
      climpt: ".agent/climpt/registry.json",
    },
  };

  const mcpCommands = await mcpLoadRegistryForAgent(config, "climpt");
  const pluginCommands = await pluginLoadRegistryForAgent(config, "climpt");
  logger.debug("loadRegistryForAgent result", {
    agent: "climpt",
    mcpCount: mcpCommands.length,
    pluginCount: pluginCommands.length,
  });

  // Both should return the same Command[] array
  assertEquals(mcpCommands, pluginCommands);
});

Deno.test("plugin-sync/registry: loadRegistryForAgent returns identical empty array for missing agent", async () => {
  const config: MCPConfigType = {
    registries: {
      climpt: ".agent/climpt/registry.json",
    },
  };

  // Agent name not in config -> both should return []
  const mcpCommands = await mcpLoadRegistryForAgent(config, "nonexistent");
  const pluginCommands = await pluginLoadRegistryForAgent(
    config,
    "nonexistent",
  );

  assertEquals(mcpCommands, pluginCommands);
  assertEquals(mcpCommands, []);
});

Deno.test("plugin-sync/registry: loadRegistryForAgent returns identical empty array for invalid path", async () => {
  const config: MCPConfigType = {
    registries: {
      broken: "/nonexistent/path/to/registry.json",
    },
  };

  // Invalid path -> both should return []
  const mcpCommands = await mcpLoadRegistryForAgent(config, "broken");
  const pluginCommands = await pluginLoadRegistryForAgent(config, "broken");

  assertEquals(mcpCommands, pluginCommands);
  assertEquals(mcpCommands, []);
});

Deno.test("plugin-sync/registry: loadRegistryForAgent returns identical empty array for empty registries", async () => {
  const config: MCPConfigType = {
    registries: {},
  };

  const mcpCommands = await mcpLoadRegistryForAgent(config, "climpt");
  const pluginCommands = await pluginLoadRegistryForAgent(config, "climpt");

  assertEquals(mcpCommands, pluginCommands);
  assertEquals(mcpCommands, []);
});

Deno.test("plugin-sync/registry: loadRegistryForAgent command objects have identical structure", async () => {
  const config: MCPConfigType = {
    registries: {
      climpt: ".agent/climpt/registry.json",
    },
  };

  const mcpCommands = await mcpLoadRegistryForAgent(config, "climpt");
  const pluginCommands = await pluginLoadRegistryForAgent(config, "climpt");

  logger.debug("loadRegistryForAgent structure check", {
    mcpCommandCount: mcpCommands.length,
    pluginCommandCount: pluginCommands.length,
  });
  // If commands were loaded, verify each command has identical fields
  for (let i = 0; i < mcpCommands.length; i++) {
    const mcpCmd = mcpCommands[i];
    const pluginCmd = pluginCommands[i];
    assertEquals(mcpCmd.c1, pluginCmd.c1);
    assertEquals(mcpCmd.c2, pluginCmd.c2);
    assertEquals(mcpCmd.c3, pluginCmd.c3);
    assertEquals(mcpCmd.description, pluginCmd.description);
    assertEquals(mcpCmd.usage, pluginCmd.usage);
    assertEquals(mcpCmd.options, pluginCmd.options);
  }
});
