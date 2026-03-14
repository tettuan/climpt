import { assertEquals, assertExists } from "@std/assert";
import { resolve } from "@std/path";
import {
  cleanupTempDir,
  createTempDir,
  createTestLogger,
} from "./test-utils.ts";
import { loadMCPConfig } from "../src/mcp/registry.ts";
import { DEFAULT_MCP_CONFIG } from "../src/mcp/types.ts";

const logger = createTestLogger("mcp");

// Test registry.json loading and structure
Deno.test("registry.json exists and has valid structure", async () => {
  const registryPath = resolve(".agent/climpt/registry.json");

  try {
    const registryText = await Deno.readTextFile(registryPath);
    const registry = JSON.parse(registryText);
    logger.debug("registry.json loaded", {
      registryPath,
      version: registry.version,
      availableConfigs: registry.tools?.availableConfigs,
    });

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

    // Check expected tools are present (C3L v0.5 format: domain name without prefix)
    const expectedTools = ["git", "meta"];
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
      logger.debug("registry.json not found", { registryPath });
    } else {
      throw error;
    }
  }
});

// Test loadMCPConfig() loads registry_config.json from project directory
Deno.test("loadMCPConfig loads config from project directory", async () => {
  const tempDir = await createTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Create the directory structure loadMCPConfig() expects
    const configDir = `${tempDir}/.agent/climpt/config`;
    await Deno.mkdir(configDir, { recursive: true });

    const testConfig = {
      registries: {
        "test-agent": ".agent/test-agent/registry.json",
      },
    };
    await Deno.writeTextFile(
      `${configDir}/registry_config.json`,
      JSON.stringify(testConfig, null, 2),
    );

    Deno.chdir(tempDir);

    const config = await loadMCPConfig();
    logger.debug("loadMCPConfig result", { config });

    assertEquals(
      config.registries["test-agent"],
      ".agent/test-agent/registry.json",
      "Should load the test-agent registry path from config",
    );
  } finally {
    Deno.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  }
});

// Test loadMCPConfig() returns default config when no config file exists
Deno.test("loadMCPConfig falls back to defaults when no config exists", async () => {
  const tempDir = await createTempDir();
  const originalCwd = Deno.cwd();
  const originalHome = Deno.env.get("HOME");

  try {
    // Point HOME to empty temp dir so home fallback also misses
    Deno.env.set("HOME", tempDir);
    Deno.chdir(tempDir);

    const config = await loadMCPConfig();
    logger.debug("default config result", { config });

    assertEquals(
      config.registries,
      DEFAULT_MCP_CONFIG.registries,
      "Should return default registries when no config file found",
    );
  } finally {
    Deno.chdir(originalCwd);
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    await cleanupTempDir(tempDir);
  }
});

// Test loadMCPConfig() discovers config from project .agent/climpt/config/
Deno.test("loadMCPConfig discovers local config files correctly", async () => {
  const tempDir = await createTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Create .agent/climpt/config directory structure
    const configDir = `${tempDir}/.agent/climpt/config`;
    await Deno.mkdir(configDir, { recursive: true });

    const testConfig = {
      registries: {
        "local-agent": ".agent/local-agent/registry.json",
        "another-agent": ".agent/another-agent/registry.json",
      },
    };

    await Deno.writeTextFile(
      `${configDir}/registry_config.json`,
      JSON.stringify(testConfig, null, 2),
    );

    Deno.chdir(tempDir);

    const config = await loadMCPConfig();
    assertEquals(
      config.registries["local-agent"],
      ".agent/local-agent/registry.json",
    );
    assertEquals(
      config.registries["another-agent"],
      ".agent/another-agent/registry.json",
    );
  } finally {
    Deno.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  }
});

// Test loadMCPConfig() falls back to home directory config
Deno.test("loadMCPConfig falls back to home directory", async () => {
  const tempWorkDir = await createTempDir();
  const tempHomeDir = await createTempDir();
  const originalCwd = Deno.cwd();
  const originalHome = Deno.env.get("HOME");

  try {
    Deno.env.set("HOME", tempHomeDir);

    // Create config in home directory only (no project config)
    const homeConfigDir = `${tempHomeDir}/.agent/climpt/config`;
    await Deno.mkdir(homeConfigDir, { recursive: true });

    const homeConfig = {
      registries: {
        "home-agent": ".agent/home-agent/registry.json",
      },
    };

    await Deno.writeTextFile(
      `${homeConfigDir}/registry_config.json`,
      JSON.stringify(homeConfig, null, 2),
    );

    // chdir to a directory with no project config
    Deno.chdir(tempWorkDir);

    const config = await loadMCPConfig();
    logger.debug("home fallback result", { config });

    assertEquals(
      config.registries["home-agent"],
      ".agent/home-agent/registry.json",
      "Should load config from home directory when project config absent",
    );
  } finally {
    Deno.chdir(originalCwd);
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    await cleanupTempDir(tempWorkDir);
    await cleanupTempDir(tempHomeDir);
  }
});

// Test config loading priority: project dir > home dir > defaults
Deno.test("loadMCPConfig follows correct priority order", async () => {
  const tempWorkDir = await createTempDir();
  const tempHomeDir = await createTempDir();
  const originalCwd = Deno.cwd();
  const originalHome = Deno.env.get("HOME");

  try {
    Deno.env.set("HOME", tempHomeDir);

    // Create config in home directory
    const homeConfigDir = `${tempHomeDir}/.agent/climpt/config`;
    await Deno.mkdir(homeConfigDir, { recursive: true });
    await Deno.writeTextFile(
      `${homeConfigDir}/registry_config.json`,
      JSON.stringify(
        {
          registries: { "home-agent": "home-registry.json" },
        },
        null,
        2,
      ),
    );

    // Create config in project directory (should take priority)
    const workConfigDir = `${tempWorkDir}/.agent/climpt/config`;
    await Deno.mkdir(workConfigDir, { recursive: true });
    await Deno.writeTextFile(
      `${workConfigDir}/registry_config.json`,
      JSON.stringify(
        {
          registries: { "project-agent": "project-registry.json" },
        },
        null,
        2,
      ),
    );

    Deno.chdir(tempWorkDir);

    const config = await loadMCPConfig();

    // Project config should win
    assertEquals(
      config.registries["project-agent"],
      "project-registry.json",
      "Project directory config should take priority over home",
    );
    assertEquals(
      config.registries["home-agent"],
      undefined,
      "Home config should not be loaded when project config exists",
    );
  } finally {
    Deno.chdir(originalCwd);
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    await cleanupTempDir(tempWorkDir);
    await cleanupTempDir(tempHomeDir);
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

        // Check c1 is a valid domain (C3L v0.5 format: domain name without prefix)
        const validDomains = ["git", "meta", "test"];
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
      logger.debug("registry.json not found for command structure test", {
        registryPath,
      });
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
