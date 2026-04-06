/**
 * Configuration Validator - Configuration Validation
 *
 * Responsibility: Validate AgentDefinition only
 * Side effects: None (Query)
 *
 * @post valid=true implies errors.length === 0
 */

import type {
  AgentDefinition,
  ValidationResult,
  VerdictType,
} from "../src_common/types.ts";
import { ALL_VERDICT_TYPES } from "../src_common/types.ts";

/**
 * Type guard to check if a string is a valid VerdictType
 */
function isValidVerdictType(value: string): value is VerdictType {
  return ALL_VERDICT_TYPES.includes(value as VerdictType);
}

/**
 * Required fields for a valid agent definition
 */
const REQUIRED_FIELDS = [
  "name",
  "displayName",
  "runner",
] as const;

/**
 * Known top-level keys for AgentDefinition.
 * Any key not in this set triggers an unknown-key warning.
 */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "name",
  "displayName",
  "description",
  "version",
  "runner",
  "parameters",
  "labels",
  "$schema",
]);

/**
 * v1.11.x legacy top-level keys that were moved under runner.* in v1.12.0.
 */
const LEGACY_TOP_LEVEL_KEYS = new Set([
  "behavior",
  "prompts",
  "logging",
]);

/**
 * Valid permission modes
 */
const VALID_PERMISSION_MODES = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
];

/**
 * Valid logging formats
 */
const VALID_LOGGING_FORMATS = ["jsonl", "text"];

/**
 * Validate agent definition.
 * Does NOT modify the definition.
 *
 * @param definition - Raw definition to validate
 * @returns Validation result with errors and warnings
 */
