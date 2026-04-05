/**
 * Tests for agents/config/loader.ts
 *
 * Covers loadRaw(), loadStepsRegistry(), and getAgentDir().
 * Uses real temp directories with JSON files for integration tests.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { join } from "@std/path";
import { getAgentDir, loadRaw, loadStepsRegistry } from "./loader.ts";
import { ConfigError } from "../shared/errors/config-errors.ts";

const logger = new BreakdownLogger("config-loader");

// Synthetic base directories for getAgentDir (pure path construction, no filesystem access)
const SAMPLE_BASE_DIR = "/home/user/project";
const SAMPLE_BASE_DIR_SHORT = "/workspace";

// =============================================================================
// getAgentDir Tests
// =============================================================================

Deno.test("config/loader - getAgentDir constructs correct path", () => {
  logger.debug("getAgentDir input", {
    agentName: "iterator",
    baseDir: SAMPLE_BASE_DIR,
  });
  const result = getAgentDir("iterator", SAMPLE_BASE_DIR);
  logger.debug("getAgentDir result", { result });

  assertEquals(result, `${SAMPLE_BASE_DIR}/.agent/iterator`);
});

Deno.test("config/loader - getAgentDir handles nested agent names", () => {
  const result = getAgentDir("my-agent", SAMPLE_BASE_DIR_SHORT);

  assertEquals(result, `${SAMPLE_BASE_DIR_SHORT}/.agent/my-agent`);
});

// =============================================================================
// loadRaw Tests
// =============================================================================

Deno.test("config/loader - loadRaw loads valid agent.json", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDef = {
      name: "test-agent",
      version: "1.0.0",
      description: "Test",
    };

    await Deno.writeTextFile(
      join(tempDir, "agent.json"),
      JSON.stringify(agentDef),
    );

    logger.debug("loadRaw input", { agentDir: tempDir });
    const result = await loadRaw(tempDir);
    logger.debug("loadRaw result", { result });

    assertEquals((result as Record<string, unknown>).name, "test-agent");
    assertEquals((result as Record<string, unknown>).version, "1.0.0");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("config/loader - loadRaw throws for non-existent directory", async () => {
  await assertRejects(
    async () => {
      await loadRaw("/tmp/claude/nonexistent-agent-dir-xyz");
    },
    ConfigError,
  );
});

// =============================================================================
// loadStepsRegistry Tests
// =============================================================================

Deno.test("config/loader - loadStepsRegistry loads valid registry", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const registry = {
      agentId: "test",
      version: "1.0.0",
      c1: "steps",
      steps: {
        "initial.test": {
          stepId: "initial.test",
          name: "Test",
        },
      },
    };

    await Deno.writeTextFile(
      join(tempDir, "steps_registry.json"),
      JSON.stringify(registry),
    );

    logger.debug("loadStepsRegistry input", { agentDir: tempDir });
    const result = await loadStepsRegistry(tempDir);
    logger.debug("loadStepsRegistry result", { hasResult: result !== null });

    assertExists(result);
    assertEquals((result as Record<string, unknown>).agentId, "test");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("config/loader - loadStepsRegistry returns null for missing file", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    // No steps_registry.json created
    const result = await loadStepsRegistry(tempDir);

    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
