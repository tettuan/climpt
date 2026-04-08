/**
 * Tests for agents/config/path-validator.ts
 *
 * Covers validatePaths() with real filesystem temp directories:
 * - systemPromptPath, fallbackDir, prompts.registry existence checks
 * - outputSchemaRef.file existence checks via registry
 * - Skip behaviour for missing/empty fields and null registry
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { AgentDefinition } from "../src_common/types.ts";
import { validatePaths } from "./path-validator.ts";

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Minimal AgentDefinition with path fields populated.
 * Override specific fields per test.
 */
function validDefinition(): AgentDefinition {
  return {
    version: "1.0.0",
    name: "test-agent",
    displayName: "Test Agent",
    description: "Test agent for path validation",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "system.md",
        prompts: {
          registry: "steps_registry.json",
        },
      },
      verdict: {
        type: "detect:graph",
        config: { registryPath: "steps_registry.json" },
      },
      boundaries: {
        allowedTools: [],
        permissionMode: "default",
      },
    },
  };
}

/**
 * Create standard directory layout inside a temp dir:
 * - system.md (file)
 * - steps_registry.json (file)
 */
async function createStandardLayout(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "system.md"), "# System");
  await Deno.writeTextFile(
    join(dir, "steps_registry.json"),
    "{}",
  );
}

// =============================================================================
// 1. All paths exist -> valid
// =============================================================================

