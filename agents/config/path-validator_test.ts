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
          fallbackDir: "prompts",
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
 * - prompts/ (directory)
 * - steps_registry.json (file)
 */
async function createStandardLayout(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "system.md"), "# System");
  await Deno.mkdir(join(dir, "prompts"), { recursive: true });
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
// 3. fallbackDir missing -> error
// =============================================================================

Deno.test("path-validator - missing fallbackDir reports error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Create layout WITHOUT prompts/
    await Deno.writeTextFile(join(dir, "system.md"), "# System");
    await Deno.writeTextFile(join(dir, "steps_registry.json"), "{}");
    const def = validDefinition();

    const result = await validatePaths(def, dir);

    assertEquals(result.valid, false);
    const hasError = result.errors.some((e) => e.includes("fallbackDir"));
    assertEquals(hasError, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 4. prompts.registry missing -> error
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
    await Deno.writeTextFile(
      join(dir, "schemas", "issue.schema.json"),
      "{}",
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

    assertEquals(result.valid, true);
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
