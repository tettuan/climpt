/**
 * Tests for validateFull() in agents/config/mod.ts
 *
 * Coverage:
 * - Happy path: all sub-validators return valid when given correct fixtures
 * - Registry error handling: corrupt registry JSON vs. missing registry
 * - Agent JSON parse failure: corrupt agent.json throws ConfigError
 * - Agent JSON not found: missing agent.json throws ConfigError
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
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
// Helper: minimal valid steps_registry.json
//
// Contains one work step (initial.default) that transitions to a continuation
// step (continuation.default) via "next", and the continuation step transitions
// to a closure step (closure.default) via "handoff".  This satisfies P2-3
// boundary rules: work "next" targets work/verification only; work "handoff"
// targets closure only.  An entryStepMapping is included so the flow validator
// can trace from the entry point through to closure.
// =============================================================================

function minimalValidRegistry(): Record<string, unknown> {
  return {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    entryStepMapping: {
      "count:iteration": "initial.default",
    },
    steps: {
      "initial.default": {
        stepId: "initial.default",
        name: "Initial Step",
        stepKind: "work",
        c2: "initial",
        c3: "default",
        edition: "default",
        fallbackKey: "initial_issue",
        uvVariables: [],
        usesStdin: false,
        transitions: {
          next: { target: "continuation.default" },
          repeat: { target: "initial.default" },
        },
      },
      "continuation.default": {
        stepId: "continuation.default",
        name: "Continuation Step",
        stepKind: "work",
        c2: "continuation",
        c3: "default",
        edition: "default",
        fallbackKey: "continuation_default",
        uvVariables: [],
        usesStdin: false,
        transitions: {
          next: { target: "continuation.default" },
          repeat: { target: "continuation.default" },
          handoff: { target: "closure.default" },
        },
      },
      "closure.default": {
        stepId: "closure.default",
        name: "Closure Step",
        stepKind: "closure",
        c2: "closure",
        c3: "default",
        edition: "default",
        fallbackKey: "review_closure_default",
        uvVariables: [],
        usesStdin: false,
        transitions: {
          closing: { target: null },
          repeat: { target: "closure.default" },
        },
      },
    },
  };
}

// =============================================================================
// Helper: scaffold a complete valid agent directory on disk
//
// Creates the agent.json, steps_registry.json, system prompt file, and
// fallback directory so that all path-based validators also pass.
// =============================================================================

async function scaffoldValidAgentDir(baseDir: string): Promise<string> {
  const agentDir = join(baseDir, ".agent", "test-agent");
  await Deno.mkdir(agentDir, { recursive: true });

  // agent.json
  await Deno.writeTextFile(
    join(agentDir, "agent.json"),
    JSON.stringify(minimalValidAgentJson()),
  );

  // steps_registry.json
  await Deno.writeTextFile(
    join(agentDir, "steps_registry.json"),
    JSON.stringify(minimalValidRegistry()),
  );

  // system prompt file referenced by systemPromptPath
  const promptsDir = join(agentDir, "prompts");
  await Deno.mkdir(promptsDir, { recursive: true });
  await Deno.writeTextFile(
    join(promptsDir, "system.md"),
    "# System prompt\nYou are a test agent.",
  );

  return agentDir;
}

// =============================================================================
// Test: Happy path - all sub-results valid
// =============================================================================

Deno.test("validateFull - happy path returns all sub-results as valid", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    await scaffoldValidAgentDir(tempDir);

    const result = await validateFull("test-agent", tempDir);

    // Top-level aggregation
    assertEquals(
      result.valid,
      true,
      "Overall result should be valid for a correct fixture",
    );

    // Agent schema validation
    assertEquals(
      result.agentSchemaResult.valid,
      true,
      `agentSchemaResult should be valid, got errors: ${
        JSON.stringify(result.agentSchemaResult.errors)
      }`,
    );

    // Agent config-level validation (validate + validateComplete)
    assertEquals(
      result.agentConfigResult.valid,
      true,
      `agentConfigResult should be valid, got errors: ${
        JSON.stringify(result.agentConfigResult.errors)
      }`,
    );

    // Registry schema validation (registry is present)
    assertEquals(result.registrySchemaResult !== null, true);
    assertEquals(
      result.registrySchemaResult!.valid,
      true,
      `registrySchemaResult should be valid, got errors: ${
        JSON.stringify(result.registrySchemaResult!.errors)
      }`,
    );

    // Cross-reference validation (registry is present)
    assertEquals(result.crossRefResult !== null, true);
    assertEquals(
      result.crossRefResult!.valid,
      true,
      `crossRefResult should be valid, got errors: ${
        JSON.stringify(result.crossRefResult!.errors)
      }`,
    );

    // Path validation
    assertEquals(result.pathResult !== null, true);
    assertEquals(
      result.pathResult!.valid,
      true,
      `pathResult should be valid, got errors: ${
        JSON.stringify(result.pathResult!.errors)
      }`,
    );

    // Flow reachability validation (registry is present)
    assertEquals(result.flowResult !== null, true);
    assertEquals(
      result.flowResult!.valid,
      true,
      `flowResult should be valid, got errors: ${
        JSON.stringify(result.flowResult!.errors)
      }`,
    );

    // Prompt resolution validation (registry is present)
    assertEquals(result.promptResult !== null, true);
    assertEquals(
      result.promptResult!.valid,
      true,
      `promptResult should be valid, got errors: ${
        JSON.stringify(result.promptResult!.errors)
      }`,
    );

    // UV reachability validation (registry is present)
    assertEquals(result.uvReachabilityResult !== null, true);
    assertEquals(
      result.uvReachabilityResult!.valid,
      true,
      `uvReachabilityResult should be valid, got errors: ${
        JSON.stringify(result.uvReachabilityResult!.errors)
      }`,
    );

    // Template UV consistency validation (registry is present)
    assertEquals(result.templateUvResult !== null, true);
    assertEquals(
      result.templateUvResult!.valid,
      true,
      `templateUvResult should be valid, got errors: ${
        JSON.stringify(result.templateUvResult!.errors)
      }`,
    );

    // Typed step-registry validation (registry is present)
    assertEquals(result.stepRegistryValidation !== null, true);
    assertEquals(
      result.stepRegistryValidation!.valid,
      true,
      `stepRegistryValidation should be valid, got errors: ${
        JSON.stringify(result.stepRegistryValidation!.errors)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test: Corrupt registry JSON reports error
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
    assertStringIncludes(
      errorMsg,
      "Failed to load steps_registry.json",
      `Expected error about loading failure, got: ${errorMsg}`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test: Missing registry is not an error
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

// =============================================================================
// Test: Corrupt agent.json throws ConfigError (AC-SERVICE-002)
//
// loadRaw() is called outside the registry try/catch in validateFull(),
// so a corrupt agent.json propagates as a thrown ConfigError.
// =============================================================================

Deno.test("validateFull - corrupt agent.json throws ConfigError", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDir = join(tempDir, ".agent", "test-agent");
    await Deno.mkdir(agentDir, { recursive: true });

    // Write corrupt agent.json (invalid JSON)
    await Deno.writeTextFile(
      join(agentDir, "agent.json"),
      "{ this is not valid json",
    );

    const err = await assertRejects(
      () => validateFull("test-agent", tempDir),
      Error,
    );

    // The thrown error should identify the invalid JSON
    assertStringIncludes(
      err.message,
      "AC-SERVICE-002",
      `Expected error code AC-SERVICE-002 for invalid JSON, got: ${err.message}`,
    );
    assertStringIncludes(
      err.message,
      "Invalid JSON",
      `Expected 'Invalid JSON' in error message, got: ${err.message}`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test: Missing agent.json throws ConfigError (AC-SERVICE-001)
//
// When the agent directory exists but agent.json is absent, loadRaw()
// throws AC-SERVICE-001 (file not found).
// =============================================================================

Deno.test("validateFull - missing agent.json throws ConfigError", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDir = join(tempDir, ".agent", "test-agent");
    await Deno.mkdir(agentDir, { recursive: true });

    // No agent.json written — directory exists but file does not

    const err = await assertRejects(
      () => validateFull("test-agent", tempDir),
      Error,
    );

    // The thrown error should identify the missing file
    assertStringIncludes(
      err.message,
      "AC-SERVICE-001",
      `Expected error code AC-SERVICE-001 for missing file, got: ${err.message}`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test: stepRegistryValidation catches stepKind/intent mismatch
//
// A work step must not include "closing" in allowedIntents.
// The typed validator (validateStepKindIntents) should detect this.
// =============================================================================

Deno.test("validateFull - catches stepKind/intent mismatch via typed validators", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDir = join(tempDir, ".agent", "test-agent");
    await Deno.mkdir(agentDir, { recursive: true });

    // Write valid agent.json
    await Deno.writeTextFile(
      join(agentDir, "agent.json"),
      JSON.stringify(minimalValidAgentJson()),
    );

    // Write system prompt
    const promptsDir = join(agentDir, "prompts");
    await Deno.mkdir(promptsDir, { recursive: true });
    await Deno.writeTextFile(
      join(promptsDir, "system.md"),
      "# System prompt",
    );

    // Write a registry where a work step has "closing" in allowedIntents.
    // "closing" is only valid for closure steps, not work steps.
    const badRegistry = {
      agentId: "test-agent",
      version: "1.0.0",
      c1: "steps",
      entryStepMapping: {
        "count:iteration": "initial.default",
      },
      steps: {
        "initial.default": {
          stepId: "initial.default",
          name: "Initial Step",
          stepKind: "work",
          c2: "initial",
          c3: "default",
          edition: "default",
          fallbackKey: "initial_default",
          uvVariables: [],
          usesStdin: false,
          structuredGate: {
            allowedIntents: ["next", "closing"],
            intentSchemaRef: "#/properties/next_action/properties/action",
            intentField: "next_action.action",
          },
          transitions: {
            next: { target: "closure.default" },
            closing: { target: null },
          },
        },
        "closure.default": {
          stepId: "closure.default",
          name: "Closure Step",
          stepKind: "closure",
          c2: "closure",
          c3: "default",
          edition: "default",
          fallbackKey: "closure_default",
          uvVariables: [],
          usesStdin: false,
          transitions: {
            closing: { target: null },
            repeat: { target: "closure.default" },
          },
        },
      },
    };

    await Deno.writeTextFile(
      join(agentDir, "steps_registry.json"),
      JSON.stringify(badRegistry),
    );

    const result = await validateFull("test-agent", tempDir);

    // Overall result must be invalid
    assertEquals(
      result.valid,
      false,
      "Overall result should be invalid when a work step has 'closing' intent",
    );

    // stepRegistryValidation must be populated and invalid
    assertEquals(
      result.stepRegistryValidation !== null,
      true,
      "stepRegistryValidation should be present when registry exists",
    );
    assertEquals(
      result.stepRegistryValidation!.valid,
      false,
      "stepRegistryValidation should be invalid for stepKind/intent mismatch",
    );

    // Error message should mention the mismatch
    const allErrors = result.stepRegistryValidation!.errors.join("\n");
    assertStringIncludes(
      allErrors,
      "closing",
      `Expected error to mention 'closing' intent, got: ${allErrors}`,
    );
    assertStringIncludes(
      allErrors,
      "work",
      `Expected error to mention 'work' stepKind, got: ${allErrors}`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test: stepRegistryValidation passes for valid registry
//
// The happy-path fixture has no structuredGate on steps, so the typed
// validators should all pass and produce stepRegistryValidation.valid = true.
// =============================================================================

Deno.test("validateFull - stepRegistryValidation passes for valid registry", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    await scaffoldValidAgentDir(tempDir);

    const result = await validateFull("test-agent", tempDir);

    // stepRegistryValidation must be populated and valid
    assertEquals(
      result.stepRegistryValidation !== null,
      true,
      "stepRegistryValidation should be present when registry exists",
    );
    assertEquals(
      result.stepRegistryValidation!.valid,
      true,
      `stepRegistryValidation should be valid for a correct registry, got errors: ${
        JSON.stringify(result.stepRegistryValidation!.errors)
      }`,
    );
    assertEquals(
      result.stepRegistryValidation!.errors.length,
      0,
      "stepRegistryValidation should have no errors for a valid registry",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test: stepRegistryValidation is null when registry is absent
// =============================================================================

Deno.test("validateFull - stepRegistryValidation is null when no registry", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDir = join(tempDir, ".agent", "test-agent");
    await Deno.mkdir(agentDir, { recursive: true });

    // Write valid agent.json only - no steps_registry.json
    await Deno.writeTextFile(
      join(agentDir, "agent.json"),
      JSON.stringify(minimalValidAgentJson()),
    );

    const result = await validateFull("test-agent", tempDir);

    assertEquals(
      result.stepRegistryValidation,
      null,
      "stepRegistryValidation should be null when registry file is absent",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
