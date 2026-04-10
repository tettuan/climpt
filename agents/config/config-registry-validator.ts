/**
 * Config-Registry Consistency Validator
 *
 * Validates that each step in a steps_registry.json has corresponding
 * breakdown config files (app.yml and user.yml), and that the step's
 * c2/c3 values match the patterns defined in the user.yml file.
 *
 * Catches drift between registry declarations and breakdown config
 * constraints before runtime resolution fails.
 *
 * Responsibility: Cross-check registry c2/c3 against breakdown config patterns (I/O)
 * Side effects: Reads yml files from the filesystem
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";
import { join } from "@std/path";

// ---------------------------------------------------------------------------
// Message constants (exported for test assertions — single source of truth)
// ---------------------------------------------------------------------------

/** Error fragment: app.yml config file missing. */
export const MSG_MISSING_APP_YML = "app.yml not found";

/** Error fragment: user.yml config file missing. */
export const MSG_MISSING_USER_YML = "user.yml not found";

/** Error fragment: c2 value does not match directiveType pattern. */
export const MSG_C2_MISMATCH = "does not match directiveType pattern";

/** Error fragment: c3 value does not match layerType pattern. */
export const MSG_C3_MISMATCH = "does not match layerType pattern";

/** Error fragment: directiveType pattern not found in user.yml. */
export const MSG_NO_DIRECTIVE_PATTERN = "directiveType pattern not found";

/** Error fragment: layerType pattern not found in user.yml. */
export const MSG_NO_LAYER_PATTERN = "layerType pattern not found";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safely cast an unknown value to a Record, or return undefined. */
function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Extract regex pattern string from user.yml content.
 * Matches: `key:\n  ...\n  pattern: "^(a|b|c)$"` format.
 *
 * Reuses the same strategy as config-consistency_test.ts extractPattern().
 */
function extractPattern(yml: string, key: string): string | null {
  const re = new RegExp(`${key}:[\\s\\S]*?pattern:\\s*"([^"]+)"`);
  const m = yml.match(re);
  return m ? m[1] : null;
}

/**
 * Check whether a file exists on the filesystem.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate consistency between a steps_registry.json and its breakdown
 * config yml files.
 *
 * For each step (in both `steps` and `validationSteps`):
 * 1. Derive the config name from registry's agentId and c1 fields
 * 2. Check that {configDir}/{configName}-app.yml exists
 * 3. Check that {configDir}/{configName}-user.yml exists
 * 4. Parse user.yml and extract directiveType.pattern / layerType.pattern
 * 5. Verify that each step's c2 matches the directiveType pattern
 * 6. Verify that each step's c3 matches the layerType pattern
 *
 * @param registry - Parsed steps_registry.json content
 * @param configDir - Absolute path to the config directory
 *                    (e.g., /repo/.agent/climpt/config)
 * @returns Validation result with errors for each mismatch
 */
export async function validateConfigRegistryConsistency(
  registry: Record<string, unknown>,
  configDir: string,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const agentId = registry.agentId;
  const c1 = registry.c1;

  // If registry lacks agentId or c1, we cannot derive config file names
  if (typeof agentId !== "string" || typeof c1 !== "string") {
    return {
      valid: true,
      errors: [],
      warnings: [
        "Config-registry consistency check skipped: " +
        "registry missing agentId or c1 field",
      ],
    };
  }

  const configName = `${agentId}-${c1}`;
  const appYmlPath = join(configDir, `${configName}-app.yml`);
  const userYmlPath = join(configDir, `${configName}-user.yml`);

  // Check file existence
  const appExists = await fileExists(appYmlPath);
  const userExists = await fileExists(userYmlPath);

  if (!appExists) {
    errors.push(
      `${MSG_MISSING_APP_YML}: ${configName}-app.yml ` +
        `(expected at ${appYmlPath})`,
    );
  }

  if (!userExists) {
    errors.push(
      `${MSG_MISSING_USER_YML}: ${configName}-user.yml ` +
        `(expected at ${userYmlPath})`,
    );
  }

  // If user.yml doesn't exist, we cannot check c2/c3 patterns
  if (!userExists) {
    return { valid: errors.length === 0, errors, warnings };
  }

  // Read and parse user.yml
  const userYml = await Deno.readTextFile(userYmlPath);

  const dtPattern = extractPattern(userYml, "directiveType");
  const ltPattern = extractPattern(userYml, "layerType");

  if (!dtPattern) {
    errors.push(
      `${MSG_NO_DIRECTIVE_PATTERN} in ${configName}-user.yml`,
    );
  }

  if (!ltPattern) {
    errors.push(
      `${MSG_NO_LAYER_PATTERN} in ${configName}-user.yml`,
    );
  }

  // If we don't have both patterns, we cannot validate c2/c3
  if (!dtPattern || !ltPattern) {
    return { valid: errors.length === 0, errors, warnings };
  }

  const dtRegex = new RegExp(dtPattern);
  const ltRegex = new RegExp(ltPattern);

  // Collect all steps from both sections
  const allSteps: Array<
    { sectionName: string; stepId: string; step: Record<string, unknown> }
  > = [];

  const steps = asRecord(registry.steps) ?? {};
  for (const [stepId, stepDef] of Object.entries(steps)) {
    const step = asRecord(stepDef);
    if (step) {
      allSteps.push({ sectionName: "steps", stepId, step });
    }
  }

  const validationSteps = asRecord(registry.validationSteps) ?? {};
  for (const [stepId, stepDef] of Object.entries(validationSteps)) {
    const step = asRecord(stepDef);
    if (step) {
      allSteps.push({ sectionName: "validationSteps", stepId, step });
    }
  }

  // Validate each step's c2 and c3
  for (const { sectionName, stepId, step } of allSteps) {
    const c2 = step.c2;
    const c3 = step.c3;

    if (typeof c2 === "string" && !dtRegex.test(c2)) {
      errors.push(
        `${sectionName}["${stepId}"].c2 = "${c2}" ${MSG_C2_MISMATCH} ` +
          `"${dtPattern}" in ${configName}-user.yml. ` +
          `IF you added a new step, THEN add "${c2}" to directiveType.pattern. ` +
          `IF you intentionally narrowed the pattern, THEN remove the step from the registry.`,
      );
    }

    if (typeof c3 === "string" && !ltRegex.test(c3)) {
      errors.push(
        `${sectionName}["${stepId}"].c3 = "${c3}" ${MSG_C3_MISMATCH} ` +
          `"${ltPattern}" in ${configName}-user.yml. ` +
          `IF you added a new step, THEN add "${c3}" to layerType.pattern. ` +
          `IF you intentionally narrowed the pattern, THEN remove the step from the registry.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
