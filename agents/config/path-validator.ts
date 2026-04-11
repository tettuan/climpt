/**
 * Path Validator - Filesystem & Schema Name Validation
 *
 * Validates that file/directory paths referenced in AgentDefinition and
 * steps_registry.json actually exist on the filesystem. Additionally,
 * for outputSchemaRef entries, validates that the schema pointer (e.g.,
 * "#/definitions/step_name") resolves to an actual definition in the
 * referenced schema file.
 *
 * Responsibilities:
 * - File/directory existence checks (Deno.stat)
 * - Schema name resolution checks (SchemaResolver.checkPointerExists)
 *
 * Side effects: Reads filesystem metadata and schema file contents.
 *
 * @module
 */

import type { AgentDefinition, ValidationResult } from "../src_common/types.ts";
import { join } from "@std/path";
import {
  SchemaPointerError,
  SchemaResolver,
} from "../common/schema-resolver.ts";
import { buildPromptFilePath } from "./c3l-path-builder.ts";

// ---------------------------------------------------------------------------
// Error / warning message identifiers (exported for test assertions)
// ---------------------------------------------------------------------------

/** Prefix for filesystem path errors. */
export const MSG_PATH = "[PATH]";
/** Prefix for legacy field warnings. */
export const MSG_LEGACY = "[LEGACY]";
/** Prefix for schema resolution errors. */
export const MSG_SCHEMA = "[SCHEMA]";
/** Keyword: path does not exist. */
export const MSG_DOES_NOT_EXIST = "does not exist";
/** Keyword: systemPromptPath field name. */
export const MSG_SYSTEM_PROMPT_PATH = "systemPromptPath";
/** Keyword: prompts.registry field name. */
export const MSG_PROMPTS_REGISTRY = "prompts.registry";
/** Keyword: fallbackDir field name. */
export const MSG_FALLBACK_DIR = "fallbackDir";
/** Keyword: C3L prompt file. */
export const MSG_C3L_PROMPT_FILE = "C3L prompt file";
/** Keyword: outputSchemaRef field name. */
export const MSG_OUTPUT_SCHEMA_REF = "outputSchemaRef";
/** Keyword: not found (schema resolution). */
export const MSG_NOT_FOUND = "not found";
/** Keyword: failed to validate schema name. */
export const MSG_SCHEMA_VALIDATE_FAILED = "failed to validate schema name";

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
 * Returns true only if the path exists and is a directory.
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
 * @param promptRoot - Absolute prompt root resolved from app.yml, or null
 * @returns Validation result with errors for missing paths
 */
