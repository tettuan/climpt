/**
 * Template UV Consistency Validator
 *
 * Validates that {uv-xxx} placeholders in prompt templates are consistent
 * with the uvVariables declarations in steps_registry.json.
 *
 * Two classes of mismatch:
 * - ERROR: Template uses {uv-foo} but "foo" is not declared in uvVariables
 *   (will fail at Layer 2 runtime variable substitution)
 * - WARNING: uvVariables declares "bar" but template has no {uv-bar}
 *   (unnecessary declaration, harmless but noisy)
 *
 * Responsibility: Cross-check template content against declarations (I/O)
 * Side effects: Reads prompt files from the filesystem
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";
import { RUNTIME_SUPPLIED_UV_VARS } from "../shared/constants.ts";
import { buildPromptFilePath } from "./c3l-path-builder.ts";

// ---------------------------------------------------------------------------
// Message constants (exported for test assertions — single source of truth)
// ---------------------------------------------------------------------------

/** Error fragment: template uses {uv-X} but X is not in uvVariables. */
export const MSG_NOT_DECLARED = "not declared in uvVariables";

/** Error fragment: fallback template uses an undeclared UV variable. */
export const MSG_FALLBACK_TEMPLATE = "fallback template uses";

/** Warning fragment: uvVariables declares X but template has no {uv-X}. */
export const MSG_NO_UV_PREFIX = "no {uv-";

/** Warning fragment: uvVariables declares X but fallback template has no {uv-X}. */
export const MSG_FALLBACK_NO_UV_PREFIX = "fallback template has no {uv-";

/** Warning fragment: C3L prompt file not found. */
export const MSG_C3L_NOT_FOUND = "C3L prompt file not found";

/** Warning fragment: fallback template also not found. */
export const MSG_ALSO_NOT_FOUND = "also not found";

/** Warning fragment: fallback template (key) referenced. */
export const MSG_FALLBACK_TEMPLATE_REF = "fallback template";

/** Warning fragment: UV consistency check skipped. */
export const MSG_UV_CHECK_SKIPPED = "UV consistency check skipped";

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

