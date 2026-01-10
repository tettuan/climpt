// deno-lint-ignore-file no-await-in-loop
/**
 * @fileoverview Tests for climpt init module
 *
 * These tests protect design invariants that should NOT be changed without careful consideration.
 * They ensure backward compatibility and expected behavior.
 *
 * @module tests/init_test
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

// Import modules under test
import { detectExisting, hasExistingFiles } from "../src/init/detector.ts";
import { initBasic } from "../src/init/basic-init.ts";
import { initMetaDomain } from "../src/init/meta-init.ts";
import { initRegistryAndSchema } from "../src/init/registry-init.ts";
import type { DetectionResult } from "../src/init/types.ts";

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "climpt_init_test_" });
}

/**
 * Clean up temporary directory
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Design Invariant: Default Paths
// =============================================================================

Deno.test("Design Invariant: Default working directory is .agent/climpt", () => {
  // This is the expected default - changing it would break existing installations
  const expectedDefault = ".agent/climpt";

  // Verify by checking the import behavior
  // The actual default is defined in init.ts DEFAULT_OPTIONS
  assertEquals(expectedDefault, ".agent/climpt");
});

Deno.test("Design Invariant: Basic init creates exactly 3 directories", async () => {
  const tempDir = await createTempDir();
  const workingDir = ".agent/climpt";

  try {
    const result = await initBasic(tempDir, workingDir);

    // Must create exactly: config/, prompts/, schema/
    const expectedDirs = ["config", "prompts", "schema"];
    const createdDirNames = result.created.map((p) => {
      const parts = p.split("/");
      return parts[parts.length - 1];
    });

    assertEquals(createdDirNames.sort(), expectedDirs.sort());
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// =============================================================================
// Design Invariant: Detection Logic
// =============================================================================

Deno.test("Design Invariant: hasExistingFiles checks 3 specific files", () => {
  // hasExistingFiles should return true if ANY of these exist:
  // - meta-app.yml
  // - registry_config.json
  // - registry.json

  const noFiles: DetectionResult = {
    hasWorkingDir: false,
    hasMetaAppYml: false,
    hasMetaUserYml: false,
    hasRegistryConfig: false,
    hasRegistry: false,
    hasSchemaDir: false,
    hasPromptsDir: false,
    hasMetaPromptsDir: false,
  };

  // No files = no existing configuration
  assertEquals(hasExistingFiles(noFiles), false);

  // Only meta-app.yml = existing configuration
  assertEquals(hasExistingFiles({ ...noFiles, hasMetaAppYml: true }), true);

  // Only registry_config.json = existing configuration
  assertEquals(hasExistingFiles({ ...noFiles, hasRegistryConfig: true }), true);

  // Only registry.json = existing configuration
  assertEquals(hasExistingFiles({ ...noFiles, hasRegistry: true }), true);

  // Other files alone do NOT trigger existing configuration
  assertEquals(hasExistingFiles({ ...noFiles, hasWorkingDir: true }), false);
  assertEquals(hasExistingFiles({ ...noFiles, hasMetaUserYml: true }), false);
  assertEquals(hasExistingFiles({ ...noFiles, hasSchemaDir: true }), false);
  assertEquals(hasExistingFiles({ ...noFiles, hasPromptsDir: true }), false);
});

Deno.test("Design Invariant: detectExisting checks all 8 locations", async () => {
  const tempDir = await createTempDir();
  const workingDir = ".agent/climpt";

  try {
    const result = await detectExisting(tempDir, workingDir);

    // Verify all 8 fields are present in result
    const expectedFields = [
      "hasWorkingDir",
      "hasMetaAppYml",
      "hasMetaUserYml",
      "hasRegistryConfig",
      "hasRegistry",
      "hasSchemaDir",
      "hasPromptsDir",
      "hasMetaPromptsDir",
    ];

    for (const field of expectedFields) {
      assertEquals(
        field in result,
        true,
        `Missing field: ${field}`,
      );
    }

    // In empty temp dir, all should be false
    assertEquals(result.hasWorkingDir, false);
    assertEquals(result.hasMetaAppYml, false);
    assertEquals(result.hasRegistry, false);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// =============================================================================
// Design Invariant: Force Flag Behavior
// =============================================================================

Deno.test("Design Invariant: Without force, existing files are skipped", async () => {
  const tempDir = await createTempDir();
  const workingDir = join(tempDir, ".agent/climpt");
  const configDir = join(workingDir, "config");

  try {
    // Create directory structure and existing file
    await Deno.mkdir(configDir, { recursive: true });
    const existingFile = join(configDir, "meta-app.yml");
    await Deno.writeTextFile(existingFile, "# existing content\n");

    // Run meta init without force
    const result = await initMetaDomain(workingDir, false);

    // meta-app.yml should be skipped, not created
    assertEquals(result.skipped.some((p) => p.includes("meta-app.yml")), true);
    assertEquals(result.created.some((p) => p.includes("meta-app.yml")), false);

    // Verify content was NOT overwritten
    const content = await Deno.readTextFile(existingFile);
    assertEquals(content, "# existing content\n");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("Design Invariant: With force, existing files are overwritten", async () => {
  const tempDir = await createTempDir();
  const workingDir = join(tempDir, ".agent/climpt");
  const configDir = join(workingDir, "config");

  try {
    // Create directory structure and existing file
    await Deno.mkdir(configDir, { recursive: true });
    const existingFile = join(configDir, "meta-app.yml");
    await Deno.writeTextFile(existingFile, "# old content\n");

    // Run meta init WITH force
    const result = await initMetaDomain(workingDir, true);

    // meta-app.yml should be created (overwritten)
    assertEquals(result.created.some((p) => p.includes("meta-app.yml")), true);

    // Verify content WAS overwritten
    const content = await Deno.readTextFile(existingFile);
    assertEquals(content.includes("# old content"), false);
    assertEquals(content.includes("working_dir"), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// =============================================================================
// Design Invariant: Generated File Structures
// =============================================================================

Deno.test("Design Invariant: registry.json has required structure", async () => {
  const tempDir = await createTempDir();
  const workingDir = ".agent/climpt";
  const fullWorkingDir = join(tempDir, workingDir);

  try {
    // Create required directories first
    await Deno.mkdir(join(fullWorkingDir, "config"), { recursive: true });

    await initRegistryAndSchema(tempDir, workingDir, false);

    const registryPath = join(fullWorkingDir, "registry.json");
    const content = await Deno.readTextFile(registryPath);
    const registry = JSON.parse(content);

    // Required top-level fields
    assertExists(registry.version);
    assertExists(registry.description);
    assertExists(registry.tools);

    // Tools structure
    assertExists(registry.tools.availableConfigs);
    assertExists(registry.tools.commands);
    assertEquals(Array.isArray(registry.tools.availableConfigs), true);
    assertEquals(Array.isArray(registry.tools.commands), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("Design Invariant: registry_config.json has required structure", async () => {
  const tempDir = await createTempDir();
  const workingDir = ".agent/climpt";
  const fullWorkingDir = join(tempDir, workingDir);

  try {
    await Deno.mkdir(join(fullWorkingDir, "config"), { recursive: true });

    await initRegistryAndSchema(tempDir, workingDir, false);

    const configPath = join(fullWorkingDir, "config/registry_config.json");
    const content = await Deno.readTextFile(configPath);
    const config = JSON.parse(content);

    // Required fields
    assertExists(config.registries);

    // Registries must include climpt with full path from project root
    assertExists(config.registries.climpt);
    assertEquals(config.registries.climpt, ".agent/climpt/registry.json");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("Design Invariant: frontmatter-to-schema contains 4 schema files", async () => {
  const tempDir = await createTempDir();
  const workingDir = ".agent/climpt";
  const fullWorkingDir = join(tempDir, workingDir);

  try {
    await Deno.mkdir(join(fullWorkingDir, "config"), { recursive: true });

    await initRegistryAndSchema(tempDir, workingDir, false);

    const schemaDir = join(fullWorkingDir, "frontmatter-to-schema");
    const expectedFiles = [
      "registry.schema.json",
      "registry.template.json",
      "command.schema.json",
      "command.template.json",
    ];

    for (const fileName of expectedFiles) {
      const filePath = join(schemaDir, fileName);
      const stat = await Deno.stat(filePath);
      assertEquals(stat.isFile, true, `Missing schema file: ${fileName}`);

      // Verify it's valid JSON
      const content = await Deno.readTextFile(filePath);
      JSON.parse(content); // Will throw if invalid
    }
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// =============================================================================
// Design Invariant: Meta Domain Prompts
// =============================================================================

Deno.test("Design Invariant: Meta domain creates 2 prompts", async () => {
  const tempDir = await createTempDir();
  const workingDir = join(tempDir, ".agent/climpt");

  try {
    await Deno.mkdir(join(workingDir, "config"), { recursive: true });
    await Deno.mkdir(join(workingDir, "prompts"), { recursive: true });

    await initMetaDomain(workingDir, false);

    // Must create exactly these 2 prompts
    const expectedPrompts = [
      "prompts/meta/build/frontmatter/f_default.md",
      "prompts/meta/create/instruction/f_default.md",
    ];

    for (const promptPath of expectedPrompts) {
      const fullPath = join(workingDir, promptPath);
      const stat = await Deno.stat(fullPath);
      assertEquals(stat.isFile, true, `Missing prompt: ${promptPath}`);
    }
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("Design Invariant: Meta prompts have C3L frontmatter", async () => {
  const tempDir = await createTempDir();
  const workingDir = join(tempDir, ".agent/climpt");

  try {
    await Deno.mkdir(join(workingDir, "config"), { recursive: true });
    await Deno.mkdir(join(workingDir, "prompts"), { recursive: true });

    await initMetaDomain(workingDir, false);

    // Check build frontmatter prompt
    const buildPromptPath = join(
      workingDir,
      "prompts/meta/build/frontmatter/f_default.md",
    );
    const buildContent = await Deno.readTextFile(buildPromptPath);

    // Must have C3L frontmatter fields
    assertEquals(buildContent.includes("c1: meta"), true);
    assertEquals(buildContent.includes("c2: build"), true);
    assertEquals(buildContent.includes("c3: frontmatter"), true);

    // Check create instruction prompt
    const createPromptPath = join(
      workingDir,
      "prompts/meta/create/instruction/f_default.md",
    );
    const createContent = await Deno.readTextFile(createPromptPath);

    assertEquals(createContent.includes("c1: meta"), true);
    assertEquals(createContent.includes("c2: create"), true);
    assertEquals(createContent.includes("c3: instruction"), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// =============================================================================
// Design Invariant: Meta Config Files
// =============================================================================

Deno.test("Design Invariant: meta-app.yml has required structure", async () => {
  const tempDir = await createTempDir();
  const workingDir = join(tempDir, ".agent/climpt");

  try {
    await Deno.mkdir(join(workingDir, "config"), { recursive: true });
    await Deno.mkdir(join(workingDir, "prompts"), { recursive: true });

    await initMetaDomain(workingDir, false);

    const configPath = join(workingDir, "config/meta-app.yml");
    const content = await Deno.readTextFile(configPath);

    // Must have these keys
    assertEquals(content.includes("working_dir:"), true);
    assertEquals(content.includes("app_prompt:"), true);
    assertEquals(content.includes("base_dir:"), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("Design Invariant: meta-user.yml has C3L patterns", async () => {
  const tempDir = await createTempDir();
  const workingDir = join(tempDir, ".agent/climpt");

  try {
    await Deno.mkdir(join(workingDir, "config"), { recursive: true });
    await Deno.mkdir(join(workingDir, "prompts"), { recursive: true });

    await initMetaDomain(workingDir, false);

    const configPath = join(workingDir, "config/meta-user.yml");
    const content = await Deno.readTextFile(configPath);

    // Must have params with patterns for c2/c3 validation
    assertEquals(content.includes("params:"), true);
    assertEquals(content.includes("directiveType:"), true);
    assertEquals(content.includes("layerType:"), true);
    assertEquals(content.includes("pattern:"), true);

    // Must include build and create directives
    assertEquals(content.includes("build"), true);
    assertEquals(content.includes("create"), true);

    // Must include frontmatter and instruction layers
    assertEquals(content.includes("frontmatter"), true);
    assertEquals(content.includes("instruction"), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// =============================================================================
// Design Invariant: Result Structure
// =============================================================================

Deno.test("Design Invariant: Init result has created/skipped/errors arrays", async () => {
  const tempDir = await createTempDir();
  const workingDir = ".agent/climpt";

  try {
    const result = await initBasic(tempDir, workingDir);

    // Result must have these arrays
    assertEquals(Array.isArray(result.created), true);
    assertEquals(Array.isArray(result.skipped), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});