export async function validatePaths(
  definition: AgentDefinition,
  agentDir: string,
  registry?: Record<string, unknown> | null,
  promptRoot?: string | null,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. runner.flow.systemPromptPath -- file must exist
  const systemPromptPath = definition.runner?.flow?.systemPromptPath;
  if (typeof systemPromptPath === "string" && systemPromptPath !== "") {
    const resolved = join(agentDir, systemPromptPath);
    if (!await fileExists(resolved)) {
      errors.push(
        `[PATH] Path not found: runner.flow.systemPromptPath \u2192 "${systemPromptPath}" does not exist`,
      );
    }
  }

  // 2. runner.flow.prompts.registry -- file must exist
  const registryPath = definition.runner?.flow?.prompts?.registry;
  if (typeof registryPath === "string" && registryPath !== "") {
    const resolved = join(agentDir, registryPath);
    if (!await fileExists(resolved)) {
      errors.push(
        `[PATH] Path not found: runner.flow.prompts.registry \u2192 "${registryPath}" does not exist`,
      );
    }
  }

  // 3. runner.flow.prompts.fallbackDir -- legacy field, warn if present
  const fallbackDir = definition.runner?.flow?.prompts?.fallbackDir;
  if (typeof fallbackDir === "string" && fallbackDir !== "") {
    const resolved = join(agentDir, fallbackDir);
    if (!await dirExists(resolved)) {
      errors.push(
        `[PATH] Path not found: runner.flow.prompts.fallbackDir \u2192 "${fallbackDir}" does not exist`,
      );
    } else {
      warnings.push(
        `[LEGACY] runner.flow.prompts.fallbackDir is a legacy field; consider migrating to C3L prompt resolution`,
      );
    }
  }

  // 4. C3L prompt file existence checks (only if registry is provided)
  if (registry) {
    if (!promptRoot) {
      warnings.push(
        `${MSG_PATH} C3L prompt file checks skipped: app.yml not found or invalid (promptRoot unresolved)`,
      );
    } else {
      const steps = asRecord(registry.steps);
      if (steps) {
        const c3lChecks: { stepId: string; promptPath: string }[] = [];
        for (const [stepId, stepDef] of Object.entries(steps)) {
          const step = asRecord(stepDef);
          if (!step) continue;

          const c2 = step.c2;
          const c3 = step.c3;
          const edition = step.edition;
          if (
            typeof c2 !== "string" || c2 === "" ||
            typeof c3 !== "string" || c3 === "" ||
            typeof edition !== "string" || edition === ""
          ) {
            continue;
          }

          const adaptation = typeof step.adaptation === "string"
            ? step.adaptation
            : undefined;
          const promptPath = buildPromptFilePath(
            promptRoot,
            c2,
            c3,
            edition,
            adaptation,
          );
          c3lChecks.push({ stepId, promptPath });
        }

        const c3lResults = await Promise.all(
          c3lChecks.map((c) => fileExists(c.promptPath)),
        );
        for (let i = 0; i < c3lChecks.length; i++) {
          if (!c3lResults[i]) {
            const c = c3lChecks[i];
            const relativePath = c.promptPath.replace(promptRoot + "/", "");
            errors.push(
              `${MSG_PATH} C3L prompt file not found: steps["${c.stepId}"] \u2192 "${relativePath}" does not exist`,
            );
          }
        }
      }
    }
  }

  // 5. Registry outputSchemaRef file checks (only if registry is provided)
  if (registry) {
    const steps = asRecord(registry.steps);
    if (steps) {
      const schemaChecks: {
        stepId: string;
        schemaFile: string;
        resolved: string;
      }[] = [];
      for (const [stepId, stepDef] of Object.entries(steps)) {
        const step = asRecord(stepDef);
        if (!step) continue;

        const schemaRef = asRecord(step.outputSchemaRef);
        if (!schemaRef) continue;

        const schemaFile = schemaRef.file;
        if (typeof schemaFile !== "string" || schemaFile === "") continue;

        schemaChecks.push({
          stepId,
          schemaFile,
          resolved: join(agentDir, "schemas", schemaFile),
        });
      }

      const results = await Promise.all(
        schemaChecks.map((c) => fileExists(c.resolved)),
      );
      for (let i = 0; i < schemaChecks.length; i++) {
        if (!results[i]) {
          const c = schemaChecks[i];
          errors.push(
            `[PATH] Path not found: steps["${c.stepId}"].outputSchemaRef.file \u2192 "schemas/${c.schemaFile}" does not exist`,
          );
        }
      }

      // 4b. Schema name resolution: verify that the schema pointer
      //     resolves to an actual definition inside the schema file.
      //     Only check steps whose file exists (failed file checks
      //     already reported above).
      const schemasDir = join(agentDir, "schemas");
      const nameChecks: {
        stepId: string;
        schemaFile: string;
        schemaName: string;
      }[] = [];
      for (let i = 0; i < schemaChecks.length; i++) {
        if (!results[i]) continue; // file doesn't exist — already reported
        const c = schemaChecks[i];
        const step = asRecord((steps as Record<string, unknown>)[c.stepId]);
        if (!step) continue;
        const ref = asRecord(step.outputSchemaRef);
        if (!ref) continue;
        const schemaName = ref.schema;
        if (typeof schemaName !== "string" || schemaName === "") continue;
        nameChecks.push({
          stepId: c.stepId,
          schemaFile: c.schemaFile,
          schemaName,
        });
      }

      if (nameChecks.length > 0) {
        const resolver = new SchemaResolver(schemasDir);
        const nameResults = await Promise.allSettled(
          nameChecks.map((c) =>
            resolver.checkPointerExists(c.schemaFile, c.schemaName)
          ),
        );
        for (let i = 0; i < nameChecks.length; i++) {
          const result = nameResults[i];
          if (result.status === "rejected") {
            const c = nameChecks[i];
            if (result.reason instanceof SchemaPointerError) {
              errors.push(
                `[SCHEMA] Step "${c.stepId}": outputSchemaRef.schema "${c.schemaName}" not found in "schemas/${c.schemaFile}"`,
              );
            } else {
              // Unexpected error (e.g., JSON parse failure) — report as-is
              const msg = result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
              errors.push(
                `[SCHEMA] Step "${c.stepId}": failed to validate schema name "${c.schemaName}" in "schemas/${c.schemaFile}": ${msg}`,
              );
            }
          }
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
