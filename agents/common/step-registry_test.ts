/**
 * Step Registry Tests
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  addStepDefinition,
  createEmptyRegistry,
  getStepDefinition,
  getStepIds,
  hasStep,
  loadStepRegistry,
  type PromptStepDefinition,
  saveStepRegistry,
  serializeRegistry,
  type StepRegistry,
  type StructuredGate,
  validateIntentSchemaEnums,
  validateIntentSchemaRef,
  validateStepRegistry,
} from "./step-registry.ts";

Deno.test("createEmptyRegistry - creates valid empty registry", () => {
  const registry = createEmptyRegistry("test-agent");

  assertEquals(registry.agentId, "test-agent");
  assertEquals(registry.version, "1.0.0");
  assertEquals(registry.c1, "steps");
  assertEquals(registry.steps, {});
  assertEquals(registry.userPromptsBase, ".agent/test-agent/prompts");
});

Deno.test("createEmptyRegistry - accepts custom c1 and version", () => {
  const registry = createEmptyRegistry("test-agent", "custom", "2.0.0");

  assertEquals(registry.c1, "custom");
  assertEquals(registry.version, "2.0.0");
});

Deno.test("addStepDefinition - adds step to registry", () => {
  const registry = createEmptyRegistry("test-agent");
  const step: PromptStepDefinition = {
    stepId: "initial.test",
    name: "Initial Test Step",
    c2: "initial",
    c3: "test",
    edition: "default",
    fallbackKey: "initial_test",
    uvVariables: ["test_var"],
    usesStdin: false,
  };

  addStepDefinition(registry, step);

  assertEquals(registry.steps["initial.test"], step);
});

Deno.test("addStepDefinition - throws on duplicate step", () => {
  const registry = createEmptyRegistry("test-agent");
  const step: PromptStepDefinition = {
    stepId: "initial.test",
    name: "Initial Test Step",
    c2: "initial",
    c3: "test",
    edition: "default",
    fallbackKey: "initial_test",
    uvVariables: [],
    usesStdin: false,
  };

  addStepDefinition(registry, step);

  assertThrows(
    () => addStepDefinition(registry, step),
    Error,
    'Step "initial.test" already exists',
  );
});

Deno.test("getStepDefinition - returns step by ID", () => {
  const registry = createEmptyRegistry("test-agent");
  const step: PromptStepDefinition = {
    stepId: "initial.test",
    name: "Initial Test Step",
    c2: "initial",
    c3: "test",
    edition: "default",
    fallbackKey: "initial_test",
    uvVariables: [],
    usesStdin: false,
  };
  addStepDefinition(registry, step);

  const result = getStepDefinition(registry, "initial.test");

  assertEquals(result, step);
});

Deno.test("getStepDefinition - returns undefined for unknown step", () => {
  const registry = createEmptyRegistry("test-agent");

  const result = getStepDefinition(registry, "unknown.step");

  assertEquals(result, undefined);
});

Deno.test("getStepIds - returns all step IDs", () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "step1",
    name: "Step 1",
    c2: "initial",
    c3: "step1",
    edition: "default",
    fallbackKey: "step1",
    uvVariables: [],
    usesStdin: false,
  });
  addStepDefinition(registry, {
    stepId: "step2",
    name: "Step 2",
    c2: "initial",
    c3: "step2",
    edition: "default",
    fallbackKey: "step2",
    uvVariables: [],
    usesStdin: false,
  });

  const ids = getStepIds(registry);

  assertEquals(ids.sort(), ["step1", "step2"]);
});

Deno.test("hasStep - returns true for existing step", () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "existing",
    name: "Existing Step",
    c2: "initial",
    c3: "existing",
    edition: "default",
    fallbackKey: "existing",
    uvVariables: [],
    usesStdin: false,
  });

  assertEquals(hasStep(registry, "existing"), true);
  assertEquals(hasStep(registry, "nonexistent"), false);
});

Deno.test("validateStepRegistry - validates correct registry", () => {
  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.test": {
        stepId: "initial.test",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: ["var1"],
        usesStdin: true,
      },
    },
  };

  // Should not throw
  validateStepRegistry(registry);
});

Deno.test("validateStepRegistry - throws on missing agentId", () => {
  const registry = {
    agentId: "",
    version: "1.0.0",
    c1: "steps",
    steps: {},
  } as StepRegistry;

  assertThrows(
    () => validateStepRegistry(registry),
    Error,
    "agentId must be a non-empty string",
  );
});

Deno.test("validateStepRegistry - throws on missing c1", () => {
  const registry = {
    agentId: "test",
    version: "1.0.0",
    c1: "",
    steps: {},
  } as StepRegistry;

  assertThrows(
    () => validateStepRegistry(registry),
    Error,
    "c1 must be a non-empty string",
  );
});

Deno.test("validateStepRegistry - throws on stepId mismatch", () => {
  const registry: StepRegistry = {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "wrong.key": {
        stepId: "different.id",
        name: "Test",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
      },
    },
  };

  assertThrows(
    () => validateStepRegistry(registry),
    Error,
    'Step key "wrong.key" does not match stepId',
  );
});

Deno.test("serializeRegistry - produces valid JSON", () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "test",
    name: "Test",
    c2: "initial",
    c3: "test",
    edition: "default",
    fallbackKey: "test",
    uvVariables: [],
    usesStdin: false,
  });

  const json = serializeRegistry(registry);
  const parsed = JSON.parse(json);

  assertEquals(parsed.agentId, "test-agent");
  assertEquals(parsed.steps.test.name, "Test");
});

Deno.test("loadStepRegistry - loads from file", async () => {
  // Create a temporary registry file
  const tempDir = await Deno.makeTempDir();
  const registryPath = `${tempDir}/registry.json`;
  const registry: StepRegistry = {
    agentId: "temp-agent",
    version: "1.0.0",
    c1: "steps",
    entryStep: "test.step", // Required by validateEntryStepMapping
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
      },
    },
  };
  await Deno.writeTextFile(registryPath, JSON.stringify(registry));

  try {
    const loaded = await loadStepRegistry("temp-agent", tempDir, {
      registryPath,
    });

    assertEquals(loaded.agentId, "temp-agent");
    assertEquals(loaded.steps["test.step"].name, "Test Step");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("loadStepRegistry - throws on missing file", async () => {
  await assertRejects(
    () => loadStepRegistry("nonexistent", "/nonexistent/path"),
    Error,
    "Step registry not found",
  );
});

Deno.test("loadStepRegistry - throws on agentId mismatch", async () => {
  const tempDir = await Deno.makeTempDir();
  const registryPath = `${tempDir}/registry.json`;
  const registry: StepRegistry = {
    agentId: "different-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {},
  };
  await Deno.writeTextFile(registryPath, JSON.stringify(registry));

  try {
    await assertRejects(
      () =>
        loadStepRegistry("expected-agent", tempDir, {
          registryPath,
        }),
      Error,
      "Registry agentId mismatch",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("saveStepRegistry - saves to file", async () => {
  const tempDir = await Deno.makeTempDir();
  const filePath = `${tempDir}/saved-registry.json`;
  const registry = createEmptyRegistry("save-test");
  addStepDefinition(registry, {
    stepId: "saved",
    name: "Saved Step",
    c2: "initial",
    c3: "saved",
    edition: "default",
    fallbackKey: "saved",
    uvVariables: ["x"],
    usesStdin: true,
  });

  try {
    await saveStepRegistry(registry, filePath);

    const content = await Deno.readTextFile(filePath);
    const loaded = JSON.parse(content);

    assertEquals(loaded.agentId, "save-test");
    assertEquals(loaded.steps.saved.uvVariables, ["x"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// validateIntentSchemaRef Tests (Design Doc Section 4)
// =============================================================================

Deno.test("validateIntentSchemaRef - throws when structuredGate missing intentSchemaRef", () => {
  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        // Type assertion to test runtime validation of bad data
        structuredGate: {
          allowedIntents: ["next", "closing"],
          intentField: "status",
          // intentSchemaRef is missing - testing validation
        } as StructuredGate,
      },
    },
  };

  assertThrows(
    () => validateIntentSchemaRef(registry),
    Error,
    "missing required intentSchemaRef",
  );
});

Deno.test("validateIntentSchemaRef - passes when intentSchemaRef present", () => {
  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "closing"],
          intentField: "status",
          intentSchemaRef: "#/definitions/test.step/properties/status",
        },
      },
    },
  };

  // Should not throw
  validateIntentSchemaRef(registry);
});

Deno.test("validateIntentSchemaRef - passes when no structuredGate", () => {
  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        // No structuredGate - should pass
      },
    },
  };

  // Should not throw
  validateIntentSchemaRef(registry);
});

Deno.test("validateIntentSchemaRef - reports all missing intentSchemaRef steps", () => {
  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "step.one": {
        stepId: "step.one",
        name: "Step One",
        c2: "initial",
        c3: "one",
        edition: "default",
        fallbackKey: "one",
        uvVariables: [],
        usesStdin: false,
        // Type assertion to test runtime validation of bad data
        structuredGate: {
          allowedIntents: ["next"],
          intentField: "action",
        } as StructuredGate,
      },
      "step.two": {
        stepId: "step.two",
        name: "Step Two",
        c2: "continuation",
        c3: "two",
        edition: "default",
        fallbackKey: "two",
        uvVariables: [],
        usesStdin: false,
        // Type assertion to test runtime validation of bad data
        structuredGate: {
          allowedIntents: ["next", "closing"],
          intentField: "status",
        } as StructuredGate,
      },
    },
  };

  try {
    validateIntentSchemaRef(registry);
    throw new Error("Should have thrown");
  } catch (e) {
    if (e instanceof Error) {
      // Should mention both steps
      assertEquals(e.message.includes("step.one"), true);
      assertEquals(e.message.includes("step.two"), true);
    } else {
      throw e;
    }
  }
});

// =============================================================================
// Step Type Tests
// =============================================================================

Deno.test("StepDefinition - supports type field", () => {
  const step: PromptStepDefinition = {
    stepId: "test",
    name: "Test Step",
    type: "prompt",
    c2: "initial",
    c3: "test",
    edition: "default",
    fallbackKey: "test",
    uvVariables: [],
    usesStdin: false,
  };

  assertEquals(step.type, "prompt");
});

// =============================================================================
// intentSchemaRef Format Validation Tests
// =============================================================================

Deno.test("validateIntentSchemaRef - throws on external file reference", () => {
  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "closing"],
          intentField: "next_action.action",
          // External file reference - should be rejected
          intentSchemaRef:
            "common.schema.json#/$defs/nextAction/properties/action",
        },
      },
    },
  };

  assertThrows(
    () => validateIntentSchemaRef(registry),
    Error,
    'must be internal pointer starting with "#/"',
  );
});

Deno.test("validateIntentSchemaRef - throws on missing intentField", () => {
  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        // Type assertion to test runtime validation of bad data
        structuredGate: {
          allowedIntents: ["next"],
          // intentField is missing
          intentSchemaRef: "#/properties/next_action/properties/action",
        } as StructuredGate,
      },
    },
  };

  assertThrows(
    () => validateIntentSchemaRef(registry),
    Error,
    "missing required intentField",
  );
});

Deno.test("validateIntentSchemaRef - passes with valid internal pointer", () => {
  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef: "#/properties/next_action/properties/action",
        },
      },
    },
  };

  // Should not throw
  validateIntentSchemaRef(registry);
});

// =============================================================================
// validateIntentSchemaEnums Tests (Symmetric Validation)
// =============================================================================

Deno.test("validateIntentSchemaEnums - passes when enum matches allowedIntents exactly", async () => {
  const tempDir = await Deno.makeTempDir();
  const schemaPath = `${tempDir}/step_outputs.schema.json`;

  // Create schema with enum matching allowedIntents
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    definitions: {
      "test.step": {
        type: "object",
        properties: {
          next_action: {
            type: "object",
            properties: {
              action: { enum: ["next", "repeat"] },
            },
          },
        },
      },
    },
  };
  await Deno.writeTextFile(schemaPath, JSON.stringify(schema));

  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    entryStep: "test.step",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        outputSchemaRef: {
          file: "step_outputs.schema.json",
          schema: "#/definitions/test.step",
        },
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef: "#/properties/next_action/properties/action",
        },
      },
    },
  };

  try {
    // Should not throw
    await validateIntentSchemaEnums(registry, tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("validateIntentSchemaEnums - throws when allowedIntents contains values not in schema", async () => {
  const tempDir = await Deno.makeTempDir();
  const schemaPath = `${tempDir}/step_outputs.schema.json`;

  // Schema has only "next", but allowedIntents has "next" and "repeat"
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    definitions: {
      "test.step": {
        type: "object",
        properties: {
          next_action: {
            type: "object",
            properties: {
              action: { enum: ["next"] },
            },
          },
        },
      },
    },
  };
  await Deno.writeTextFile(schemaPath, JSON.stringify(schema));

  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    entryStep: "test.step",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        outputSchemaRef: {
          file: "step_outputs.schema.json",
          schema: "#/definitions/test.step",
        },
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef: "#/properties/next_action/properties/action",
        },
      },
    },
  };

  try {
    // Per design Section 4: symmetric validation - allowedIntents must exactly match schema enum
    await assertRejects(
      () => validateIntentSchemaEnums(registry, tempDir),
      Error,
      "enum mismatch",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("validateIntentSchemaEnums - throws when schema enum is superset of allowedIntents", async () => {
  const tempDir = await Deno.makeTempDir();
  const schemaPath = `${tempDir}/step_outputs.schema.json`;

  // Schema has "next", "repeat", "handoff" (shared enum), but allowedIntents only has "next", "repeat"
  // Per design Section 4: This is INVALID - schema must exactly match allowedIntents (symmetric)
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    definitions: {
      "test.step": {
        type: "object",
        properties: {
          next_action: {
            type: "object",
            properties: {
              action: { enum: ["next", "repeat", "handoff"] },
            },
          },
        },
      },
    },
  };
  await Deno.writeTextFile(schemaPath, JSON.stringify(schema));

  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    entryStep: "test.step",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        outputSchemaRef: {
          file: "step_outputs.schema.json",
          schema: "#/definitions/test.step",
        },
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef: "#/properties/next_action/properties/action",
        },
      },
    },
  };

  try {
    // Per design Section 4: Should FAIL - schema has extra "handoff" not in allowedIntents
    await assertRejects(
      () => validateIntentSchemaEnums(registry, tempDir),
      Error,
      "schema has extra [handoff] not in allowedIntents",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("validateIntentSchemaEnums - throws on mismatched casing", async () => {
  const tempDir = await Deno.makeTempDir();
  const schemaPath = `${tempDir}/step_outputs.schema.json`;

  // Schema has "Next", "Repeat" (capitalized), but allowedIntents has "next", "repeat"
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    definitions: {
      "test.step": {
        type: "object",
        properties: {
          next_action: {
            type: "object",
            properties: {
              action: { enum: ["Next", "Repeat"] },
            },
          },
        },
      },
    },
  };
  await Deno.writeTextFile(schemaPath, JSON.stringify(schema));

  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    entryStep: "test.step",
    steps: {
      "test.step": {
        stepId: "test.step",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test",
        uvVariables: [],
        usesStdin: false,
        outputSchemaRef: {
          file: "step_outputs.schema.json",
          schema: "#/definitions/test.step",
        },
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef: "#/properties/next_action/properties/action",
        },
      },
    },
  };

  try {
    // Should throw because "Next" != "next" and "Repeat" != "repeat" (case mismatch)
    await assertRejects(
      () => validateIntentSchemaEnums(registry, tempDir),
      Error,
      "enum mismatch",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
