/**
 * Prompt Resolution Validator
 *
 * Validates that each step in steps_registry.json has a resolvable prompt:
 * - C3L path components (c2, c3) are non-empty strings
 * - C3L path components are consistent with stepId
 * - C3L prompt files exist on disk (warnings for missing files)
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
 * 3. C3L prompt file exists on disk (when promptRoot is provided)
 *
 * @param registry - Parsed steps_registry.json content
 * @param _agentDir - Unused (kept for backward compatibility of call sites)
 * @param promptRoot - Absolute prompt root resolved from app.yml (optional; enables file checks)
 * @returns Validation result with errors and warnings
 */
export async function validatePrompts(
  registry: Record<string, unknown>,
  _agentDir?: string,
  promptRoot?: string | null,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepsRaw = asRecord(registry.steps) ?? {};

  // Collect file-check targets so we can run them in parallel later.
  const fileChecks: {
    stepId: string;
    mainPath: string;
  }[] = [];

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    // 1. C3L path components must be non-empty strings.
    // Read from the typed `address` aggregate per design 14 §C — the disk
    // shape places C3L coordinates inside `address`, never as flat
    // `step.c2` / `step.c3` siblings.
    const address = asRecord(step.address) ?? {};
    const c2 = address.c2;
    const c3 = address.c3;

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

      // 3. Prepare file existence check (only when promptRoot is provided)
      if (promptRoot) {
        const edition =
          typeof address.edition === "string" && address.edition !== ""
            ? address.edition
            : "default";
        const adaptation = typeof address.adaptation === "string"
          ? address.adaptation
          : undefined;
        // Build a C3LAddress for buildPromptFilePath directly from the raw
        // disk-shape `address` aggregate (design 14 §C). c1 is unused by
        // buildPromptFilePath itself, so leaving it empty is intentional.
        const mainPath = buildPromptFilePath(promptRoot, {
          c1: "",
          c2,
          c3,
          edition,
          adaptation,
        });

        fileChecks.push({
          stepId,
          mainPath,
        });
      }
    }
  }

  // 3. Run file existence checks in parallel
  if (fileChecks.length > 0 && promptRoot) {
    const existsResults = await Promise.all(
      fileChecks.map((fc) => fileExists(fc.mainPath)),
    );

    for (let idx = 0; idx < fileChecks.length; idx++) {
      if (!existsResults[idx]) {
        const relativePath = fileChecks[idx].mainPath.replace(
          promptRoot + "/",
          "",
        );
        warnings.push(
          `${MSG_PROMPT_PREFIX} steps["${
            fileChecks[idx].stepId
          }"]: C3L file "${relativePath}" ${MSG_NOT_FOUND}`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
