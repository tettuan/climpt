/**
 * Tests for validateFull() registry error handling in agents/config/mod.ts
 *
 * Covers the catch block that distinguishes Deno.errors.NotFound (silent)
 * from other errors (reported as registrySchemaResult).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { validateFull } from "./mod.ts";

// =============================================================================
// Helper: minimal valid agent.json
// =============================================================================

function minimalValidAgentJson(): Record<string, unknown> {
  return {
    version: "1.0.0",
    name: "test-agent",
    displayName: "Test Agent",
    description: "Test",
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: {
          registry: "steps_registry.json",
          fallbackDir: "prompts/",
        },
      },
      verdict: {
        type: "count:iteration",
        config: {
          maxIterations: 3,
        },
      },
      boundaries: {
        permissionMode: "default",
        allowedTools: ["Read", "Write"],
      },
    },
    parameters: {},
  };
}

// =============================================================================
// Test 1: Corrupt registry JSON reports error
// =============================================================================

Deno.test("validateFull - corrupt registry JSON reports error", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDir = join(tempDir, ".agent", "test-agent");
    await Deno.mkdir(agentDir, { recursive: true });

    // Write valid agent.json
    await Deno.writeTextFile(
      join(agentDir, "agent.json"),
      JSON.stringify(minimalValidAgentJson()),
    );

    // Write corrupt steps_registry.json (invalid JSON)
    await Deno.writeTextFile(
      join(agentDir, "steps_registry.json"),
      "{broken json",
    );

    const result = await validateFull("test-agent", tempDir);

    // registrySchemaResult must be populated (not null) with an error
    assertEquals(result.registrySchemaResult !== null, true);
    assertEquals(result.registrySchemaResult!.valid, false);
    assertEquals(result.registrySchemaResult!.errors.length > 0, true);

    // Error message should mention the loading failure
    const errorMsg = result.registrySchemaResult!.errors[0].message;
    assertEquals(
      errorMsg.includes("Failed to load steps_registry.json"),
      true,
      `Expected error about loading failure, got: ${errorMsg}`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test 2: Missing registry is not an error
// =============================================================================

Deno.test("validateFull - missing registry is not an error", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDir = join(tempDir, ".agent", "test-agent");
    await Deno.mkdir(agentDir, { recursive: true });

    // Write valid agent.json only — no steps_registry.json
    await Deno.writeTextFile(
      join(agentDir, "agent.json"),
      JSON.stringify(minimalValidAgentJson()),
    );

    const result = await validateFull("test-agent", tempDir);

    // Missing registry should not be reported as an error
    assertEquals(
      result.registrySchemaResult,
      null,
      "registrySchemaResult should be null when registry file is absent",
    );

    // Agent schema and config results should still be present
    assertEquals(result.agentSchemaResult !== null, true);
    assertEquals(result.agentConfigResult !== null, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
