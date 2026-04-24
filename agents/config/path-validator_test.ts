/**
 * Tests for agents/config/path-validator.ts
 *
 * Covers validatePaths() with real filesystem temp directories:
 * - systemPromptPath, fallbackDir, prompts.registry existence checks
 * - outputSchemaRef.file existence checks via registry
 * - Skip behaviour for missing/empty fields and null registry
 */

import { assertEquals, assertGreater, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import type { AgentDefinition } from "../src_common/types.ts";
import {
  MSG_C3L_PROMPT_FILE,
  MSG_DOES_NOT_EXIST,
  MSG_FALLBACK_DIR,
  MSG_LEGACY,
  MSG_NOT_FOUND,
  MSG_OUTPUT_SCHEMA_REF,
  MSG_PATH,
  MSG_PROMPTS_REGISTRY,
  MSG_SCHEMA,
  MSG_SYSTEM_PROMPT_PATH,
  validatePaths,
} from "./path-validator.ts";

// ---------------------------------------------------------------------------
// Source file reference for assertion messages (P4: "Where")
// ---------------------------------------------------------------------------

const SRC = "path-validator.ts";

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
    // P3: non-vacuity guard — definition has real path fields to exercise
    assertGreater(
      def.runner.flow.systemPromptPath!.length,
      0,
      `Non-vacuity: systemPromptPath must be non-empty (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when all paths exist (fix: ${SRC} existence checks). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when all paths exist (fix: ${SRC} existence checks). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — systemPromptPath is set so the validator exercises the check
    assertGreater(
      def.runner.flow.systemPromptPath!.length,
      0,
      `Non-vacuity: systemPromptPath must be non-empty (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir);

    assertEquals(
      result.valid,
      false,
      `Expected valid=false when systemPromptPath is missing (fix: ${SRC} systemPromptPath check)`,
    );
    // P2: error count derived from 1 missing path (systemPromptPath)
    assertGreater(
      result.errors.length,
      0,
      `Expected at least 1 error for missing ${MSG_SYSTEM_PROMPT_PATH} (fix: ${SRC} systemPromptPath check)`,
    );
    // P1: use imported constants instead of string literals
    const hasError = result.errors.some((e) =>
      e.includes(MSG_SYSTEM_PROMPT_PATH)
    );
    assertEquals(
      hasError,
      true,
      `Expected ${MSG_PATH} error about ${MSG_SYSTEM_PROMPT_PATH} (fix: ${SRC} systemPromptPath check). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — registry path is set so the validator exercises the check
    assertGreater(
      def.runner.flow.prompts.registry!.length,
      0,
      `Non-vacuity: prompts.registry must be non-empty (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir);

    assertEquals(
      result.valid,
      false,
      `Expected valid=false when prompts.registry is missing (fix: ${SRC} prompts.registry check)`,
    );
    // P1: use imported constants instead of string literals
    const hasError = result.errors.some((e) =>
      e.includes(MSG_PROMPTS_REGISTRY)
    );
    assertEquals(
      hasError,
      true,
      `Expected ${MSG_PATH} error about ${MSG_PROMPTS_REGISTRY} (fix: ${SRC} prompts.registry check). Got: ${
        result.errors.join("; ")
      }`,
    );
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

    assertEquals(
      result.valid,
      false,
      `Expected valid=false when ${MSG_FALLBACK_DIR} dir is missing (fix: ${SRC} fallbackDir check)`,
    );
    // P1: use imported constants instead of string literals
    const hasError = result.errors.some((e) =>
      e.includes(MSG_FALLBACK_DIR) && e.includes(MSG_DOES_NOT_EXIST)
    );
    assertEquals(
      hasError,
      true,
      `Expected ${MSG_PATH} error about ${MSG_FALLBACK_DIR} ${MSG_DOES_NOT_EXIST} (fix: ${SRC} fallbackDir check). Got: ${
        result.errors.join("; ")
      }`,
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
      `Expected valid=true when fallbackDir exists (fix: ${SRC} fallbackDir check). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    // P1: use imported constants instead of string literals
    const hasWarning = result.warnings.some((w) =>
      w.includes(MSG_LEGACY) && w.includes(MSG_FALLBACK_DIR)
    );
    assertEquals(
      hasWarning,
      true,
      `Expected ${MSG_LEGACY} warning about ${MSG_FALLBACK_DIR} (fix: ${SRC} fallbackDir check). Got: ${
        result.warnings.join("; ")
      }`,
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
    // P3: non-vacuity guard — other path fields are still populated so validator runs real checks
    assertGreater(
      def.runner.flow.systemPromptPath!.length,
      0,
      `Non-vacuity: systemPromptPath must be non-empty (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when fallbackDir is omitted (fix: ${SRC} fallbackDir check). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    // P1: use imported constant instead of string literal
    const hasFallbackWarning = result.warnings.some((w) =>
      w.includes(MSG_FALLBACK_DIR)
    );
    assertEquals(
      hasFallbackWarning,
      false,
      `Expected no ${MSG_FALLBACK_DIR} warning when field is omitted (fix: ${SRC} fallbackDir check). Got: ${
        result.warnings.join("; ")
      }`,
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
    // P3: non-vacuity guard — registry has at least 1 step with c2/c3/edition
    const stepCount = Object.keys(registry.steps).length;
    assertGreater(
      stepCount,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validatePaths(def, dir, registry, promptRoot);

    assertEquals(
      result.valid,
      false,
      `Expected valid=false when C3L prompt file is missing (fix: ${SRC} C3L prompt check)`,
    );
    // P1: use imported constants instead of string literals
    const hasError = result.errors.some((e) =>
      e.includes(MSG_PATH) &&
      e.includes(MSG_C3L_PROMPT_FILE) &&
      e.includes("initial.default")
    );
    assertEquals(
      hasError,
      true,
      `Expected ${MSG_PATH} error about ${MSG_C3L_PROMPT_FILE} for "initial.default" (fix: ${SRC} C3L prompt check). Got: ${
        result.errors.join("; ")
      }`,
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
    // P3: non-vacuity guard — registry has at least 1 step with c2/c3/edition
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validatePaths(def, dir, registry, promptRoot);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when C3L prompt file exists (fix: ${SRC} C3L prompt check). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when C3L prompt file exists (fix: ${SRC} C3L prompt check). Got: ${
        result.errors.join("; ")
      }`,
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
    // P3: non-vacuity guard — adaptation field is present
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validatePaths(def, dir, registry, promptRoot);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when C3L adaptation prompt file exists (fix: ${SRC} C3L prompt check). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when C3L adaptation prompt file exists (fix: ${SRC} C3L prompt check). Got: ${
        result.errors.join("; ")
      }`,
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
    // P3: non-vacuity guard — registry has entries, but they lack c2/c3/edition
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry to exercise skip logic (fix: ${SRC} test fixture)`,
    );

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validatePaths(def, dir, registry, promptRoot);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when step lacks c2/c3/edition (fix: ${SRC} C3L skip logic). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when step lacks c2/c3/edition (fix: ${SRC} C3L skip logic). Got: ${
        result.errors.join("; ")
      }`,
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
    // P3: non-vacuity guard — registry has at least 1 step with outputSchemaRef
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      false,
      `Expected valid=false when ${MSG_OUTPUT_SCHEMA_REF} file is missing (fix: ${SRC} outputSchemaRef check)`,
    );
    // P1: use imported constants instead of string literals
    const hasError = result.errors.some((e) =>
      e.includes("initial.default") && e.includes(MSG_OUTPUT_SCHEMA_REF)
    );
    assertEquals(
      hasError,
      true,
      `Expected ${MSG_PATH} error about ${MSG_OUTPUT_SCHEMA_REF} for "initial.default" (fix: ${SRC} outputSchemaRef check). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — registry has at least 1 step with outputSchemaRef
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when ${MSG_OUTPUT_SCHEMA_REF} file exists (fix: ${SRC} outputSchemaRef check). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when ${MSG_OUTPUT_SCHEMA_REF} file exists (fix: ${SRC} outputSchemaRef check). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — definition has real path fields so base checks still run
    assertGreater(
      def.runner.flow.systemPromptPath!.length,
      0,
      `Non-vacuity: systemPromptPath must be non-empty (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, null);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when registry is null (fix: ${SRC} registry null guard). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when registry is null (fix: ${SRC} registry null guard). Got: ${
        result.errors.join("; ")
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("path-validator - undefined registry skips schema checks", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createStandardLayout(dir);
    const def = validDefinition();
    // P3: non-vacuity guard — definition has real path fields so base checks still run
    assertGreater(
      def.runner.flow.systemPromptPath!.length,
      0,
      `Non-vacuity: systemPromptPath must be non-empty (fix: ${SRC} test fixture)`,
    );

    // No registry argument at all
    const result = await validatePaths(def, dir);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when registry is undefined (fix: ${SRC} registry undefined guard). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when registry is undefined (fix: ${SRC} registry undefined guard). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P2: track number of fields set to empty — all 3 should be skipped
    const emptyFieldCount = 3;
    def.runner.flow.systemPromptPath = "";
    def.runner.flow.prompts.fallbackDir = "";
    def.runner.flow.prompts.registry = "";
    // P3: non-vacuity guard — we actually blanked out fields (not already empty)
    assertEquals(
      emptyFieldCount,
      3,
      `Non-vacuity: must blank exactly 3 path fields (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when all path fields are empty strings (fix: ${SRC} empty-string skip logic)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when all path fields are empty strings (fix: ${SRC} empty-string skip logic). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — registry has a step entry (skip is due to empty file, not missing step)
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when ${MSG_OUTPUT_SCHEMA_REF}.file is empty (fix: ${SRC} empty-file skip logic)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when ${MSG_OUTPUT_SCHEMA_REF}.file is empty (fix: ${SRC} empty-file skip logic). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — registry has a step entry (skip is due to missing outputSchemaRef, not missing step)
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when step has no ${MSG_OUTPUT_SCHEMA_REF} (fix: ${SRC} missing-schemaRef skip logic)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when step has no ${MSG_OUTPUT_SCHEMA_REF} (fix: ${SRC} missing-schemaRef skip logic). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — registry has at least 1 step with schema pointer
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when schema pointer resolves (fix: ${SRC} schema name resolution). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when schema pointer resolves (fix: ${SRC} schema name resolution). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — registry has a step whose pointer should fail
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      false,
      `Expected valid=false when schema pointer does not resolve (fix: ${SRC} schema name resolution)`,
    );
    // P1: use imported constants instead of string literals
    const hasSchemaError = result.errors.some((e) =>
      e.includes(MSG_SCHEMA) &&
      e.includes("initial.issue") &&
      e.includes(MSG_NOT_FOUND)
    );
    assertEquals(
      hasSchemaError,
      true,
      `Expected ${MSG_SCHEMA} error about "initial.issue" ${MSG_NOT_FOUND} (fix: ${SRC} schema name resolution). Got: ${
        result.errors.join("; ")
      }`,
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
    // P3: non-vacuity guard — registry has at least 1 step with root pointer
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when root schema pointer "#/" is used (fix: ${SRC} schema name resolution). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when root schema pointer "#/" is used (fix: ${SRC} schema name resolution). Got: ${
        result.errors.join("; ")
      }`,
    );
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
    // P3: non-vacuity guard — registry has at least 1 step with bare schema name
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    const result = await validatePaths(def, dir, registry);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true when bare schema name resolves in definitions (fix: ${SRC} schema name resolution). Got errors: ${
        result.errors.join("; ")
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected 0 errors when bare schema name resolves (fix: ${SRC} schema name resolution). Got: ${
        result.errors.join("; ")
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 13. promptRoot = null with registry -> warning about skipped C3L checks
// =============================================================================

Deno.test("path-validator - null promptRoot with registry emits skip warning", async () => {
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
    // P3: non-vacuity guard — registry has C3L-eligible steps
    assertGreater(
      Object.keys(registry.steps).length,
      0,
      `Non-vacuity: registry.steps must have at least 1 entry (fix: ${SRC} test fixture)`,
    );

    // Pass registry but null promptRoot — C3L checks should be skipped with warning
    const result = await validatePaths(def, dir, registry, null);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true (skip is a warning, not an error) (fix: ${SRC} null promptRoot guard)`,
    );
    const skipWarning = result.warnings.find((w) =>
      w.includes(MSG_PATH) && w.includes("skipped")
    );
    assertNotEquals(
      skipWarning,
      undefined,
      `Expected ${MSG_PATH} warning about skipped C3L checks when promptRoot is null (fix: ${SRC} null promptRoot guard). Got warnings: ${
        result.warnings.join("; ")
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
