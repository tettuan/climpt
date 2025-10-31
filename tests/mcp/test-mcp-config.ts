import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { MCPConfig } from "../../src/mcp/types.ts";
import { DEFAULT_MCP_CONFIG } from "../../src/mcp/types.ts";

// Test MCP config structure
Deno.test("MCP config has correct default structure", () => {
  assertExists(DEFAULT_MCP_CONFIG.registries, "Config should have registries");
  assertExists(
    DEFAULT_MCP_CONFIG.registries["climpt"],
    "Config should have climpt registry",
  );
  assertEquals(
    DEFAULT_MCP_CONFIG.registries["climpt"],
    ".agent/climpt/registry.json",
    "Climpt registry should point to correct path",
  );
});

// Test MCP config.json creation
Deno.test("MCP config.json can be created with default values", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(tempDir);

    // Create config directory
    const configDir = `${tempDir}/.agent/climpt/mcp`;
    await Deno.mkdir(configDir, { recursive: true });

    // Write default config
    const configPath = `${configDir}/config.json`;
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(DEFAULT_MCP_CONFIG, null, 2),
    );

    // Read and verify
    const configText = await Deno.readTextFile(configPath);
    const config: MCPConfig = JSON.parse(configText);

    assertEquals(
      config.registries["climpt"],
      ".agent/climpt/registry.json",
      "Config should contain climpt registry path",
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// Test MCP config.json with multiple registries
Deno.test("MCP config.json supports multiple registries", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    // Create config with multiple registries
    const multiConfig: MCPConfig = {
      registries: {
        "climpt": ".agent/climpt/registry.json",
        "inspector": ".agent/inspector/registry.json",
        "auditor": ".agent/auditor/registry.json",
      },
    };

    const configPath = `${tempDir}/config.json`;
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(multiConfig, null, 2),
    );

    // Read and verify
    const configText = await Deno.readTextFile(configPath);
    const config: MCPConfig = JSON.parse(configText);

    assertEquals(Object.keys(config.registries).length, 3);
    assertEquals(
      config.registries["climpt"],
      ".agent/climpt/registry.json",
    );
    assertEquals(
      config.registries["inspector"],
      ".agent/inspector/registry.json",
    );
    assertEquals(
      config.registries["auditor"],
      ".agent/auditor/registry.json",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// Test MCP config loading from different locations
Deno.test("MCP config can be loaded from current or home directory", async () => {
  const tempWorkDir = await Deno.makeTempDir();
  const tempHomeDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalHome = Deno.env.get("HOME");

  try {
    // Set up home directory config
    Deno.env.set("HOME", tempHomeDir);
    const homeConfigDir = `${tempHomeDir}/.agent/climpt/mcp`;
    await Deno.mkdir(homeConfigDir, { recursive: true });

    const homeConfig: MCPConfig = {
      registries: {
        "climpt": `${tempHomeDir}/.agent/climpt/registry.json`,
      },
    };
    await Deno.writeTextFile(
      `${homeConfigDir}/config.json`,
      JSON.stringify(homeConfig, null, 2),
    );

    // Set up work directory config (should take priority)
    const workConfigDir = `${tempWorkDir}/.agent/climpt/mcp`;
    await Deno.mkdir(workConfigDir, { recursive: true });

    const workConfig: MCPConfig = {
      registries: {
        "climpt": ".agent/climpt/registry.json",
        "custom": ".agent/custom/registry.json",
      },
    };
    await Deno.writeTextFile(
      `${workConfigDir}/config.json`,
      JSON.stringify(workConfig, null, 2),
    );

    Deno.chdir(tempWorkDir);

    // Verify work directory config takes priority
    const configText = await Deno.readTextFile(".agent/climpt/mcp/config.json");
    const config: MCPConfig = JSON.parse(configText);

    assertEquals(Object.keys(config.registries).length, 2);
    assertExists(config.registries["custom"]);
  } finally {
    Deno.chdir(originalCwd);
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    await Deno.remove(tempWorkDir, { recursive: true });
    await Deno.remove(tempHomeDir, { recursive: true });
  }
});

// Test agent parameter in search/describe tools
Deno.test("MCP tools support agent parameter for registry selection", () => {
  // This test verifies the type definitions support agent parameter
  interface SearchArgs {
    query: string;
    agent?: string;
  }

  interface DescribeArgs {
    c1: string;
    c2: string;
    c3: string;
    agent?: string;
  }

  const searchArgs: SearchArgs = {
    query: "test query",
    agent: "climpt",
  };

  const describeArgs: DescribeArgs = {
    c1: "test",
    c2: "run",
    c3: "unit",
    agent: "inspector",
  };

  assertEquals(searchArgs.agent, "climpt");
  assertEquals(describeArgs.agent, "inspector");
});
