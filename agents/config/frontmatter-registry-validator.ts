/**
 * Frontmatter-Registry UV Variables Consistency Validator
 *
 * Validates that uvVariables declared in prompt file frontmatter are consistent
 * with the uvVariables declarations in steps_registry.json.
 *
 * Two classes of mismatch:
 * - ERROR: Frontmatter declares a uvVariable not present in registry
 *   (will cause runtime confusion — frontmatter promises a variable the registry doesn't supply)
 * - WARNING: Registry declares a uvVariable not present in frontmatter
 *   (missing documentation in frontmatter, harmless but noisy)
 *
 * Responsibility: Cross-check frontmatter uvVariables against registry declarations (I/O)
 * Side effects: Reads prompt files from the filesystem
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";
import { RUNTIME_SUPPLIED_UV_VARS } from "../shared/constants.ts";
import { buildPromptFilePath } from "./c3l-path-builder.ts";
import { parseFrontmatter } from "../common/prompt-resolver.ts";

// ---------------------------------------------------------------------------
// Message constants (exported for test assertions — single source of truth)
// ---------------------------------------------------------------------------

/** Error fragment: frontmatter declares X but X is not in registry uvVariables. */
export const MSG_EXTRA_IN_FRONTMATTER =
  "declared in frontmatter but not in registry uvVariables";

/** Warning fragment: registry declares X but frontmatter does not list it. */
export const MSG_MISSING_IN_FRONTMATTER =
  "in registry uvVariables but not declared in frontmatter";

/** Info fragment: prompt file not found (skip). */
export const MSG_PROMPT_NOT_FOUND = "prompt file not found";

/** Info fragment: no frontmatter in prompt file (skip). */
export const MSG_NO_FRONTMATTER = "no frontmatter found";

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

/**
 * Extract uvVariables from parsed frontmatter.
 *
 * Frontmatter uvVariables can be:
 * - An array of strings: ["issue", "repo"]
 * - A comma-separated string: "issue, repo"
 *
 * Returns null if uvVariables is not present in frontmatter.
 */
function extractFrontmatterUvVars(
  frontmatter: Record<string, unknown>,
): Set<string> | null {
  const raw = frontmatter.uvVariables;
  if (raw === undefined || raw === null) {
    return null;
  }

  const result = new Set<string>();

  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === "string" && v.trim() !== "") {
        result.add(v.trim());
      }
    }
  } else if (typeof raw === "string" && raw.trim() !== "") {
    // Single value or comma-separated
    for (const v of raw.split(",")) {
      const trimmed = v.trim();
      if (trimmed !== "") {
        result.add(trimmed);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate frontmatter/registry consistency for UV variables.
 *
 * For each step in the registry:
 * 1. Determine the C3L prompt file path and read it
 * 2. Parse frontmatter using parseFrontmatter()
 * 3. Extract frontmatter.uvVariables (if present)
 * 4. Compare against the step's registry uvVariables declaration
 * 5. Report extra vars in frontmatter (errors) and missing vars in frontmatter (warnings)
 *
 * @param registry - Parsed steps_registry.json content
 * @param _agentDir - Unused (kept for backward compatibility of call sites)
 * @param _baseDir - Unused (kept for backward compatibility of call sites)
 * @param promptRoot - Absolute prompt root resolved from app.yml, or null
 * @returns Validation result with errors and warnings
 */
export async function validateFrontmatterRegistry(
  registry: Record<string, unknown>,
  _agentDir: string,
  _baseDir: string,
  promptRoot?: string | null,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepsRaw = asRecord(registry.steps) ?? {};

  if (!promptRoot) {
    return {
      valid: true,
      errors: [],
      warnings: [
        "Frontmatter consistency check skipped: app.yml not found or invalid (promptRoot unresolved)",
      ],
    };
  }

  // Phase 1: Collect step metadata and prompt file paths
  interface StepInfo {
    stepId: string;
    registryUvVars: Set<string>;
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

    const registryUvVars = new Set<string>();
    if (Array.isArray(uvVariables)) {
      for (const v of uvVariables) {
        if (typeof v === "string") {
          registryUvVars.add(v);
        }
      }
    }

    // Synthesize a C3LAddress for buildPromptFilePath. The validator works
    // on raw disk JSON (asRecord) which still carries the 5-tuple as
    // separate fields; c1 is unused by buildPromptFilePath itself.
    const promptPath = buildPromptFilePath(promptRoot, {
      c1: "",
      c2,
      c3,
      edition,
      adaptation: typeof adaptation === "string" ? adaptation : undefined,
    });

    stepsToValidate.push({
      stepId,
      registryUvVars,
      promptPath,
    });
  }

  // Phase 2: Read all prompt files in parallel
  const promptContents = await Promise.all(
    stepsToValidate.map((s) => readFileOrNull(s.promptPath)),
  );

  // Phase 3: Parse frontmatter and compare uvVariables
  for (let i = 0; i < stepsToValidate.length; i++) {
    const { stepId, registryUvVars } = stepsToValidate[i];
    const promptContent = promptContents[i];

    // Skip if prompt file doesn't exist (already caught by path-validator)
    if (promptContent === null) {
      continue;
    }

    // Parse frontmatter
    const frontmatter = parseFrontmatter(promptContent);
    if (frontmatter === null) {
      continue;
    }

    // Extract frontmatter uvVariables
    const frontmatterUvVars = extractFrontmatterUvVars(frontmatter);
    if (frontmatterUvVars === null) {
      continue;
    }

    // Compare: frontmatter vars not in registry (ERROR)
    // Skip runtime-supplied variables — they are injected by the runner
    for (const v of frontmatterUvVars) {
      if (!registryUvVars.has(v) && !RUNTIME_SUPPLIED_UV_VARS.has(v)) {
        errors.push(
          `steps["${stepId}"]: "${v}" is ${MSG_EXTRA_IN_FRONTMATTER}`,
        );
      }
    }

    // Compare: registry vars not in frontmatter (WARNING)
    // Skip runtime-supplied variables — they are injected by the runner
    for (const v of registryUvVars) {
      if (!frontmatterUvVars.has(v) && !RUNTIME_SUPPLIED_UV_VARS.has(v)) {
        warnings.push(
          `steps["${stepId}"]: "${v}" is ${MSG_MISSING_IN_FRONTMATTER}`,
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
