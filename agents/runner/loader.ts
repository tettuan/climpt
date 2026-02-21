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
import { ALL_COMPLETION_TYPES } from "../src_common/types.ts";
import { applyDefaults } from "../src_common/config.ts";
import { ConfigService } from "../shared/config-service.ts";

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
    throw new Error(`Agent definition not found: ${definitionPath}`);
  }

  // Load and parse via ConfigService
  let raw: unknown;
  try {
    raw = await configService.loadAgentDefinitionRaw(agentDir);
  } catch (error) {
    throw new Error(
      `Failed to parse agent definition: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Apply defaults
  const definition = applyDefaults(raw as AgentDefinition);

  // Validate
  const validation = validateAgentDefinition(definition);
  if (!validation.valid) {
    throw new Error(
      `Invalid agent definition:\n${validation.errors.join("\n")}`,
    );
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
  if (!def.version) errors.push("version is required");
  if (!def.name) errors.push("name is required");
  if (!def.displayName) errors.push("displayName is required");
  if (!def.description) errors.push("description is required");
  if (!def.runner) errors.push("runner is required");

  // Name format validation
  if (def.name && !/^[a-z][a-z0-9-]*$/.test(def.name)) {
    errors.push("name must be lowercase kebab-case (e.g., 'my-agent')");
  }

  // Version format validation
  if (def.version && !/^\d+\.\d+\.\d+$/.test(def.version)) {
    errors.push("version must be semver format (e.g., '1.0.0')");
  }

  // Runner validation
  if (def.runner) {
    // Flow validation
    if (!def.runner.flow?.systemPromptPath) {
      errors.push("runner.flow.systemPromptPath is required");
    }

    // Completion validation
    if (!def.runner.completion?.type) {
      errors.push("runner.completion.type is required");
    }

    // Boundaries validation
    if (!def.runner.boundaries?.allowedTools) {
      errors.push("runner.boundaries.allowedTools is required");
    }
    if (!def.runner.boundaries?.permissionMode) {
      errors.push("runner.boundaries.permissionMode is required");
    }

    // Validate completion type
    if (
      def.runner.completion?.type &&
      !ALL_COMPLETION_TYPES.includes(def.runner.completion.type)
    ) {
      errors.push(
        `runner.completion.type must be one of: ${
          ALL_COMPLETION_TYPES.join(", ")
        }`,
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
        `runner.boundaries.permissionMode must be one of: ${
          validPermissionModes.join(", ")
        }`,
      );
    }

    // Completion config validation based on type
    validateCompletionConfig(def, errors);

    // Prompts validation
    if (!def.runner.flow?.prompts?.registry) {
      errors.push("runner.flow.prompts.registry is required");
    }
    if (!def.runner.flow?.prompts?.fallbackDir) {
      errors.push("runner.flow.prompts.fallbackDir is required");
    }

    // Logging validation (logging is optional; defaults fill it in)
    if (def.runner.logging) {
      if (!def.runner.logging.directory) {
        errors.push(
          "runner.logging.directory is required when logging is specified",
        );
      }
      if (!def.runner.logging.format) {
        errors.push(
          "runner.logging.format is required when logging is specified",
        );
      }
      const validFormats = ["jsonl", "text"];
      if (
        def.runner.logging.format &&
        !validFormats.includes(def.runner.logging.format)
      ) {
        errors.push(
          `runner.logging.format must be one of: ${validFormats.join(", ")}`,
        );
      }
    }
  }

  // Parameter validation
  if (def.parameters) {
    for (const [name, param] of Object.entries(def.parameters)) {
      if (!param.cli) {
        errors.push(`Parameter '${name}' missing cli flag`);
      } else if (!param.cli.startsWith("--")) {
        errors.push(`Parameter '${name}' cli flag must start with '--'`);
      }
      if (!param.type) {
        errors.push(`Parameter '${name}' missing type`);
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

function validateCompletionConfig(
  def: AgentDefinition,
  errors: string[],
): void {
  const completionType = def.runner.completion?.type;
  const completionConfig = def.runner.completion?.config;

  switch (completionType) {
    case "iterationBudget":
      if (!completionConfig?.maxIterations) {
        errors.push(
          "runner.completion.config.maxIterations is required for iterationBudget completion type",
        );
      } else if (
        typeof completionConfig.maxIterations !== "number" ||
        completionConfig.maxIterations < 1
      ) {
        errors.push(
          "runner.completion.config.maxIterations must be a positive number",
        );
      }
      break;

    case "keywordSignal":
      if (!completionConfig?.completionKeyword) {
        errors.push(
          "runner.completion.config.completionKeyword is required for keywordSignal completion type",
        );
      }
      break;

    case "custom":
      if (!completionConfig?.handlerPath) {
        errors.push(
          "runner.completion.config.handlerPath is required for custom completion type",
        );
      }
      break;

    case "checkBudget":
      if (!completionConfig?.maxChecks) {
        errors.push(
          "runner.completion.config.maxChecks is required for checkBudget completion type",
        );
      } else if (
        typeof completionConfig.maxChecks !== "number" ||
        completionConfig.maxChecks < 1
      ) {
        errors.push(
          "runner.completion.config.maxChecks must be a positive number",
        );
      }
      break;

    case "structuredSignal":
      if (!completionConfig?.signalType) {
        errors.push(
          "runner.completion.config.signalType is required for structuredSignal completion type",
        );
      }
      break;

    case "composite":
      if (!completionConfig?.operator) {
        errors.push(
          "runner.completion.config.operator is required for composite completion type",
        );
      }
      if (
        !completionConfig?.conditions ||
        !Array.isArray(completionConfig.conditions) ||
        completionConfig.conditions.length === 0
      ) {
        errors.push(
          "runner.completion.config.conditions is required for composite completion type",
        );
      }
      break;

    case "stepMachine":
      // registryPath is optional, uses default from runner.flow.prompts.registry if not specified
      break;

    case "externalState":
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
