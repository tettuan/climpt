/**
 * Tests for malformed JSON handling in the config loader.
 *
 * Scope:
 * 1. loadRaw() with syntactically invalid agent.json throws ConfigError (AC-SERVICE-002)
 *    whose message contains the file path.
 * 2. validatePaths() with runner.flow.prompts.registry configured but the file
 *    absent reports the correct key in its error output.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { join } from "@std/path";
import { loadRaw } from "./loader.ts";
import { ConfigError } from "../shared/errors/config-errors.ts";
import { validatePaths } from "./path-validator.ts";
import type { AgentDefinition } from "../src_common/types.ts";

const logger = new BreakdownLogger("config");

// =============================================================================
// Helpers
// =============================================================================

/**
 * Minimal AgentDefinition with runner.flow.prompts.registry populated.
 * The registry value points to a file that will NOT exist in the test.
 */
function definitionWithRegistry(): AgentDefinition {
  return {
    version: "1.0.0",
    name: "test-agent",
    displayName: "Test Agent",
    description: "Test agent for loader error tests",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "system.md",
        prompts: {
          registry: "steps_registry.json",
          fallbackDir: "prompts",
        },
      },
      verdict: {
        type: "count:iteration",
        config: { maxIterations: 3 },
      },
    },
  };
}

// =============================================================================
// Test 1: Syntactically invalid agent.json -> thrown error contains file path
// =============================================================================

Deno.test("loadRaw - invalid JSON throws ConfigError (AC-SERVICE-002) containing file path", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    // Write syntactically invalid JSON as agent.json
    const agentJsonPath = join(tempDir, "agent.json");
    await Deno.writeTextFile(agentJsonPath, "{ not valid json!!!");

    logger.debug("loadRaw with invalid JSON", { agentDir: tempDir });

    const error = await assertRejects(
      async () => {
        await loadRaw(tempDir);
      },
      ConfigError,
    ) as ConfigError;

    // The error code must be AC-SERVICE-002 (invalid JSON)
    assertEquals(
      error.code,
      "AC-SERVICE-002",
      `Expected error.code to be "AC-SERVICE-002", got: "${error.code}"`,
    );

    // The error message must contain the file path so callers can locate the problem
    assertEquals(
      error.message.includes(agentJsonPath),
      true,
      `Expected error message to contain "${agentJsonPath}", got: "${error.message}"`,
    );

    // The configFile property must be set to "agent.json"
    assertEquals(
      error.configFile,
      "agent.json",
      `Expected error.configFile to equal "agent.json", got: "${error.configFile}"`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test 2: runner.flow.prompts.registry configured but file absent
//         -> validatePaths() reports the right key
// =============================================================================

Deno.test("validatePaths - absent registry file reports runner.flow.prompts.registry key", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    // Create only the files that are NOT the registry:
    // system.md (satisfies systemPromptPath) and prompts/ (satisfies fallbackDir)
    await Deno.writeTextFile(join(tempDir, "system.md"), "# System");
    await Deno.mkdir(join(tempDir, "prompts"), { recursive: true });
    // Deliberately do NOT create steps_registry.json

    const def = definitionWithRegistry();

    logger.debug("validatePaths with missing registry file", {
      agentDir: tempDir,
    });
    const result = await validatePaths(def, tempDir);

    // Must be invalid
    assertEquals(result.valid, false, "Expected validation to fail");

    // Exactly one error about the registry path
    const registryErrors = result.errors.filter((e) =>
      e.includes("runner.flow.prompts.registry")
    );
    assertEquals(
      registryErrors.length,
      1,
      `Expected exactly 1 error mentioning runner.flow.prompts.registry, got ${registryErrors.length}: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