/** Extract all UV variable names from a template string. */
function extractUvVariables(content: string): Set<string> {
  const result = new Set<string>();
  const re = /\{uv-(\w+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    result.add(match[1]);
  }
  return result;
}

/**
 * Read a file's text content. Returns null if the file does not exist
 * or cannot be read.
 */
async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (e: unknown) {
    if (e instanceof Deno.errors.NotFound) {
      return null;
    }
    // Permission errors or other I/O failures: skip gracefully
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate template/declaration consistency for UV variables.
 *
 * For each step in the registry:
 * 1. Determine the C3L prompt file path and read it
 * 2. Look up the fallback template (if fallbackKey is declared)
 * 3. Extract all {uv-xxx} placeholders from both sources
 * 4. Compare against the step's uvVariables declaration
 * 5. Report undeclared usages (errors) and unused declarations (warnings)
 *
 * @param registry - Parsed steps_registry.json content
 * @param agentDir - Absolute path to the agent directory (e.g., .agent/my-agent)
 * @param baseDir - Working directory root (prompt files live under {baseDir}/.agent/{id}/prompts/)
 * @returns Validation result with errors and warnings
 */
export async function validateTemplateUvConsistency(
  registry: Record<string, unknown>,
  agentDir: string,
  _baseDir: string,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepsRaw = asRecord(registry.steps) ?? {};
  const c1 = typeof registry.c1 === "string" ? registry.c1 : "steps";

  // Phase 1: Collect step metadata and prompt file paths
  interface StepInfo {
    stepId: string;
    declared: Set<string>;
    promptPath: string;
    fallbackKey: string;
    c1: string;
    edition: string;
    adaptation: string | undefined;
  }

  const stepsToValidate: StepInfo[] = [];

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const c2 = step.c2;
    const c3 = step.c3;
    const edition = step.edition;
    const adaptation = step.adaptation;
    const uvVariables = step.uvVariables;
    const fallbackKey = typeof step.fallbackKey === "string"
      ? step.fallbackKey
      : "";

    if (
      typeof c2 !== "string" || c2 === "" ||
      typeof c3 !== "string" || c3 === "" ||
      typeof edition !== "string" || edition === ""
    ) {
      continue;
    }

    const declared = new Set<string>();
    if (Array.isArray(uvVariables)) {
      for (const v of uvVariables) {
        if (typeof v === "string") {
          declared.add(v);
        }
      }
    }

    const promptPath = buildPromptFilePath(
      agentDir,
      c1,
      c2,
      c3,
      edition,
      typeof adaptation === "string" ? adaptation : undefined,
    );

    const adaptationStr = typeof adaptation === "string"
      ? adaptation
      : undefined;

    stepsToValidate.push({
      stepId,
      declared,
      promptPath,
      fallbackKey,
      c1,
      edition,
      adaptation: adaptationStr,
    });
  }

  // Phase 2: Read all prompt files in parallel
  const promptContents = await Promise.all(
    stepsToValidate.map((s) => readFileOrNull(s.promptPath)),
  );

  // Phase 3: Compare template usage against declarations
  for (let i = 0; i < stepsToValidate.length; i++) {
    const {
      stepId,
      declared,
      fallbackKey,
      c1: stepC1,
      edition: stepEdition,
      adaptation: stepAdaptation,
    } = stepsToValidate[i];
    const promptContent = promptContents[i];

    const used = new Set<string>();

    // Extract UV variables from C3L prompt file
    if (promptContent !== null) {
      for (const v of extractUvVariables(promptContent)) {
        used.add(v);
      }
    }

    // If main prompt is missing, attempt fallback template lookup
    if (promptContent === null) {
      if (fallbackKey !== "") {
        // Parse fallbackKey: "initial_issue" → c2="initial", c3="issue"
        const parts = fallbackKey.split("_");
        const fallbackC2 = parts[0];
        const fallbackC3 = parts.slice(1).join("_");

        if (fallbackC2 && fallbackC3) {
          const fallbackPath = buildPromptFilePath(
            agentDir,
            stepC1,
            fallbackC2,
            fallbackC3,
            stepEdition,
            stepAdaptation,
          );
          const fallbackContent = await readFileOrNull(fallbackPath);

          if (fallbackContent !== null) {
            // Run UV consistency check on fallback template
            const fallbackUsed = extractUvVariables(fallbackContent);

            // Undeclared usages in fallback (ERROR)
            for (const v of fallbackUsed) {
              if (!declared.has(v) && !RUNTIME_SUPPLIED_UV_VARS.has(v)) {
                errors.push(
                  `steps["${stepId}"]: fallback template uses {uv-${v}} but "${v}" is not declared in uvVariables`,
                );
              }
            }

            // Unused declarations vs fallback (WARNING)
            for (const v of declared) {
              if (!fallbackUsed.has(v)) {
                warnings.push(
                  `steps["${stepId}"]: uvVariables declares "${v}" but fallback template has no {uv-${v}}`,
                );
              }
            }
            continue;
          }

          // Both main and fallback missing
          warnings.push(
            `steps["${stepId}"]: C3L prompt file not found and fallback template (${fallbackKey}) also not found, UV consistency check skipped`,
          );
          continue;
        }
      }

      // No fallbackKey or invalid fallbackKey — original behavior
      warnings.push(
        `steps["${stepId}"]: C3L prompt file not found, UV consistency check skipped`,
      );
      continue;
    }

    // Undeclared usages (ERROR)
    // Skip runtime-supplied variables — they are injected by the runner
    // or verdict handler at execution time, not from uvVariables declarations.
    for (const v of used) {
      if (!declared.has(v) && !RUNTIME_SUPPLIED_UV_VARS.has(v)) {
        errors.push(
          `steps["${stepId}"]: template uses {uv-${v}} but "${v}" is not declared in uvVariables`,
        );
      }
    }

    // Unused declarations (WARNING)
    for (const v of declared) {
      if (!used.has(v)) {
        warnings.push(
          `steps["${stepId}"]: uvVariables declares "${v}" but template has no {uv-${v}}`,
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
