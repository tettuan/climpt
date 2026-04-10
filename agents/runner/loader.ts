/**
 * Agent definition loader and validator
 *
 * @deprecated Use agents/config/mod.ts instead.
 * This file is kept for backward compatibility.
 *
 * Migration guide:
 * - loadAgentDefinition() -> use ConfigurationService.load() or loadConfiguration()
 * - validateAgentDefinition() -> use validate() or validateComplete() from agents/config/validator.ts
 * - getAgentDir() -> use getAgentDir() from agents/config/loader.ts
 */

// deno-lint-ignore-file no-console
import { join } from "@std/path";
import { PATHS } from "../shared/paths.ts";
import type {
  AgentDefinition,
  ResolvedAgentDefinition,
  ValidationResult,
} from "../src_common/types.ts";
import { ALL_VERDICT_TYPES } from "../src_common/types.ts";
import { applyDefaults } from "../src_common/config.ts";
import { ConfigService } from "../shared/config-service.ts";
import {
  acLoadInvalid,
  acLoadNotFound,
  acLoadParseFailed,
} from "../shared/errors/config-errors.ts";

/** Shared ConfigService instance */
const configService = new ConfigService();

/**
 * Load agent definition from .agent/{name}/agent.json
 *
 * @deprecated Use loadConfiguration() from agents/config/mod.ts instead.
 */
