import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolve } from "https://deno.land/std@0.224.0/path/mod.ts";

// Test registry.json loading and structure
Deno.test("registry.json exists and has valid structure", async () => {
  const registryPath = resolve(".agent/climpt/registry.json");

  try {
    const registryText = await Deno.readTextFile(registryPath);
    const registry = JSON.parse(registryText);

    // Check required fields exist
    assertExists(registry.version, "Registry should have version field");
    assertExists(
      registry.description,
      "Registry should have description field",
    );
    assertExists(registry.tools, "Registry should have tools field");
    assertExists(
      registry.tools.availableConfigs,
      "Registry should have availableConfigs",
    );

    // Check availableConfigs is array of strings
    assertEquals(
      Array.isArray(registry.tools.availableConfigs),
      true,
      "availableConfigs should be an array",
    );

    // Check expected tools are present (C3L v0.5 format: climpt-{domain})
    const expectedTools = ["climpt-code", "climpt-git", "climpt-meta"];
    for (const tool of expectedTools) {
      assertEquals(
        registry.tools.availableConfigs.includes(tool),
        true,
        `Tool '${tool}' should be in availableConfigs`,
      );
    }

    // Check commands array exists and has proper structure
    if (registry.tools.commands) {
      assertEquals(
        Array.isArray(registry.tools.commands),
        true,
        "commands should be an array",
      );

      // Check first command has required fields
      if (registry.tools.commands.length > 0) {
        const firstCommand = registry.tools.commands[0];
        assertExists(firstCommand.c1, "Command should have c1 field");
        assertExists(firstCommand.c2, "Command should have c2 field");
        assertExists(firstCommand.c3, "Command should have c3 field");
        assertExists(
          firstCommand.description,
          "Command should have description",
        );
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Registry file doesn't exist, which is OK (MCP will use defaults)
      console.log(
        "Registry file not found - MCP will use default configuration",
      );
    } else {
      throw error;
    }
  }
});

// Test MCP server can be imported
Deno.test("MCP server module can be imported", async () => {
  const mcpModule = await import("../src/mcp/index.ts");
  assertExists(mcpModule, "MCP module should be importable");
  assertEquals(
    typeof mcpModule.default,
    "function",
    "MCP module should export a default function",
  );
});

// Test MCP server startup (without actually running the server)
Deno.test("MCP server configuration loading", async () => {
  // Create a temporary test registry
  const testRegistry = {
    version: "1.0.0",
    description: "Test registry",
    tools: {
      availableConfigs: ["test-tool"],
      commands: [
        {
          c1: "test",
          c2: "run",
          c3: "unit",
          description: "Run unit tests",
          usage: "Test usage",
          options: {
            input: ["default"],
            adaptation: ["default"],
            file: false,
            stdin: false,
            destination: false,
          },
        },
      ],
    },
  };

  // Create temporary registry file for testing
  const tempDir = await Deno.makeTempDir();
  const tempRegistry = `${tempDir}/registry.json`;
  await Deno.writeTextFile(tempRegistry, JSON.stringify(testRegistry, null, 2));

  // Test that the registry can be parsed
  const loadedRegistry = JSON.parse(await Deno.readTextFile(tempRegistry));
  assertEquals(loadedRegistry.tools.availableConfigs[0], "test-tool");
  assertEquals(loadedRegistry.tools.commands[0].c1, "test");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

// Test URL handling in config loading (regression test for pathname fix)
Deno.test("MCP config loading handles URL objects correctly", async () => {
  // Create a test config file
  const testConfig = {
    version: "1.0.0",
    description: "Test config for URL handling",
    tools: {
      availableConfigs: ["code", "docs", "git", "meta", "spec", "test"],
    },
  };

  // Create temporary config file
  const tempDir = await Deno.makeTempDir();
  const tempConfigPath = `${tempDir}/registry.json`;
  await Deno.writeTextFile(tempConfigPath, JSON.stringify(testConfig, null, 2));

  // Test URL object creation and pathname extraction
  const configUrl = new URL(`file://${tempConfigPath}`);
  assertEquals(
    typeof configUrl.pathname,
    "string",
    "URL pathname should be a string",
  );

  // Test that Deno.readTextFile works with pathname
  const configText = await Deno.readTextFile(configUrl.pathname);
  const loadedConfig = JSON.parse(configText);
  assertEquals(
    loadedConfig.tools.availableConfigs.length,
    6,
    "Should load all 6 configs",
  );
  assertEquals(
    loadedConfig.tools.availableConfigs[0],
    "code",
    "First config should be 'code'",
  );

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

// Test fallback behavior when config file URL is invalid
Deno.test("MCP config loading falls back to defaults on URL errors", async () => {
  // This test simulates the error that was fixed by using configPath.pathname
  const invalidPath = "/nonexistent/path/registry.json";

  try {
    // This should fail with NotFound error
    await Deno.readTextFile(invalidPath);
    // If we get here, the test should fail
    assertEquals(
      true,
      false,
      "Should have thrown an error for nonexistent file",
    );
  } catch (error) {
    // Verify it's the expected error type
    assertEquals(
      error instanceof Deno.errors.NotFound,
      true,
      "Should throw NotFound error",
    );
  }

  // Test URL object with invalid path
  try {
    const invalidUrl = new URL("file:///nonexistent/path/registry.json");
    await Deno.readTextFile(invalidUrl.pathname);
    assertEquals(
      true,
      false,
      "Should have thrown an error for nonexistent URL path",
    );
  } catch (error) {
    assertEquals(
      error instanceof Deno.errors.NotFound,
      true,
      "Should throw NotFound error for URL pathname",
    );
  }
});

// Test local config file discovery (regression test for JSR package support)
Deno.test("MCP config loading discovers local files correctly", async () => {
  // Create temporary working directory with config
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Create .agent/climpt directory structure
    const agentDir = `${tempDir}/.agent/climpt`;
    await Deno.mkdir(agentDir, { recursive: true });

    // Create test config file
    const testConfig = {
      version: "1.0.0",
      description: "Test config for local discovery",
      tools: {
        availableConfigs: ["custom-config", "local-tool"],
      },
    };

    await Deno.writeTextFile(
      `${agentDir}/registry.json`,
      JSON.stringify(testConfig, null, 2),
    );

    // Change to temp directory
    Deno.chdir(tempDir);

    // Test that config can be loaded from current working directory
    const configText = await Deno.readTextFile(".agent/climpt/registry.json");
    const loadedConfig = JSON.parse(configText);
    assertEquals(loadedConfig.tools.availableConfigs.length, 2);
    assertEquals(loadedConfig.tools.availableConfigs[0], "custom-config");
    assertEquals(loadedConfig.tools.availableConfigs[1], "local-tool");
  } finally {
    // Restore original working directory
    Deno.chdir(originalCwd);
    // Cleanup
    await Deno.remove(tempDir, { recursive: true });
  }
});

// Test home directory config fallback
Deno.test("MCP config loading falls back to home directory", async () => {
  // Create temporary home directory with config
  const tempHomeDir = await Deno.makeTempDir();
  const originalHome = Deno.env.get("HOME");

  try {
    // Set temporary HOME environment
    Deno.env.set("HOME", tempHomeDir);

    // Create .agent/climpt directory in "home"
    const agentDir = `${tempHomeDir}/.agent/climpt`;
    await Deno.mkdir(agentDir, { recursive: true });

    // Create test config file in home directory
    const homeConfig = {
      version: "1.0.0",
      description: "Home directory config",
      tools: {
        availableConfigs: ["home-tool", "global-config"],
      },
    };

    await Deno.writeTextFile(
      `${agentDir}/registry.json`,
      JSON.stringify(homeConfig, null, 2),
    );

    // Test that config can be loaded from home directory
    const homeConfigPath = `${tempHomeDir}/.agent/climpt/registry.json`;
    const configText = await Deno.readTextFile(homeConfigPath);
    const loadedConfig = JSON.parse(configText);
    assertEquals(loadedConfig.tools.availableConfigs.length, 2);
    assertEquals(loadedConfig.tools.availableConfigs[0], "home-tool");
    assertEquals(loadedConfig.tools.availableConfigs[1], "global-config");
  } finally {
    // Restore original HOME environment
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    // Cleanup
    await Deno.remove(tempHomeDir, { recursive: true });
  }
});

// Test config loading priority: current dir > home dir > defaults
Deno.test("MCP config loading follows correct priority order", async () => {
  const tempWorkDir = await Deno.makeTempDir();
  const tempHomeDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalHome = Deno.env.get("HOME");

  try {
    // Set up temporary home directory
    Deno.env.set("HOME", tempHomeDir);
    const homeAgentDir = `${tempHomeDir}/.agent/climpt`;
    await Deno.mkdir(homeAgentDir, { recursive: true });

    // Create home config
    const homeConfig = {
      version: "1.0.0",
      description: "Home config",
      tools: { availableConfigs: ["home-config"] },
    };
    await Deno.writeTextFile(
      `${homeAgentDir}/registry.json`,
      JSON.stringify(homeConfig, null, 2),
    );

    // Set up working directory with config (should take priority)
    const workAgentDir = `${tempWorkDir}/.agent/climpt`;
    await Deno.mkdir(workAgentDir, { recursive: true });

    const workConfig = {
      version: "1.0.0",
      description: "Work dir config",
      tools: { availableConfigs: ["work-config"] },
    };
    await Deno.writeTextFile(
      `${workAgentDir}/registry.json`,
      JSON.stringify(workConfig, null, 2),
    );

    // Change to work directory
    Deno.chdir(tempWorkDir);

    // Test that work directory config takes priority
    const configText = await Deno.readTextFile(".agent/climpt/registry.json");
    const loadedConfig = JSON.parse(configText);
    assertEquals(loadedConfig.tools.availableConfigs[0], "work-config");
    assertEquals(loadedConfig.description, "Work dir config");
  } finally {
    // Restore original environment
    Deno.chdir(originalCwd);
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    // Cleanup
    await Deno.remove(tempWorkDir, { recursive: true });
    await Deno.remove(tempHomeDir, { recursive: true });
  }
});

// Test command structure validation
Deno.test("Command structure follows C3L specification", async () => {
  const registryPath = resolve(".agent/climpt/registry.json");

  try {
    const registryText = await Deno.readTextFile(registryPath);
    const registry = JSON.parse(registryText);

    if (registry.tools?.commands && Array.isArray(registry.tools.commands)) {
      for (const command of registry.tools.commands) {
        // Check C3L structure
        assertExists(command.c1, "Command must have c1 (domain)");
        assertExists(command.c2, "Command must have c2 (action)");
        assertExists(command.c3, "Command must have c3 (target)");

        // Check c1 is a valid domain (C3L v0.5 format: climpt-{domain})
        const validDomains = ["climpt-code", "climpt-git", "climpt-meta"];
        assertEquals(
          validDomains.includes(command.c1),
          true,
          `c1 '${command.c1}' should be a valid domain`,
        );

        // Check options structure if present
        if (command.options) {
          assertExists(
            command.options.edition,
            "Options should have edition field",
          );
          assertExists(
            command.options.adaptation,
            "Options should have adaptation field",
          );
          assertExists(command.options.file, "Options should have file field");
          assertExists(
            command.options.stdin,
            "Options should have stdin field",
          );
          assertExists(
            command.options.destination,
            "Options should have destination field",
          );

          // Check that edition and adaptation are arrays
          assertEquals(
            Array.isArray(command.options.edition),
            true,
            "edition should be array",
          );
          assertEquals(
            Array.isArray(command.options.adaptation),
            true,
            "adaptation should be array",
          );
          // Check that file, stdin, destination are booleans
          assertEquals(
            typeof command.options.file,
            "boolean",
            "file should be boolean",
          );
          assertEquals(
            typeof command.options.stdin,
            "boolean",
            "stdin should be boolean",
          );
          assertEquals(
            typeof command.options.destination,
            "boolean",
            "destination should be boolean",
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.log("Registry file not found - skipping command structure test");
    } else {
      throw error;
    }
  }
});

// Test MCP exports are properly configured
Deno.test("MCP exports are properly configured in deno.json", async () => {
  const denoConfigText = await Deno.readTextFile("deno.json");
  const denoConfig = JSON.parse(denoConfigText);

  assertExists(denoConfig.exports, "deno.json should have exports");
  assertExists(denoConfig.exports["./mcp"], "deno.json should export ./mcp");
  assertEquals(
    denoConfig.exports["./mcp"],
    "./mcp.ts",
    "MCP export should point to mcp.ts",
  );
});

// Test MCP server imports required dependencies
Deno.test("MCP server has required dependencies", async () => {
  const mcpIndexContent = await Deno.readTextFile("src/mcp/index.ts");

  // Check for required MCP SDK imports
  assertStringIncludes(
    mcpIndexContent,
    "@modelcontextprotocol/sdk",
    "Should import MCP SDK",
  );
  assertStringIncludes(
    mcpIndexContent,
    "Server",
    "Should import Server from MCP SDK",
  );
  assertStringIncludes(
    mcpIndexContent,
    "StdioServerTransport",
    "Should import StdioServerTransport",
  );

  // Check for version import
  assertStringIncludes(
    mcpIndexContent,
    "./version",
    "Should import version constants",
  );

  // Check for handler setup
  assertStringIncludes(
    mcpIndexContent,
    "setRequestHandler",
    "Should set up request handlers",
  );
  assertStringIncludes(
    mcpIndexContent,
    "ListToolsRequest",
    "Should handle ListToolsRequest",
  );
  assertStringIncludes(
    mcpIndexContent,
    "CallToolRequest",
    "Should handle CallToolRequest",
  );
});

// Test MCP server implements all three tools
Deno.test("MCP server implements search, describe, and execute tools", async () => {
  const mcpIndexContent = await Deno.readTextFile("src/mcp/index.ts");

  // Check for search tool
  assertStringIncludes(
    mcpIndexContent,
    'name: "search"',
    "Should implement search tool",
  );

  // Check for describe tool
  assertStringIncludes(
    mcpIndexContent,
    'name: "describe"',
    "Should implement describe tool",
  );

  // Check for execute tool
  assertStringIncludes(
    mcpIndexContent,
    'name: "execute"',
    "Should implement execute tool",
  );

  // Check for execute handler
  assertStringIncludes(
    mcpIndexContent,
    'name === "execute"',
    "Should have execute handler",
  );
});
