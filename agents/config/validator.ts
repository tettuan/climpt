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
  CompletionType,
  ValidationResult,
} from "../src_common/types.ts";
import { ALL_COMPLETION_TYPES } from "../src_common/types.ts";

/**
 * Type guard to check if a string is a valid CompletionType
 */
function isValidCompletionType(value: string): value is CompletionType {
  return ALL_COMPLETION_TYPES.includes(value as CompletionType);
}

/**
 * Required fields for a valid agent definition
 */
const REQUIRED_FIELDS = [
  "name",
  "displayName",
  "behavior",
  "prompts",
  "logging",
] as const;

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
    return { valid: false, errors: ["Definition must be an object"], warnings };
  }

  const def = definition as Record<string, unknown>;

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in def)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate name
  if (typeof def.name === "string") {
    if (!/^[a-z][a-z0-9-]*$/.test(def.name)) {
      errors.push(
        "Name must be lowercase alphanumeric with hyphens, starting with a letter",
      );
    }
  } else if (def.name !== undefined) {
    errors.push("Name must be a string");
  }

  // Validate version if present
  if (def.version !== undefined) {
    if (typeof def.version !== "string") {
      errors.push("version must be a string");
    } else if (!/^\d+\.\d+\.\d+$/.test(def.version)) {
      errors.push("version must be semver format (e.g., '1.0.0')");
    }
  }

  // Validate behavior
  if (def.behavior && typeof def.behavior === "object") {
    const behavior = def.behavior as Record<string, unknown>;

    // Check for completion type
    if (behavior.completionType) {
      const completionTypeStr = String(behavior.completionType);
      if (
        typeof behavior.completionType !== "string" ||
        !isValidCompletionType(completionTypeStr)
      ) {
        errors.push(
          `Invalid completion type: ${behavior.completionType}. Must be one of: ${
            ALL_COMPLETION_TYPES.join(", ")
          }`,
        );
      }
    }

    // Validate permission mode
    if (
      behavior.permissionMode &&
      !VALID_PERMISSION_MODES.includes(behavior.permissionMode as string)
    ) {
      errors.push(
        `behavior.permissionMode must be one of: ${
          VALID_PERMISSION_MODES.join(", ")
        }`,
      );
    }

    // Validate completion config based on type
    if (behavior.completionType && behavior.completionConfig) {
      validateCompletionConfig(
        behavior.completionType as string,
        behavior.completionConfig as Record<string, unknown>,
        errors,
      );
    }
  }

  // Validate prompts
  if (def.prompts && typeof def.prompts === "object") {
    const prompts = def.prompts as Record<string, unknown>;

    if (prompts.registry && typeof prompts.registry !== "string") {
      errors.push("prompts.registry must be a string path");
    }
    if (prompts.fallbackDir && typeof prompts.fallbackDir !== "string") {
      errors.push("prompts.fallbackDir must be a string path");
    }
  }

  // Validate logging
  if (def.logging && typeof def.logging === "object") {
    const logging = def.logging as Record<string, unknown>;

    if (
      logging.format &&
      !VALID_LOGGING_FORMATS.includes(logging.format as string)
    ) {
      errors.push(
        `logging.format must be one of: ${VALID_LOGGING_FORMATS.join(", ")}`,
      );
    }
    if (logging.directory && typeof logging.directory !== "string") {
      errors.push("logging.directory must be a string");
    }
  }

  // Validate parameters if present
  if (def.parameters && typeof def.parameters === "object") {
    for (const [name, param] of Object.entries(def.parameters)) {
      const paramObj = param as Record<string, unknown>;
      if (!paramObj.cli) {
        errors.push(`Parameter '${name}' missing cli flag`);
      } else if (
        typeof paramObj.cli === "string" &&
        !paramObj.cli.startsWith("--")
      ) {
        errors.push(`Parameter '${name}' cli flag must start with '--'`);
      }
      if (!paramObj.type) {
        errors.push(`Parameter '${name}' missing type`);
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
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate completion config based on completion type.
 */
function validateCompletionConfig(
  completionType: string,
  config: Record<string, unknown>,
  errors: string[],
): void {
  if (!isValidCompletionType(completionType)) {
    return; // Invalid type is already handled by the main validate function
  }

  switch (completionType as CompletionType) {
    case "iterationBudget":
      if (!config.maxIterations) {
        errors.push(
          "behavior.completionConfig.maxIterations is required for iterationBudget completion type",
        );
      } else if (
        typeof config.maxIterations !== "number" ||
        config.maxIterations < 1
      ) {
        errors.push(
          "behavior.completionConfig.maxIterations must be a positive number",
        );
      }
      break;

    case "keywordSignal":
      if (!config.completionKeyword) {
        errors.push(
          "behavior.completionConfig.completionKeyword is required for keywordSignal completion type",
        );
      }
      break;

    case "custom":
      if (!config.handlerPath) {
        errors.push(
          "behavior.completionConfig.handlerPath is required for custom completion type",
        );
      }
      break;

    case "checkBudget":
      if (!config.maxChecks) {
        errors.push(
          "behavior.completionConfig.maxChecks is required for checkBudget completion type",
        );
      } else if (
        typeof config.maxChecks !== "number" ||
        config.maxChecks < 1
      ) {
        errors.push(
          "behavior.completionConfig.maxChecks must be a positive number",
        );
      }
      break;

    case "structuredSignal":
      if (!config.signalType) {
        errors.push(
          "behavior.completionConfig.signalType is required for structuredSignal completion type",
        );
      }
      break;

    case "composite":
      if (!config.operator) {
        errors.push(
          "behavior.completionConfig.operator is required for composite completion type",
        );
      }
      if (
        !config.conditions ||
        !Array.isArray(config.conditions) ||
        config.conditions.length === 0
      ) {
        errors.push(
          "behavior.completionConfig.conditions is required for composite completion type",
        );
      }
      break;

    // stepMachine, externalState - use runtime parameters, no strict validation here
    case "stepMachine":
    case "externalState":
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
  if (!definition.behavior?.completionType) {
    result.errors.push("behavior.completionType is required");
    result.valid = false;
  }

  if (!definition.behavior?.systemPromptPath) {
    result.errors.push("behavior.systemPromptPath is required");
    result.valid = false;
  }

  if (!definition.behavior?.allowedTools) {
    result.errors.push("behavior.allowedTools is required");
    result.valid = false;
  }

  if (!definition.behavior?.permissionMode) {
    result.errors.push("behavior.permissionMode is required");
    result.valid = false;
  }

  if (!definition.prompts?.registry) {
    result.errors.push("prompts.registry is required");
    result.valid = false;
  }

  if (!definition.prompts?.fallbackDir) {
    result.errors.push("prompts.fallbackDir is required");
    result.valid = false;
  }

  if (!definition.logging?.directory) {
    result.errors.push("logging.directory is required");
    result.valid = false;
  }

  if (!definition.logging?.format) {
    result.errors.push("logging.format is required");
    result.valid = false;
  }

  return result;
}