export async function loadAgentDefinition(
  agentName: string,
  cwd: string = Deno.cwd(),
): Promise<ResolvedAgentDefinition> {
  const agentDir = configService.getAgentDir(agentName, cwd);
  const definitionPath = join(agentDir, PATHS.AGENT_JSON);

  // Check if file exists
  try {
    await Deno.stat(definitionPath);
  } catch {
    throw acLoadNotFound(definitionPath);
  }

  // Load and parse via ConfigService
  let raw: unknown;
  try {
    raw = await configService.loadAgentDefinitionRaw(agentDir);
  } catch (error) {
    throw acLoadParseFailed(
      definitionPath,
      error instanceof Error ? error.message : String(error),
    );
  }

  // Apply defaults
  const definition = applyDefaults(raw as AgentDefinition);

  // Validate
  const validation = validateAgentDefinition(definition);
  if (!validation.valid) {
    throw acLoadInvalid(validation.errors.join("\n"));
  }

  // Log warnings
  for (const warning of validation.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  return definition;
}

/**
 * Validate agent definition structure and values
 */
export function validateAgentDefinition(
  def: AgentDefinition,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required root fields
  if (!def.version) {
    errors.push(
      "[CONFIGURATION] version is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
  }
  if (!def.name) {
    errors.push(
      "[CONFIGURATION] name is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
  }
  if (!def.displayName) {
    errors.push(
      "[CONFIGURATION] displayName is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
  }
  if (!def.description) {
    errors.push(
      "[CONFIGURATION] description is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
  }
  if (!def.runner) {
    errors.push(
      "[CONFIGURATION] runner is required. " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
  }

  // Name format validation
  if (def.name && !/^[a-z][a-z0-9-]*$/.test(def.name)) {
    errors.push(
      "[CONFIGURATION] name must be lowercase kebab-case (e.g., 'my-agent'). " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
  }

  // Version format validation
  if (def.version && !/^\d+\.\d+\.\d+$/.test(def.version)) {
    errors.push(
      "[CONFIGURATION] version must be semver format (e.g., '1.0.0'). " +
        "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
  }

  // Runner validation
  if (def.runner) {
    // Flow validation
    if (!def.runner.flow?.systemPromptPath) {
      errors.push(
        "[CONFIGURATION] runner.flow.systemPromptPath is required. " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
    }

    // Verdict validation
    if (!def.runner.verdict?.type) {
      errors.push(
        "[CONFIGURATION] runner.verdict.type is required. " +
          "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
      );
    }

    // Boundaries validation
    if (!def.runner.boundaries?.allowedTools) {
      errors.push(
        "[CONFIGURATION] runner.boundaries.allowedTools is required. " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
    }
    if (!def.runner.boundaries?.permissionMode) {
      errors.push(
        "[CONFIGURATION] runner.boundaries.permissionMode is required. " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
    }

    // Validate verdict type
    if (
      def.runner.verdict?.type &&
      !ALL_VERDICT_TYPES.includes(def.runner.verdict.type)
    ) {
      errors.push(
        `[CONFIGURATION] runner.verdict.type must be one of: ${
          ALL_VERDICT_TYPES.join(", ")
        }. ` +
          `\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict`,
      );
    }

    // Validate permission mode
    const validPermissionModes = [
      "default",
      "plan",
      "acceptEdits",
      "bypassPermissions",
    ];
    if (
      def.runner.boundaries?.permissionMode &&
      !validPermissionModes.includes(def.runner.boundaries.permissionMode)
    ) {
      errors.push(
        `[CONFIGURATION] runner.boundaries.permissionMode must be one of: ${
          validPermissionModes.join(", ")
        }. ` +
          `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
      );
    }

    // Verdict config validation based on type
    validateVerdictConfig(def, errors);

    // Prompts validation
    if (!def.runner.flow?.prompts?.registry) {
      errors.push(
        "[CONFIGURATION] runner.flow.prompts.registry is required. " +
          "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
    }
    // Logging validation (logging is optional; defaults fill it in)
    if (def.runner.logging) {
      if (!def.runner.logging.directory) {
        errors.push(
          "[CONFIGURATION] runner.logging.directory is required when logging is specified. " +
            "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
        );
      }
      if (!def.runner.logging.format) {
        errors.push(
          "[CONFIGURATION] runner.logging.format is required when logging is specified. " +
            "\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
        );
      }
      const validFormats = ["jsonl", "text"];
      if (
        def.runner.logging.format &&
        !validFormats.includes(def.runner.logging.format)
      ) {
        errors.push(
          `[CONFIGURATION] runner.logging.format must be one of: ${
            validFormats.join(", ")
          }. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      }
    }
  }

  // Parameter validation
  if (def.parameters) {
    for (const [name, param] of Object.entries(def.parameters)) {
      if (!param.cli) {
        errors.push(
          `[CONFIGURATION] Parameter '${name}' missing cli flag. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      } else if (!param.cli.startsWith("--")) {
        errors.push(
          `[CONFIGURATION] Parameter '${name}' cli flag must start with '--'. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      }
      if (!param.type) {
        errors.push(
          `[CONFIGURATION] Parameter '${name}' missing type. ` +
            `\u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
        );
      }
      if (!param.description) {
        warnings.push(`Parameter '${name}' missing description`);
      }
      if (param.required && param.default !== undefined) {
        warnings.push(
          `Parameter '${name}' is required but has default value`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateVerdictConfig(
  def: AgentDefinition,
  errors: string[],
): void {
  const verdictType = def.runner.verdict?.type;
  const verdictConfig = def.runner.verdict?.config;

  switch (verdictType) {
    case "count:iteration":
      if (!verdictConfig?.maxIterations) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.maxIterations is required for count:iteration verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      } else if (
        typeof verdictConfig.maxIterations !== "number" ||
        verdictConfig.maxIterations < 1
      ) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.maxIterations must be a positive number. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "detect:keyword":
      if (!verdictConfig?.verdictKeyword) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.verdictKeyword is required for detect:keyword verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "meta:custom":
      if (!verdictConfig?.handlerPath) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.handlerPath is required for meta:custom verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "count:check":
      if (!verdictConfig?.maxChecks) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.maxChecks is required for count:check verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      } else if (
        typeof verdictConfig.maxChecks !== "number" ||
        verdictConfig.maxChecks < 1
      ) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.maxChecks must be a positive number. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "detect:structured":
      if (!verdictConfig?.signalType) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.signalType is required for detect:structured verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "meta:composite":
      if (!verdictConfig?.operator) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.operator is required for meta:composite verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      if (
        !verdictConfig?.conditions ||
        !Array.isArray(verdictConfig.conditions) ||
        verdictConfig.conditions.length === 0
      ) {
        errors.push(
          "[CONFIGURATION] runner.verdict.config.conditions is required for meta:composite verdict type. " +
            "\u2192 See: docs/guides/en/11-runner-reference.md#113-runnerverdict",
        );
      }
      break;

    case "detect:graph":
      // registryPath is optional, uses default from runner.flow.prompts.registry if not specified
      break;

    case "poll:state":
      // uses runtime parameters
      break;
  }
}

/**
 * Get the agent directory path
 */
export function getAgentDir(
  agentName: string,
  cwd: string = Deno.cwd(),
): string {
  return join(cwd, PATHS.AGENT_DIR_PREFIX, agentName);
}

/**
 * Check if an agent exists
 */
export async function agentExists(
  agentName: string,
  cwd: string = Deno.cwd(),
): Promise<boolean> {
  const agentDir = getAgentDir(agentName, cwd);
  const definitionPath = join(agentDir, "agent.json");

  try {
    await Deno.stat(definitionPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all available agents
 */
export async function listAgents(cwd: string = Deno.cwd()): Promise<string[]> {
  const agentsDir = join(cwd, PATHS.AGENT_DIR_PREFIX);
  const agents: string[] = [];

  try {
    for await (const entry of Deno.readDir(agentsDir)) {
      if (entry.isDirectory) {
        const definitionPath = join(agentsDir, entry.name, PATHS.AGENT_JSON);
        try {
          await Deno.stat(definitionPath);
          agents.push(entry.name);
        } catch {
          // Not a valid agent directory
        }
      }
    }
  } catch {
    // .agent directory doesn't exist
  }

  return agents.sort();
}
