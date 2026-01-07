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
  saveStepRegistry,
  serializeRegistry,
  type StepDefinition,
  type StepRegistry,
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
  const step: StepDefinition = {
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
  const step: StepDefinition = {
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
  const step: StepDefinition = {
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
