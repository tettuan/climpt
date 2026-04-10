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

/** Warning fragment: uvVariables declares X but template has no {uv-X}. */
export const MSG_NO_UV_PREFIX = "no {uv-";

/** Warning fragment: C3L prompt file not found. */
export const MSG_C3L_NOT_FOUND = "C3L prompt file not found";

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
 * 2. Extract all {uv-xxx} placeholders from the template
 * 3. Compare against the step's uvVariables declaration
 * 4. Report undeclared usages (errors) and unused declarations (warnings)
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

    stepsToValidate.push({
      stepId,
      declared,
      promptPath,
    });
  }

  // Phase 2: Read all prompt files in parallel
  const promptContents = await Promise.all(
    stepsToValidate.map((s) => readFileOrNull(s.promptPath)),
  );

  // Phase 3: Compare template usage against declarations
  for (let i = 0; i < stepsToValidate.length; i++) {
    const { stepId, declared } = stepsToValidate[i];
    const promptContent = promptContents[i];

    const used = new Set<string>();

    // Extract UV variables from C3L prompt file
    if (promptContent !== null) {
      for (const v of extractUvVariables(promptContent)) {
        used.add(v);
      }
    }

    // If main prompt is missing, skip UV consistency check
    if (promptContent === null) {
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
