/**
 * Path Validator - Filesystem Existence Checks for Referenced Paths
 *
 * Validates that file/directory paths referenced in AgentDefinition and
 * steps_registry.json actually exist on the filesystem.
 *
 * Responsibility: Verify path existence only (no content inspection)
 * Side effects: None (reads filesystem metadata via Deno.stat)
 *
 * @module
 */

import type { AgentDefinition, ValidationResult } from "../src_common/types.ts";
import { join } from "@std/path";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a path exists and is a file.
 * Returns true if it exists (file or directory), false if NotFound.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch (e: unknown) {
    if (e instanceof Deno.errors.NotFound) {
      return false;
    }
    throw e;
  }
}

/**
 * Check whether a path exists and is a directory.
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch (e: unknown) {
    if (e instanceof Deno.errors.NotFound) {
      return false;
    }
    throw e;
  }
}

/** Safely cast to Record if value is a plain object. */
function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that paths referenced in the agent definition and steps registry
 * exist on the filesystem.
 *
 * @param definition - Parsed agent definition
 * @param agentDir - Absolute path to the agent directory (e.g., .agent/my-agent)
 * @param registry - Parsed steps_registry.json content, or null if not present
 * @returns Validation result with errors for missing paths
 */
export async function validatePaths(
  definition: AgentDefinition,
  agentDir: string,
  registry?: Record<string, unknown> | null,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. runner.flow.systemPromptPath — file must exist
  const systemPromptPath = definition.runner?.flow?.systemPromptPath;
  if (typeof systemPromptPath === "string" && systemPromptPath !== "") {
    const resolved = join(agentDir, systemPromptPath);
    if (!await fileExists(resolved)) {
      errors.push(
        `[PATH] Path not found: runner.flow.systemPromptPath \u2192 "${systemPromptPath}" does not exist`,
      );
    }
  }

  // 2. runner.flow.prompts.fallbackDir — directory must exist
  const fallbackDir = definition.runner?.flow?.prompts?.fallbackDir;
  if (typeof fallbackDir === "string" && fallbackDir !== "") {
    const resolved = join(agentDir, fallbackDir);
    if (!await dirExists(resolved)) {
      errors.push(
        `[PATH] Path not found: runner.flow.prompts.fallbackDir \u2192 "${fallbackDir}" does not exist`,
      );
    }
  }

  // 3. runner.flow.prompts.registry — file must exist
  const registryPath = definition.runner?.flow?.prompts?.registry;
  if (typeof registryPath === "string" && registryPath !== "") {
    const resolved = join(agentDir, registryPath);
    if (!await fileExists(resolved)) {
      errors.push(
        `[PATH] Path not found: runner.flow.prompts.registry \u2192 "${registryPath}" does not exist`,
      );
    }
  }

  // 4. Registry outputSchemaRef file checks (only if registry is provided)
  if (registry) {
    const steps = asRecord(registry.steps);
    if (steps) {
      for (const [stepId, stepDef] of Object.entries(steps)) {
        const step = asRecord(stepDef);
        if (!step) continue;

        const schemaRef = asRecord(step.outputSchemaRef);
        if (!schemaRef) continue;

        const schemaFile = schemaRef.file;
        if (typeof schemaFile !== "string" || schemaFile === "") continue;

        const resolved = join(agentDir, "schemas", schemaFile);
        if (!await fileExists(resolved)) {
          errors.push(
            `[PATH] Path not found: steps["${stepId}"].outputSchemaRef.file \u2192 "schemas/${schemaFile}" does not exist`,
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
