/**
 * @fileoverview Tests for plugin-resolver module
 *
 * Tests plugin path resolution from Claude Code settings files.
 *
 * @module climpt-plugins/tests/plugin-resolver_test
 */

import { assertEquals } from "jsr:@std/assert";
import { join } from "jsr:@std/path@^1";

import {
  resolvePluginPaths,
  resolvePluginPathsSafe,
} from "../lib/plugin-resolver.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a temporary directory with mock settings files
 */
async function createMockSettingsDir(
  settings: Record<string, unknown>,
  filename = "settings.json",
): Promise<string> {
  const tempDir = await Deno.makeTempDir({ prefix: "plugin-resolver-test-" });
  const claudeDir = join(tempDir, ".claude");
  await Deno.mkdir(claudeDir, { recursive: true });
  await Deno.writeTextFile(
    join(claudeDir, filename),
    JSON.stringify(settings, null, 2),
  );
  return tempDir;
}

/**
 * Clean up temporary directory
 */
async function cleanup(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true });
}

// =============================================================================
// resolvePluginPaths Tests
// =============================================================================

Deno.test("resolvePluginPaths: returns empty array when no settings file exists", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "plugin-resolver-test-" });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins, []);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: returns empty array when settings has no enabledPlugins", async () => {
  const tempDir = await createMockSettingsDir({
    someOtherSetting: true,
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins, []);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: returns empty array when settings has no extraKnownMarketplaces", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "some-plugin@some-marketplace": true,
    },
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins, []);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: resolves directory source plugins", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "my-plugin@local-marketplace": true,
    },
    extraKnownMarketplaces: {
      "local-marketplace": {
        source: {
          source: "directory",
          path: "/path/to/plugins",
        },
      },
    },
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins.length, 1);
    assertEquals(plugins[0].type, "local");
    assertEquals(plugins[0].path, "/path/to/plugins/my-plugin");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: resolves file source plugins", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "file-plugin@file-marketplace": true,
    },
    extraKnownMarketplaces: {
      "file-marketplace": {
        source: {
          source: "file",
          path: "/path/to/file-plugins",
        },
      },
    },
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins.length, 1);
    assertEquals(plugins[0].path, "/path/to/file-plugins/file-plugin");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: skips disabled plugins", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "enabled-plugin@local": true,
      "disabled-plugin@local": false,
    },
    extraKnownMarketplaces: {
      local: {
        source: {
          source: "directory",
          path: "/plugins",
        },
      },
    },
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins.length, 1);
    assertEquals(plugins[0].path, "/plugins/enabled-plugin");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: skips climpt-marketplace (self-reference)", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "some-plugin@climpt-marketplace": true,
    },
    extraKnownMarketplaces: {
      "climpt-marketplace": {
        source: {
          source: "directory",
          path: "/climpt-plugins",
        },
      },
    },
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins, []);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: skips github/git/npm/url sources", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "github-plugin@gh": true,
      "npm-plugin@npm": true,
    },
    extraKnownMarketplaces: {
      gh: {
        source: {
          source: "github",
          owner: "user",
          repo: "repo",
        },
      },
      npm: {
        source: {
          source: "npm",
          package: "@scope/package",
        },
      },
    },
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins, []);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: deduplicates plugins by path", async () => {
  // Create both project and local settings with same plugin
  const tempDir = await Deno.makeTempDir({ prefix: "plugin-resolver-test-" });
  const claudeDir = join(tempDir, ".claude");
  await Deno.mkdir(claudeDir, { recursive: true });

  const settings = {
    enabledPlugins: {
      "same-plugin@local": true,
    },
    extraKnownMarketplaces: {
      local: {
        source: {
          source: "directory",
          path: "/plugins",
        },
      },
    },
  };

  // Write to both project and local settings
  await Deno.writeTextFile(
    join(claudeDir, "settings.json"),
    JSON.stringify(settings, null, 2),
  );
  await Deno.writeTextFile(
    join(claudeDir, "settings.local.json"),
    JSON.stringify(settings, null, 2),
  );

  try {
    const plugins = await resolvePluginPaths(tempDir);
    // Should deduplicate to single entry
    assertEquals(plugins.length, 1);
    assertEquals(plugins[0].path, "/plugins/same-plugin");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: handles multiple plugins from same marketplace", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "plugin-a@local": true,
      "plugin-b@local": true,
      "plugin-c@local": true,
    },
    extraKnownMarketplaces: {
      local: {
        source: {
          source: "directory",
          path: "/plugins",
        },
      },
    },
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins.length, 3);
    const paths = plugins.map((p) => p.path).sort();
    assertEquals(paths, [
      "/plugins/plugin-a",
      "/plugins/plugin-b",
      "/plugins/plugin-c",
    ]);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPaths: handles plugin with @ in name", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "@scope/plugin@local": true,
    },
    extraKnownMarketplaces: {
      local: {
        source: {
          source: "directory",
          path: "/plugins",
        },
      },
    },
  });

  try {
    const plugins = await resolvePluginPaths(tempDir);
    assertEquals(plugins.length, 1);
    assertEquals(plugins[0].path, "/plugins/@scope/plugin");
  } finally {
    await cleanup(tempDir);
  }
});

// =============================================================================
// resolvePluginPathsSafe Tests
// =============================================================================

Deno.test("resolvePluginPathsSafe: returns empty array on error", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "plugin-resolver-test-" });
  const claudeDir = join(tempDir, ".claude");
  await Deno.mkdir(claudeDir, { recursive: true });

  // Write invalid JSON
  await Deno.writeTextFile(join(claudeDir, "settings.json"), "{ invalid json");

  try {
    const plugins = await resolvePluginPathsSafe(tempDir);
    assertEquals(plugins, []);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("resolvePluginPathsSafe: works same as resolvePluginPaths on success", async () => {
  const tempDir = await createMockSettingsDir({
    enabledPlugins: {
      "test-plugin@local": true,
    },
    extraKnownMarketplaces: {
      local: {
        source: {
          source: "directory",
          path: "/test",
        },
      },
    },
  });

  try {
    const safe = await resolvePluginPathsSafe(tempDir);
    const unsafe = await resolvePluginPaths(tempDir);
    assertEquals(safe, unsafe);
  } finally {
    await cleanup(tempDir);
  }
});