Deno.test("path-validator - all paths exist returns valid", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();

    const result = await validatePaths(def, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 2. systemPromptPath missing -> error
// =============================================================================

Deno.test("path-validator - missing systemPromptPath reports error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Create layout WITHOUT system.md
    await Deno.mkdir(join(dir, "prompts"), { recursive: true });
    await Deno.writeTextFile(join(dir, "steps_registry.json"), "{}");
    const def = validDefinition();

    const result = await validatePaths(def, dir);

    assertEquals(result.valid, false);
    assertEquals(result.errors.length >= 1, true);
    const hasError = result.errors.some((e) => e.includes("systemPromptPath"));
    assertEquals(hasError, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 3. prompts.registry missing -> error
// =============================================================================

Deno.test("path-validator - missing prompts.registry reports error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Create layout WITHOUT steps_registry.json
    await Deno.writeTextFile(join(dir, "system.md"), "# System");
    await Deno.mkdir(join(dir, "prompts"), { recursive: true });
    const def = validDefinition();

    const result = await validatePaths(def, dir);

    assertEquals(result.valid, false);
    const hasError = result.errors.some((e) => e.includes("prompts.registry"));
    assertEquals(hasError, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 4a. fallbackDir specified but directory doesn't exist -> error
// =============================================================================

Deno.test("path-validator - missing fallbackDir reports error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();
    def.runner.flow.prompts.fallbackDir = "prompts/legacy";

    const result = await validatePaths(def, dir);

    assertEquals(result.valid, false);
    const hasError = result.errors.some((e) =>
      e.includes("fallbackDir") && e.includes("does not exist")
    );
    assertEquals(
      hasError,
      true,
      `Expected fallbackDir path error, got: ${result.errors.join("; ")}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 4b. fallbackDir specified and directory exists -> warning about legacy
// =============================================================================

Deno.test("path-validator - existing fallbackDir produces legacy warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const fallbackPath = join(dir, "prompts", "legacy");
    await Deno.mkdir(fallbackPath, { recursive: true });
    const def = validDefinition();
    def.runner.flow.prompts.fallbackDir = "prompts/legacy";

    const result = await validatePaths(def, dir);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
    const hasWarning = result.warnings.some((w) =>
      w.includes("[LEGACY]") && w.includes("fallbackDir")
    );
    assertEquals(
      hasWarning,
      true,
      `Expected legacy warning, got warnings: ${result.warnings.join("; ")}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 4c. fallbackDir not specified -> no error, no warning
// =============================================================================

Deno.test("path-validator - no fallbackDir produces no error or warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();
    // Ensure fallbackDir is not set
    delete def.runner.flow.prompts.fallbackDir;

    const result = await validatePaths(def, dir);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
    const hasFallbackWarning = result.warnings.some((w) =>
      w.includes("fallbackDir")
    );
    assertEquals(
      hasFallbackWarning,
      false,
      `Unexpected fallbackDir warning: ${result.warnings.join("; ")}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 5a. C3L prompt file missing -> error
// =============================================================================

Deno.test("path-validator - missing C3L prompt file reports error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();
    const registry = {
      c1: "steps",
      steps: {
        "initial.default": {
          stepId: "initial.default",
          c2: "initial",
          c3: "default",
          edition: "default",
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(result.valid, false);
    const hasError = result.errors.some((e) =>
      e.includes("[PATH]") &&
      e.includes("C3L prompt file") &&
      e.includes("initial.default")
    );
    assertEquals(
      hasError,
      true,
      `Expected C3L prompt file error, got: ${result.errors.join("; ")}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 5b. C3L prompt file exists -> valid
// =============================================================================

Deno.test("path-validator - existing C3L prompt file returns valid", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    // Create the C3L prompt file
    const c3lDir = join(dir, "prompts", "steps", "initial", "default");
    await Deno.mkdir(c3lDir, { recursive: true });
    await Deno.writeTextFile(join(c3lDir, "f_default.md"), "# Prompt");

    const def = validDefinition();
    const registry = {
      c1: "steps",
      steps: {
        "initial.default": {
          stepId: "initial.default",
          c2: "initial",
          c3: "default",
          edition: "default",
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 5c. C3L prompt file with adaptation
// =============================================================================

Deno.test("path-validator - C3L prompt with adaptation checks correct path", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    // Create the adaptation prompt file
    const c3lDir = join(dir, "prompts", "steps", "initial", "issue");
    await Deno.mkdir(c3lDir, { recursive: true });
    await Deno.writeTextFile(
      join(c3lDir, "f_default_label_only.md"),
      "# Prompt",
    );

    const def = validDefinition();
    const registry = {
      c1: "steps",
      steps: {
        "initial.issue.label_only": {
          stepId: "initial.issue.label_only",
          c2: "initial",
          c3: "issue",
          edition: "default",
          adaptation: "label_only",
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 5d. Step without c2/c3/edition is skipped
// =============================================================================

Deno.test("path-validator - step without c2/c3/edition skips C3L check", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();
    const registry = {
      c1: "steps",
      steps: {
        "initial.default": {
          stepId: "initial.default",
          // No c2/c3/edition — should be skipped
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 5. outputSchemaRef.file missing -> error
// =============================================================================

Deno.test("path-validator - missing outputSchemaRef.file reports error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    // schemas/ dir exists but schema file does NOT
    await Deno.mkdir(join(dir, "schemas"), { recursive: true });

    const def = validDefinition();
    const registry = {
      steps: {
        "initial.default": {
          stepId: "initial.default",
          outputSchemaRef: {
            file: "missing.schema.json",
            schema: "initial.default",
          },
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(result.valid, false);
    const hasError = result.errors.some((e) =>
      e.includes("initial.default") && e.includes("outputSchemaRef")
    );
    assertEquals(hasError, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 6. outputSchemaRef.file exists -> valid
// =============================================================================

Deno.test("path-validator - existing outputSchemaRef.file returns valid", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    await Deno.mkdir(join(dir, "schemas"), { recursive: true });
    // Schema file must contain the referenced definition
    const schemaContent = {
      definitions: {
        "initial.issue": {
          type: "object",
          properties: { stepId: { type: "string" } },
        },
      },
    };
    await Deno.writeTextFile(
      join(dir, "schemas", "issue.schema.json"),
      JSON.stringify(schemaContent),
    );

    const def = validDefinition();
    const registry = {
      steps: {
        "initial.issue": {
          stepId: "initial.issue",
          outputSchemaRef: {
            file: "issue.schema.json",
            schema: "initial.issue",
          },
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 7. No registry -> skip schema checks
// =============================================================================

Deno.test("path-validator - null registry skips schema checks", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    // No schemas/ dir at all, but registry is null so it should not matter
    const def = validDefinition();

    const result = await validatePaths(def, dir, null);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("path-validator - undefined registry skips schema checks", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();

    // No registry argument at all
    const result = await validatePaths(def, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 8. Empty/undefined path fields -> skip (no error)
// =============================================================================

Deno.test("path-validator - empty string path fields are skipped", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const def = validDefinition();
    def.runner.flow.systemPromptPath = "";
    def.runner.flow.prompts.fallbackDir = "";
    def.runner.flow.prompts.registry = "";

    const result = await validatePaths(def, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("path-validator - empty outputSchemaRef.file is skipped", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();
    const registry = {
      steps: {
        "initial.default": {
          stepId: "initial.default",
          outputSchemaRef: {
            file: "",
            schema: "initial.default",
          },
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("path-validator - step without outputSchemaRef is skipped", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();
    const registry = {
      steps: {
        "initial.default": {
          stepId: "initial.default",
          // No outputSchemaRef at all
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 9. Schema name resolution: pointer resolves -> no error
// =============================================================================

Deno.test("path-validator - schema pointer resolves to existing definition returns valid", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    await Deno.mkdir(join(dir, "schemas"), { recursive: true });

    // Schema file with a "definitions" block containing the referenced step
    const schemaContent = {
      definitions: {
        "initial.issue": {
          type: "object",
          properties: {
            stepId: { type: "string", const: "initial.issue" },
          },
          required: ["stepId"],
        },
      },
    };
    await Deno.writeTextFile(
      join(dir, "schemas", "step_outputs.schema.json"),
      JSON.stringify(schemaContent),
    );

    const def = validDefinition();
    const registry = {
      steps: {
        "initial.issue": {
          stepId: "initial.issue",
          outputSchemaRef: {
            file: "step_outputs.schema.json",
            schema: "#/definitions/initial.issue",
          },
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 10. Schema name resolution: pointer does not resolve -> error
// =============================================================================

Deno.test("path-validator - schema pointer to non-existent definition reports error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    await Deno.mkdir(join(dir, "schemas"), { recursive: true });

    // Schema file WITHOUT the referenced definition
    const schemaContent = {
      definitions: {
        "initial.project": {
          type: "object",
          properties: {},
        },
      },
    };
    await Deno.writeTextFile(
      join(dir, "schemas", "step_outputs.schema.json"),
      JSON.stringify(schemaContent),
    );

    const def = validDefinition();
    const registry = {
      steps: {
        "initial.issue": {
          stepId: "initial.issue",
          outputSchemaRef: {
            file: "step_outputs.schema.json",
            schema: "#/definitions/initial.issue",
          },
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(result.valid, false);
    const hasSchemaError = result.errors.some((e) =>
      e.includes("[SCHEMA]") &&
      e.includes("initial.issue") &&
      e.includes("not found")
    );
    assertEquals(
      hasSchemaError,
      true,
      `Expected schema name resolution error, got: ${result.errors.join("; ")}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 11. Schema name resolution: root pointer "#/" always valid
// =============================================================================

Deno.test("path-validator - root schema pointer '#/' passes validation", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    await Deno.mkdir(join(dir, "schemas"), { recursive: true });

    // Any valid JSON schema file — root pointer refers to the whole document
    const schemaContent = {
      type: "object",
      properties: {
        stepId: { type: "string" },
      },
    };
    await Deno.writeTextFile(
      join(dir, "schemas", "root.schema.json"),
      JSON.stringify(schemaContent),
    );

    const def = validDefinition();
    const registry = {
      steps: {
        "initial.default": {
          stepId: "initial.default",
          outputSchemaRef: {
            file: "root.schema.json",
            schema: "#/",
          },
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 12. Schema name resolution: bare name resolves in definitions
// =============================================================================

Deno.test("path-validator - bare schema name resolves in definitions", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    await Deno.mkdir(join(dir, "schemas"), { recursive: true });

    const schemaContent = {
      definitions: {
        "initial.default": {
          type: "object",
          properties: {},
        },
      },
    };
    await Deno.writeTextFile(
      join(dir, "schemas", "step_outputs.schema.json"),
      JSON.stringify(schemaContent),
    );

    const def = validDefinition();
    const registry = {
      steps: {
        "initial.default": {
          stepId: "initial.default",
          outputSchemaRef: {
            file: "step_outputs.schema.json",
            schema: "initial.default",
          },
        },
      },
    };

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Unexpected errors: ${result.errors.join("; ")}`,
    );
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