export function validate(definition: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!definition || typeof definition !== "object") {
    return {
      valid: false,
      errors: [
        "[CONFIGURATION] Definition must be an object. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      ],
      warnings,
    };
  }

  const def = definition as Record<string, unknown>;

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in def)) {
      errors.push(
        `[CONFIGURATION] Missing required field: ${field}. ` +
          `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
      );
    }
  }

  // DC1: Legacy v1.11.x format detection
  if (!("runner" in def)) {
    const hasLegacyKey = Object.keys(def).some((k) =>
      LEGACY_TOP_LEVEL_KEYS.has(k)
    );
    if (hasLegacyKey) {
      errors.push(
        "[CONFIGURATION] Detected v1.11.x config format. The flat structure (behavior, prompts, logging) " +
          "was replaced with the runner.* hierarchy in v1.12.0. " +
          "\u2192 See: docs/guides/en/09-migration-guide.md",
      );
    }
  }

  // DC2: Unknown top-level key warnings
  const unknownKeys = Object.keys(def).filter((k) =>
    !KNOWN_TOP_LEVEL_KEYS.has(k)
  );
  if (unknownKeys.length > 0) {
    warnings.push(
      `Unknown top-level keys will be ignored: ${unknownKeys.join(", ")}. ` +
        "These may be v1.11.x keys that need to be moved under runner.*",
    );
  }

  // Validate name
  if (typeof def.name === "string") {
    if (!/^[a-z][a-z0-9-]*$/.test(def.name)) {
      errors.push(
        "[CONFIGURATION] Name must be lowercase alphanumeric with hyphens, starting with a letter. " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
    }
  } else if (def.name !== undefined) {
    errors.push(
      "[CONFIGURATION] Name must be a string. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
  }

  // Validate version if present
  if (def.version !== undefined) {
    if (typeof def.version !== "string") {
      errors.push(
        "[CONFIGURATION] version must be a string. " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
    } else if (!/^\d+\.\d+\.\d+$/.test(def.version)) {
      errors.push(
        "[CONFIGURATION] version must be semver format (e.g., '1.0.0'). " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
    }
  }

  // Validate runner
  if (def.runner && typeof def.runner === "object") {
    const runner = def.runner as Record<string, unknown>;

    // Validate runner.verdict
    if (runner.verdict && typeof runner.verdict === "object") {
      const verdict = runner.verdict as Record<string, unknown>;

      if (verdict.type) {
        const verdictTypeStr = String(verdict.type);
        if (
          typeof verdict.type !== "string" ||
          !isValidVerdictType(verdictTypeStr)
        ) {
          errors.push(
            `[CONFIGURATION] Invalid verdict type: ${verdict.type}. Must be one of: ${
              ALL_VERDICT_TYPES.join(", ")
            }. ` +
              `\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict`,
          );
        }
      }

      // Validate verdict config based on type
      if (verdict.type && verdict.config) {
        validateVerdictConfig(
          verdict.type as string,
          verdict.config as Record<string, unknown>,
          errors,
        );
      }
    }

    // Validate runner.boundaries
    if (runner.boundaries && typeof runner.boundaries === "object") {
      const boundaries = runner.boundaries as Record<string, unknown>;

      if (
        boundaries.permissionMode &&
        !VALID_PERMISSION_MODES.includes(boundaries.permissionMode as string)
      ) {
        errors.push(
          `[CONFIGURATION] runner.boundaries.permissionMode must be one of: ${
            VALID_PERMISSION_MODES.join(", ")
          }. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      }
    }

    // Validate runner.flow.prompts
    if (runner.flow && typeof runner.flow === "object") {
      const flow = runner.flow as Record<string, unknown>;
      if (flow.prompts && typeof flow.prompts === "object") {
        const prompts = flow.prompts as Record<string, unknown>;
        if (prompts.registry && typeof prompts.registry !== "string") {
          errors.push(
            "[CONFIGURATION] runner.flow.prompts.registry must be a string path. " +
              "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
          );
        }
        if (prompts.fallbackDir && typeof prompts.fallbackDir !== "string") {
          errors.push(
            "[CONFIGURATION] runner.flow.prompts.fallbackDir must be a string path. " +
              "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
          );
        }
      }
    }

    // Validate runner.logging
    if (runner.logging && typeof runner.logging === "object") {
      const logging = runner.logging as Record<string, unknown>;

      if (
        logging.format &&
        !VALID_LOGGING_FORMATS.includes(logging.format as string)
      ) {
        errors.push(
          `[CONFIGURATION] runner.logging.format must be one of: ${
            VALID_LOGGING_FORMATS.join(", ")
          }. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      }
      if (logging.directory && typeof logging.directory !== "string") {
        errors.push(
          "[CONFIGURATION] runner.logging.directory must be a string. " +
            "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
        );
      }
    }
  }

  // Validate parameters if present
  if (def.parameters && typeof def.parameters === "object") {
    // P3-2: Collect CLI flags for uniqueness check
    const cliFlagMap = new Map<string, string[]>();

    for (const [name, param] of Object.entries(def.parameters)) {
      const paramObj = param as Record<string, unknown>;
      if (!paramObj.cli) {
        errors.push(
          `[CONFIGURATION] Parameter '${name}' missing cli flag. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      } else if (
        typeof paramObj.cli === "string" &&
        !paramObj.cli.startsWith("--")
      ) {
        errors.push(
          `[CONFIGURATION] Parameter '${name}' cli flag must start with '--'. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      }

      // Track CLI flag for uniqueness (P3-2)
      if (typeof paramObj.cli === "string") {
        const existing = cliFlagMap.get(paramObj.cli);
        if (existing) {
          existing.push(name);
        } else {
          cliFlagMap.set(paramObj.cli, [name]);
        }
      }

      if (!paramObj.type) {
        errors.push(
          `[CONFIGURATION] Parameter '${name}' missing type. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      }

      // P3-3: Check type vs default value type consistency
      if (
        typeof paramObj.type === "string" &&
        paramObj.default !== undefined
      ) {
        const declaredType = paramObj.type;
        const defaultVal = paramObj.default;
        let mismatch = false;

        switch (declaredType) {
          case "string":
            mismatch = typeof defaultVal !== "string";
            break;
          case "number":
            mismatch = typeof defaultVal !== "number";
            break;
          case "boolean":
            mismatch = typeof defaultVal !== "boolean";
            break;
          case "array":
            mismatch = !Array.isArray(defaultVal);
            break;
        }

        if (mismatch) {
          errors.push(
            `[CONFIGURATION] Parameter '${name}': default value type '${typeof defaultVal}' does not match declared type '${declaredType}'. ` +
              `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
          );
        }
      }

      if (!paramObj.description) {
        warnings.push(`Parameter '${name}' missing description`);
      }
      if (paramObj.required && paramObj.default !== undefined) {
        warnings.push(
          `Parameter '${name}' is required but has default value`,
        );
      }
    }

    // P3-2: Report duplicate CLI flags
    for (const [flag, names] of cliFlagMap) {
      if (names.length > 1) {
        errors.push(
          `[CONFIGURATION] CLI flag '${flag}' is used by multiple parameters: ${
            names.join(", ")
          }. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
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

/**
 * Validate verdict config based on verdict type.
 */
function validateVerdictConfig(
  verdictType: string,
  config: Record<string, unknown>,
  errors: string[],
): void {
  if (!isValidVerdictType(verdictType)) {
    return; // Invalid type is already handled by the main validate function
  }

  switch (verdictType as VerdictType) {
    case "count:iteration":
      if (!config.maxIterations) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.maxIterations is required for count:iteration verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      } else if (
        typeof config.maxIterations !== "number" ||
        config.maxIterations < 1
      ) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.maxIterations must be a positive number. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "detect:keyword":
      if (!config.verdictKeyword) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.verdictKeyword is required for detect:keyword verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "meta:custom":
      if (!config.handlerPath) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.handlerPath is required for meta:custom verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "count:check":
      if (!config.maxChecks) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.maxChecks is required for count:check verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      } else if (
        typeof config.maxChecks !== "number" ||
        config.maxChecks < 1
      ) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.maxChecks must be a positive number. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "detect:structured":
      if (!config.signalType) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.signalType is required for detect:structured verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "meta:composite":
      if (!config.operator) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.operator is required for meta:composite verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      if (
        !config.conditions ||
        !Array.isArray(config.conditions) ||
        config.conditions.length === 0
      ) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.conditions is required for meta:composite verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    // detect:graph, poll:state - use runtime parameters, no strict validation here
    case "detect:graph":
    case "poll:state":
      break;
  }
}

/**
 * Validate that a definition is complete (after defaults applied).
 *
 * @param definition - Typed AgentDefinition (after defaults)
 * @returns Validation result
 */
export function validateComplete(
  definition: AgentDefinition,
): ValidationResult {
  const result = validate(definition);

  // Additional checks for complete definition
  if (!definition.runner?.verdict?.type) {
    result.errors.push(
      "[CONFIGURATION] runner.verdict.type is required. " +
        "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
    );
    result.valid = false;
  }

  if (!definition.runner?.flow?.systemPromptPath) {
    result.errors.push(
      "[CONFIGURATION] runner.flow.systemPromptPath is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
    result.valid = false;
  }

  if (!definition.runner?.boundaries?.allowedTools) {
    result.errors.push(
      "[CONFIGURATION] runner.boundaries.allowedTools is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
    result.valid = false;
  }

  if (!definition.runner?.boundaries?.permissionMode) {
    result.errors.push(
      "[CONFIGURATION] runner.boundaries.permissionMode is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
    result.valid = false;
  }

  if (!definition.runner?.flow?.prompts?.registry) {
    result.errors.push(
      "[CONFIGURATION] runner.flow.prompts.registry is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
    result.valid = false;
  }

  if (!definition.runner?.flow?.prompts?.fallbackDir) {
    result.errors.push(
      "[CONFIGURATION] runner.flow.prompts.fallbackDir is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
    result.valid = false;
  }

  // Logging is optional before defaults; after defaults it's guaranteed.
  // Only validate if logging is present.
  if (definition.runner?.logging) {
    if (!definition.runner.logging.directory) {
      result.errors.push(
        "[CONFIGURATION] runner.logging.directory is required. " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
      result.valid = false;
    }
    if (!definition.runner.logging.format) {
      result.errors.push(
        "[CONFIGURATION] runner.logging.format is required. " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
      result.valid = false;
    }
  }

  return result;
}
