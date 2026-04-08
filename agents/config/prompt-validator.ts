/**
 * Prompt Resolution Validator
 *
 * Validates that each step in steps_registry.json has a resolvable prompt:
 * - C3L path components (c2, c3) are non-empty strings
 * - C3L path components are consistent with stepId
 * - C3L prompt files exist on disk (warnings for missing files)
 * - Fallback templates exist when fallbackKey is specified
 *
 * Responsibility: Verify prompt resolution feasibility
 * Side effects: Reads filesystem metadata (Deno.stat) when agentDir is provided
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";
import { buildPromptFilePath } from "./c3l-path-builder.ts";

// ---------------------------------------------------------------------------
// Exported error/warning message identifiers
// ---------------------------------------------------------------------------

/** Prefix for all file-existence warnings. */
export const MSG_PROMPT_PREFIX = "[PROMPT]";
/** Fragment: main C3L file was not found. */
export const MSG_NOT_FOUND = "not found";
/** Fragment: fallback template for a key exists on disk. */
export const MSG_FALLBACK_EXISTS = "fallback template";
/** Fragment appended when fallback template also exists. */
export const MSG_FALLBACK_EXISTS_SUFFIX = "exists";
/** Fragment: fallback template was also not found. */
export const MSG_ALSO_NOT_FOUND = "also not found";
/** Fragment: step has no fallbackKey specified. */
export const MSG_NO_FALLBACK_KEY = "no fallbackKey";
/** Fragment: c2 field is missing or empty. */
export const MSG_C2_MISSING = "c2 is missing or empty";
/** Fragment: c3 field is missing or empty. */
export const MSG_C3_MISSING = "c3 is missing or empty";

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
 * Check whether a path exists and is a file.
 * Returns true if it exists and is a file, false otherwise.
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate prompt resolution for all steps in a steps registry.
 *
 * Checks per step:
 * 1. c2 and c3 are non-empty strings
 * 2. c2 and c3 are consistent with stepId parts
 * 3. C3L prompt file exists on disk (when agentDir is provided)
 * 4. Fallback template exists when fallbackKey is specified and main file is missing
 *
 * @param registry - Parsed steps_registry.json content
 * @param agentDir - Absolute path to the agent directory (optional; enables file checks)
 * @returns Validation result with errors and warnings
 */
export async function validatePrompts(
  registry: Record<string, unknown>,
  agentDir?: string,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepsRaw = asRecord(registry.steps) ?? {};

  // Collect file-check targets so we can run them in parallel later.
  const fileChecks: {
    stepId: string;
    mainPath: string;
    fallbackPath: string | null;
    fallbackKey: string;
    edition: string;
  }[] = [];

  const c1 = typeof registry.c1 === "string" ? registry.c1 : "steps";

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    // 1. C3L path components must be non-empty strings
    const c2 = step.c2;
    const c3 = step.c3;

    if (typeof c2 !== "string" || c2 === "") {
      errors.push(
        `steps["${stepId}"].${MSG_C2_MISSING}`,
      );
    }

    if (typeof c3 !== "string" || c3 === "") {
      errors.push(
        `steps["${stepId}"].${MSG_C3_MISSING}`,
      );
    }

    // 2. C3L path components consistency with stepId
    // stepId format: "c2.c3" (e.g., "initial.issue") or "c2.c3.suffix"
    // (e.g., "initial.project.preparation")
    if (
      typeof c2 === "string" && c2 !== "" && typeof c3 === "string" &&
      c3 !== ""
    ) {
      const parts = stepId.split(".");
      if (parts.length >= 2) {
        const stepIdC2 = parts[0];
        const stepIdC3 = parts[1];
        if (c2 !== stepIdC2) {
          warnings.push(
            `steps["${stepId}"].c2 is "${c2}" but stepId prefix is "${stepIdC2}"`,
          );
        }
        if (c3 !== stepIdC3) {
          warnings.push(
            `steps["${stepId}"].c3 is "${c3}" but stepId second part is "${stepIdC3}"`,
          );
        }
      }

      // 3. Prepare file existence check (only when agentDir is provided)
      if (agentDir) {
        const edition = typeof step.edition === "string" && step.edition !== ""
          ? step.edition
          : "default";
        const adaptation = typeof step.adaptation === "string"
          ? step.adaptation
          : undefined;
        const mainPath = buildPromptFilePath(
          agentDir,
          c1,
          c2,
          c3,
          edition,
          adaptation,
        );

        const fallbackKey = typeof step.fallbackKey === "string"
          ? step.fallbackKey
          : "";

        let fallbackPath: string | null = null;
        if (fallbackKey !== "") {
          // fallbackKey format: "c2_c3" — first part is c2, remaining joined is c3
          const fbParts = fallbackKey.split("_");
          if (fbParts.length >= 2) {
            const fbC2 = fbParts[0];
            const fbC3 = fbParts.slice(1).join("_");
            fallbackPath = buildPromptFilePath(
              agentDir,
              c1,
              fbC2,
              fbC3,
              edition,
            );
          }
        }

        fileChecks.push({
          stepId,
          mainPath,
          fallbackPath,
          fallbackKey,
          edition,
        });
      }
    }
  }

  // 3-4. Run file existence checks in parallel
  if (fileChecks.length > 0) {
    // Build a flat list of all paths to check
    const allPaths: string[] = [];
    for (const fc of fileChecks) {
      allPaths.push(fc.mainPath);
      if (fc.fallbackPath) {
        allPaths.push(fc.fallbackPath);
      }
    }

    const existsResults = await Promise.all(allPaths.map(fileExists));

    // Map results back to each check
    let idx = 0;
    for (const fc of fileChecks) {
      const mainExists = existsResults[idx++];
      const fallbackExists = fc.fallbackPath ? existsResults[idx++] : false;

      if (!mainExists) {
        const relativePath = fc.mainPath.replace(agentDir! + "/", "");
        if (fc.fallbackKey !== "" && fc.fallbackPath) {
          if (fallbackExists) {
            warnings.push(
              `${MSG_PROMPT_PREFIX} steps["${fc.stepId}"]: main C3L file "${relativePath}" ${MSG_NOT_FOUND}, ` +
                `but ${MSG_FALLBACK_EXISTS} for "${fc.fallbackKey}" ${MSG_FALLBACK_EXISTS_SUFFIX}`,
            );
          } else {
            const fbRelativePath = fc.fallbackPath.replace(
              agentDir! + "/",
              "",
            );
            warnings.push(
              `${MSG_PROMPT_PREFIX} steps["${fc.stepId}"]: main C3L file "${relativePath}" ${MSG_NOT_FOUND} ` +
                `and ${MSG_FALLBACK_EXISTS} "${fbRelativePath}" ${MSG_ALSO_NOT_FOUND}`,
            );
          }
        } else {
          warnings.push(
            `${MSG_PROMPT_PREFIX} steps["${fc.stepId}"]: C3L file "${relativePath}" ${MSG_NOT_FOUND} ` +
              `and ${MSG_NO_FALLBACK_KEY} specified`,
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
