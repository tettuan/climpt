/**
 * Tests for agents/config/loader.ts
 *
 * Covers loadRaw(), loadStepsRegistry(), and getAgentDir().
 * Uses real temp directories with JSON files for integration tests.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { join } from "@std/path";
import {
  ConfigurationLoadError,
  getAgentDir,
  loadRaw,
  loadStepsRegistry,
} from "./loader.ts";

const logger = new BreakdownLogger("config-loader");

// =============================================================================
// getAgentDir Tests
// =============================================================================

Deno.test("config/loader - getAgentDir constructs correct path", () => {
  logger.debug("getAgentDir input", {
    agentName: "iterator",
    baseDir: "/home/user/project",
  });
  const result = getAgentDir("iterator", "/home/user/project");
  logger.debug("getAgentDir result", { result });

  assertEquals(result, "/home/user/project/.agent/iterator");
});

Deno.test("config/loader - getAgentDir handles nested agent names", () => {
  const result = getAgentDir("my-agent", "/workspace");

  assertEquals(result, "/workspace/.agent/my-agent");
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
    ConfigurationLoadError,
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

    assertEquals(result !== null, true);
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
