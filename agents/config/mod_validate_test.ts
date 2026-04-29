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
        },
      },
      verdict: {
        type: "count:iteration",
        config: {
          maxIterations: 3,
        },
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
      "count:iteration": {
        initial: "initial.default",
        continuation: "continuation.default",
      },
    },
    steps: {
      "initial.default": {
        stepId: "initial.default",
        name: "Initial Step",
        kind: "work",
        address: {
          c1: "steps",
          c2: "initial",
          c3: "default",
          edition: "default",
        },
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
        kind: "work",
        address: {
          c1: "steps",
          c2: "continuation",
          c3: "default",
          edition: "default",
        },
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
        kind: "closure",
        address: {
          c1: "steps",
          c2: "closure",
          c3: "default",
          edition: "default",
        },
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

  // Breakdown config files for config-registry validator
  // The registry uses agentId="test-agent", c1="steps", so the config
  // files are test-agent-steps-app.yml and test-agent-steps-user.yml.
  const configDir = join(baseDir, ".agent", "climpt", "config");
  await Deno.mkdir(configDir, { recursive: true });
  await Deno.writeTextFile(
    join(configDir, "test-agent-steps-app.yml"),
    'working_dir: ".agent/test-agent"\napp_prompt:\n  base_dir: "prompts/steps"\napp_schema:\n  base_dir: "schema/steps"\n',
  );
  await Deno.writeTextFile(
    join(configDir, "test-agent-steps-user.yml"),
    'params:\n  two:\n    directiveType:\n      pattern: "^(initial|continuation|closure)$"\n    layerType:\n      pattern: "^(default)$"\n',
  );

  // C3L prompt files for each step in the registry
  const registry = minimalValidRegistry();
  const steps = registry.steps as Record<
    string,
    {
      address: { c1: "steps"; c2: string; c3: string; edition: string };
    }
  >;
  for (const step of Object.values(steps)) {
    const c3lDir = join(
      promptsDir,
      "steps",
      step.address.c2,
      step.address.c3,
    );
    await Deno.mkdir(c3lDir, { recursive: true });
    await Deno.writeTextFile(
      join(c3lDir, `f_${step.address.edition}.md`),
      `# ${step.address.c2}.${step.address.c3} prompt`,
    );
  }

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
      `stepRegistryValidation should be valid, got entries: ${
        JSON.stringify(result.stepRegistryValidation!.entries)
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
        "count:iteration": {
          initial: "initial.default",
          continuation: "initial.default",
        },
      },
      steps: {
        "initial.default": {
          stepId: "initial.default",
          name: "Initial Step",
          kind: "work",
          address: {
            c1: "steps",
            c2: "initial",
            c3: "default",
            edition: "default",
          },
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
          kind: "closure",
          address: {
            c1: "steps",
            c2: "closure",
            c3: "default",
            edition: "default",
          },
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
    const allErrors = result.stepRegistryValidation!.entries
      .map((e) => e.message)
      .join("\n");
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
      `stepRegistryValidation should be valid for a correct registry, got entries: ${
        JSON.stringify(result.stepRegistryValidation!.entries)
      }`,
    );
    assertEquals(
      result.stepRegistryValidation!.entries.length,
      0,
      "stepRegistryValidation should have no entries for a valid registry",
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

// =============================================================================
// Test: Missing C3L prompt file causes path validation error
//
// When a step in steps_registry.json references c2/c3/edition but the
// corresponding C3L prompt file does not exist, pathResult must report an error.
// =============================================================================

Deno.test("validateFull - missing C3L prompt file reports path error", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    // Scaffold a valid agent dir (creates all C3L files)
    const agentDir = await scaffoldValidAgentDir(tempDir);

    // Delete ONE C3L file to simulate a missing prompt
    const missingPath = join(
      agentDir,
      "prompts",
      "steps",
      "continuation",
      "default",
      "f_default.md",
    );
    await Deno.remove(missingPath);

    const result = await validateFull("test-agent", tempDir);

    // Overall must be invalid
    assertEquals(
      result.valid,
      false,
      "Overall result should be invalid when a C3L prompt file is missing",
    );

    // pathResult must report the missing C3L file
    assertEquals(
      result.pathResult !== null,
      true,
      "pathResult should be present",
    );
    assertEquals(
      result.pathResult!.valid,
      false,
      `pathResult should be invalid, got errors: ${
        JSON.stringify(result.pathResult!.errors)
      }`,
    );

    const c3lError = result.pathResult!.errors.find((e) =>
      e.includes("C3L prompt file not found")
    );
    assertEquals(
      c3lError !== undefined,
      true,
      `Expected a C3L error, got errors: ${
        JSON.stringify(result.pathResult!.errors)
      }`,
    );
    assertStringIncludes(
      c3lError!,
      'steps["continuation.default"]',
      "Error should identify the step with missing C3L file",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test: Custom registry path - validateFull reads from the path specified in
// runner.flow.prompts.registry instead of the default steps_registry.json
// =============================================================================

Deno.test("validateFull - uses custom registry path from agent definition", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDir = join(tempDir, ".agent", "test-agent");
    await Deno.mkdir(agentDir, { recursive: true });

    // Create agent.json with a custom registry path
    const agentJson = minimalValidAgentJson();
    (agentJson.runner as Record<string, unknown>).flow = {
      ...((agentJson.runner as Record<string, unknown>).flow as Record<
        string,
        unknown
      >),
      prompts: {
        registry: "config/custom_registry.json",
      },
    };
    await Deno.writeTextFile(
      join(agentDir, "agent.json"),
      JSON.stringify(agentJson),
    );

    // Write the registry at the CUSTOM path only (NOT at steps_registry.json)
    const customRegistryDir = join(agentDir, "config");
    await Deno.mkdir(customRegistryDir, { recursive: true });
    await Deno.writeTextFile(
      join(customRegistryDir, "custom_registry.json"),
      JSON.stringify(minimalValidRegistry()),
    );

    // Write system prompt
    const promptsDir = join(agentDir, "prompts");
    await Deno.mkdir(promptsDir, { recursive: true });
    await Deno.writeTextFile(
      join(promptsDir, "system.md"),
      "# System prompt\nYou are a test agent.",
    );

    // Write C3L prompt files for each step
    const registry = minimalValidRegistry();
    const steps = registry.steps as Record<
      string,
      {
        address: { c1: "steps"; c2: string; c3: string; edition: string };
      }
    >;
    for (const step of Object.values(steps)) {
      const c3lDir = join(
        promptsDir,
        "steps",
        step.address.c2,
        step.address.c3,
      );
      await Deno.mkdir(c3lDir, { recursive: true });
      await Deno.writeTextFile(
        join(c3lDir, `f_${step.address.edition}.md`),
        `# ${step.address.c2}.${step.address.c3} prompt`,
      );
    }

    const result = await validateFull("test-agent", tempDir);

    // Registry must have been loaded from the custom path
    assertEquals(
      result.registrySchemaResult !== null,
      true,
      "registrySchemaResult should be present when custom registry path is used",
    );
    assertEquals(
      result.registrySchemaResult!.valid,
      true,
      `registrySchemaResult should be valid, got errors: ${
        JSON.stringify(result.registrySchemaResult!.errors)
      }`,
    );

    // Cross-reference validation should also have run
    assertEquals(
      result.crossRefResult !== null,
      true,
      "crossRefResult should be present when registry is loaded from custom path",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Test: Custom registry path - when the file does NOT exist at the custom
// path, the registry should be null (not found), not falling back to the
// default steps_registry.json
// =============================================================================

Deno.test("validateFull - custom registry path not found does not fall back to default", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const agentDir = join(tempDir, ".agent", "test-agent");
    await Deno.mkdir(agentDir, { recursive: true });

    // Create agent.json pointing to a non-existent custom registry
    const agentJson = minimalValidAgentJson();
    (agentJson.runner as Record<string, unknown>).flow = {
      ...((agentJson.runner as Record<string, unknown>).flow as Record<
        string,
        unknown
      >),
      prompts: {
        registry: "config/nonexistent_registry.json",
      },
    };
    await Deno.writeTextFile(
      join(agentDir, "agent.json"),
      JSON.stringify(agentJson),
    );

    // Write a valid registry at the DEFAULT path (steps_registry.json).
    // If the code incorrectly falls back, it would find this file.
    await Deno.writeTextFile(
      join(agentDir, "steps_registry.json"),
      JSON.stringify(minimalValidRegistry()),
    );

    const result = await validateFull("test-agent", tempDir);

    // The custom path does not exist, so registry should NOT have been loaded.
    // If it fell back to steps_registry.json, registrySchemaResult would be non-null.
    assertEquals(
      result.registrySchemaResult,
      null,
      "registrySchemaResult should be null when custom registry path does not exist, " +
        "even if steps_registry.json exists at the default location",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// T28 — R1/R2b parity: agentId mismatch (SR-LOAD-002)
//
// The boot loader (`agents/common/step-registry/loader.ts:69-71`) throws
// SR-LOAD-002 when `registry.agentId` ≠ requested agent name. The
// `--validate` CLI accumulator must surface the same failure so authors
// see it before runtime.
// =============================================================================

Deno.test(
  "validateFull - reports agentId mismatch as SR-LOAD-002 (R1/R2b parity)",
  async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      const agentDir = join(tempDir, ".agent", "test-agent");
      await Deno.mkdir(agentDir, { recursive: true });

      // Valid agent.json named "test-agent"
      await Deno.writeTextFile(
        join(agentDir, "agent.json"),
        JSON.stringify(minimalValidAgentJson()),
      );

      // Registry whose agentId is intentionally wrong
      const wrongIdRegistry = minimalValidRegistry();
      wrongIdRegistry.agentId = "other-agent";
      await Deno.writeTextFile(
        join(agentDir, "steps_registry.json"),
        JSON.stringify(wrongIdRegistry),
      );

      // Minimal system prompt so unrelated validators don't dominate the
      // failure list.
      const promptsDir = join(agentDir, "prompts");
      await Deno.mkdir(promptsDir, { recursive: true });
      await Deno.writeTextFile(join(promptsDir, "system.md"), "# system");

      const result = await validateFull("test-agent", tempDir);

      assertEquals(
        result.valid,
        false,
        "Overall result must be invalid when agentId does not match (loader contract)",
      );
      assertEquals(result.stepRegistryValidation !== null, true);

      const entry = result.stepRegistryValidation!.entries.find(
        (e) => e.code === "SR-LOAD-002",
      );
      assertEquals(
        entry !== undefined,
        true,
        `Expected an SR-LOAD-002 entry in step-registry validation, got: ${
          JSON.stringify(result.stepRegistryValidation!.entries)
        }`,
      );
      // Code/details are preserved (T28 N6): the entry carries
      // structured detail beyond the message string.
      assertEquals(entry!.details !== null, true);
      assertEquals(
        (entry!.details as { configFile?: string }).configFile,
        "steps_registry.json",
        "ConfigError.configFile must round-trip through the accumulator",
      );
      assertStringIncludes(
        entry!.message,
        'expected "test-agent"',
        "Mismatch message must name the expected agent",
      );
      assertStringIncludes(
        entry!.message,
        'got "other-agent"',
        "Mismatch message must name the offending agent",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

// =============================================================================
// T28 — R1/R2b parity: validateIntentSchemaEnums runs when schemas/ exists
//
// loader.ts:92-95 calls validateIntentSchemaEnums when a schemasDir is
// supplied. The `--validate` CLI must do the same: when the agent ships
// a `schemas/` directory, schema-enum drift must surface here.
// =============================================================================

Deno.test(
  "validateFull - reports intent schema enum drift via SR-VALID-003 (R1/R2b parity)",
  async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      const agentDir = join(tempDir, ".agent", "test-agent");
      await Deno.mkdir(agentDir, { recursive: true });

      await Deno.writeTextFile(
        join(agentDir, "agent.json"),
        JSON.stringify(minimalValidAgentJson()),
      );

      const promptsDir = join(agentDir, "prompts");
      await Deno.mkdir(promptsDir, { recursive: true });
      await Deno.writeTextFile(join(promptsDir, "system.md"), "# system");

      // Registry with a structured-gate step pointing at a schema that
      // declares an enum SUPERSET (drift) — schema has ["next", "repeat",
      // "extra"] but allowedIntents is ["next", "repeat"]. The validator
      // rejects superset drift.
      const driftRegistry = {
        agentId: "test-agent",
        version: "1.0.0",
        c1: "steps",
        entryStepMapping: {
          "count:iteration": {
            initial: "initial.default",
            continuation: "initial.default",
          },
        },
        steps: {
          "initial.default": {
            stepId: "initial.default",
            name: "Initial Step",
            kind: "work",
            address: {
              c1: "steps",
              c2: "initial",
              c3: "default",
              edition: "default",
            },
            uvVariables: [],
            usesStdin: false,
            outputSchemaRef: {
              file: "step_outputs.schema.json",
              schema: "#/definitions/initial.default",
            },
            structuredGate: {
              allowedIntents: ["next", "handoff"],
              intentField: "next_action.action",
              intentSchemaRef: "#/properties/next_action/properties/action",
            },
            transitions: {
              next: { target: "closure.default" },
              handoff: { target: "closure.default" },
            },
          },
          "closure.default": {
            stepId: "closure.default",
            name: "Closure Step",
            kind: "closure",
            address: {
              c1: "steps",
              c2: "closure",
              c3: "default",
              edition: "default",
            },
            uvVariables: [],
            usesStdin: false,
            transitions: { closing: { target: null } },
          },
        },
      };
      await Deno.writeTextFile(
        join(agentDir, "steps_registry.json"),
        JSON.stringify(driftRegistry),
      );

      // Schema in `<agentDir>/schemas/` whose enum drifts from
      // allowedIntents (extra value).
      const schemasDir = join(agentDir, "schemas");
      await Deno.mkdir(schemasDir, { recursive: true });
      const driftSchema = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        definitions: {
          "initial.default": {
            type: "object",
            properties: {
              next_action: {
                type: "object",
                properties: {
                  action: { enum: ["next", "handoff", "drift"] },
                },
              },
            },
          },
        },
      };
      await Deno.writeTextFile(
        join(schemasDir, "step_outputs.schema.json"),
        JSON.stringify(driftSchema),
      );

      const result = await validateFull("test-agent", tempDir);

      assertEquals(result.stepRegistryValidation !== null, true);
      const entry = result.stepRegistryValidation!.entries.find(
        (e) => e.code === "SR-VALID-003",
      );
      assertEquals(
        entry !== undefined,
        true,
        `Expected SR-VALID-003 (schema enum drift), got entries: ${
          JSON.stringify(result.stepRegistryValidation!.entries)
        }`,
      );
      assertStringIncludes(
        entry!.message,
        "drift",
        "Drift detail must name the offending enum value",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

// =============================================================================
// T28 — Accumulator preserves ConfigError (code, details)
//
// Resolves critique-5 N6: the previous accumulator collapsed
// ConfigError to `error.message` only. The new shape
// (StepRegistryValidationEntry) carries code + details structurally.
// =============================================================================

Deno.test(
  "validateFull - accumulator preserves ConfigError code and details",
  async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      const agentDir = join(tempDir, ".agent", "test-agent");
      await Deno.mkdir(agentDir, { recursive: true });

      await Deno.writeTextFile(
        join(agentDir, "agent.json"),
        JSON.stringify(minimalValidAgentJson()),
      );

      const promptsDir = join(agentDir, "prompts");
      await Deno.mkdir(promptsDir, { recursive: true });
      await Deno.writeTextFile(join(promptsDir, "system.md"), "# system");

      // Registry with stepKind/intent mismatch — surfaces as SR-VALID-001
      // ConfigError via validateStepKindIntents.
      const badRegistry = {
        agentId: "test-agent",
        version: "1.0.0",
        c1: "steps",
        entryStepMapping: {
          "count:iteration": {
            initial: "initial.default",
            continuation: "initial.default",
          },
        },
        steps: {
          "initial.default": {
            stepId: "initial.default",
            name: "Initial Step",
            kind: "work",
            address: {
              c1: "steps",
              c2: "initial",
              c3: "default",
              edition: "default",
            },
            uvVariables: [],
            usesStdin: false,
            structuredGate: {
              allowedIntents: ["next", "closing"], // closing illegal on work
              intentField: "next_action.action",
              intentSchemaRef: "#/properties/next_action/properties/action",
            },
            transitions: {
              next: { target: "closure.default" },
              closing: { target: null },
            },
          },
          "closure.default": {
            stepId: "closure.default",
            name: "Closure Step",
            kind: "closure",
            address: {
              c1: "steps",
              c2: "closure",
              c3: "default",
              edition: "default",
            },
            uvVariables: [],
            usesStdin: false,
            transitions: { closing: { target: null } },
          },
        },
      };
      await Deno.writeTextFile(
        join(agentDir, "steps_registry.json"),
        JSON.stringify(badRegistry),
      );

      const result = await validateFull("test-agent", tempDir);

      assertEquals(result.stepRegistryValidation !== null, true);
      const entries = result.stepRegistryValidation!.entries;

      // Every ConfigError-derived entry must have a non-OPAQUE code, a
      // non-empty message, and structured details that include
      // configFile (proving toJSON survived).
      const configErrorEntries = entries.filter(
        (e) => e.code !== "STEP-REG-OPAQUE",
      );
      assertEquals(
        configErrorEntries.length > 0,
        true,
        `Expected at least one ConfigError-derived entry, got: ${
          JSON.stringify(entries)
        }`,
      );
      for (const entry of configErrorEntries) {
        assertEquals(
          entry.code.length > 0,
          true,
          `Entry code must be non-empty, got: ${JSON.stringify(entry)}`,
        );
        assertEquals(
          entry.message.length > 0,
          true,
          `Entry message must be non-empty, got: ${JSON.stringify(entry)}`,
        );
        assertEquals(
          entry.details !== null,
          true,
          `Entry details must be preserved (T28 N6 fix), got: ${
            JSON.stringify(entry)
          }`,
        );
        const details = entry.details as Record<string, unknown>;
        assertEquals(
          details.configFile,
          "steps_registry.json",
          `details.configFile must round-trip; entry: ${JSON.stringify(entry)}`,
        );
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
