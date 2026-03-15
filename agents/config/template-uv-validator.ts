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
import { DefaultFallbackProvider } from "../prompts/fallback.ts";
import { join } from "@std/path";

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
 * Build the C3L prompt file path for a step.
 *
 * Format: {agentDir}/prompts/{c1}/{c2}/{c3}/f_{edition}.md
 * or with adaptation: {agentDir}/prompts/{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md
 */
function buildPromptFilePath(
  agentDir: string,
  c1: string,
  c2: string,
  c3: string,
  edition: string,
  adaptation?: string,
): string {
  const filename = adaptation
    ? `f_${edition}_${adaptation}.md`
    : `f_${edition}.md`;
  return join(agentDir, "prompts", c1, c2, c3, filename);
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

  const fallbackProvider = new DefaultFallbackProvider();

  // Phase 1: Collect step metadata and prompt file paths
  interface StepInfo {
    stepId: string;
    declared: Set<string>;
    promptPath: string;
    fallbackKey: string | null;
  }

  const stepsToValidate: StepInfo[] = [];

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const c2 = step.c2;
    const c3 = step.c3;
    const edition = step.edition;
    const adaptation = step.adaptation;
    const fallbackKey = step.fallbackKey;
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
      fallbackKey: typeof fallbackKey === "string" && fallbackKey !== ""
        ? fallbackKey
        : null,
    });
  }

  // Phase 2: Read all prompt files in parallel
  const promptContents = await Promise.all(
    stepsToValidate.map((s) => readFileOrNull(s.promptPath)),
  );

  // Phase 3: Compare template usage against declarations
  for (let i = 0; i < stepsToValidate.length; i++) {
    const { stepId, declared, fallbackKey } = stepsToValidate[i];
    const promptContent = promptContents[i];

    const used = new Set<string>();

    // Source 1: C3L prompt file
    if (promptContent !== null) {
      for (const v of extractUvVariables(promptContent)) {
        used.add(v);
      }
    }

    // Source 2: Fallback template (only when a C3L prompt file exists)
    // When promptContent is null, the step has no C3L file and the fallback
    // is a system-provided safety net -- its UV requirements should not be
    // imposed on the agent config.
    if (
      promptContent !== null && fallbackKey !== null &&
      fallbackProvider.hasTemplate(fallbackKey)
    ) {
      const fallbackTemplates = fallbackProvider.getTemplates();
      const fallbackContent = fallbackTemplates[fallbackKey];
      if (fallbackContent) {
        for (const v of extractUvVariables(fallbackContent)) {
          used.add(v);
        }
      }
    }

    // Skip if neither source yielded content
    if (promptContent === null && used.size === 0) {
      continue;
    }

    // Undeclared usages (ERROR)
    for (const v of used) {
      if (!declared.has(v)) {
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
