/**
 * Agent definition loader and validator
 */

import { join } from "@std/path";
import type { AgentDefinition, ValidationResult } from "../src_common/types.ts";
import { applyDefaults } from "../src_common/config.ts";

/**
 * Load agent definition from .agent/{name}/agent.json
 */
export async function loadAgentDefinition(
  agentName: string,
  cwd: string = Deno.cwd(),
): Promise<AgentDefinition> {
  const agentDir = join(cwd, ".agent", agentName);
  const definitionPath = join(agentDir, "agent.json");

  // Check if file exists
  try {
    await Deno.stat(definitionPath);
  } catch {
    throw new Error(`Agent definition not found: ${definitionPath}`);
  }

  // Load and parse
  const content = await Deno.readTextFile(definitionPath);
  let definition: AgentDefinition;

  try {
    definition = JSON.parse(content) as AgentDefinition;
  } catch (error) {
    throw new Error(
      `Failed to parse agent definition: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Apply defaults
  definition = applyDefaults(definition);

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
  if (!def.behavior) errors.push("behavior is required");
  if (!def.prompts) errors.push("prompts is required");
  if (!def.logging) errors.push("logging is required");

  // Name format validation
  if (def.name && !/^[a-z][a-z0-9-]*$/.test(def.name)) {
    errors.push("name must be lowercase kebab-case (e.g., 'my-agent')");
  }

  // Version format validation
  if (def.version && !/^\d+\.\d+\.\d+$/.test(def.version)) {
    errors.push("version must be semver format (e.g., '1.0.0')");
  }

  // Behavior validation
  if (def.behavior) {
    if (!def.behavior.systemPromptPath) {
      errors.push("behavior.systemPromptPath is required");
    }
    if (!def.behavior.completionType) {
      errors.push("behavior.completionType is required");
    }
    if (!def.behavior.allowedTools) {
      errors.push("behavior.allowedTools is required");
    }
    if (!def.behavior.permissionMode) {
      errors.push("behavior.permissionMode is required");
    }

    // Validate completion type
    const validCompletionTypes = [
      "issue",
      "project",
      "iterate",
      "manual",
      "custom",
    ];
    if (
      def.behavior.completionType &&
      !validCompletionTypes.includes(def.behavior.completionType)
    ) {
      errors.push(
        `behavior.completionType must be one of: ${
          validCompletionTypes.join(", ")
        }`,
      );
    }

    // Validate permission mode
    const validPermissionModes = ["plan", "acceptEdits", "bypassPermissions"];
    if (
      def.behavior.permissionMode &&
      !validPermissionModes.includes(def.behavior.permissionMode)
    ) {
      errors.push(
        `behavior.permissionMode must be one of: ${
          validPermissionModes.join(", ")
        }`,
      );
    }

    // Completion config validation based on type
    validateCompletionConfig(def, errors);
  }

  // Prompts validation
  if (def.prompts) {
    if (!def.prompts.registry) {
      errors.push("prompts.registry is required");
    }
    if (!def.prompts.fallbackDir) {
      errors.push("prompts.fallbackDir is required");
    }
  }

  // Logging validation
  if (def.logging) {
    if (!def.logging.directory) {
      errors.push("logging.directory is required");
    }
    if (!def.logging.format) {
      errors.push("logging.format is required");
    }
    const validFormats = ["jsonl", "text"];
    if (def.logging.format && !validFormats.includes(def.logging.format)) {
      errors.push(`logging.format must be one of: ${validFormats.join(", ")}`);
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
  const { completionType, completionConfig } = def.behavior;

  switch (completionType) {
    case "iterate":
      if (!completionConfig?.maxIterations) {
        errors.push(
          "behavior.completionConfig.maxIterations is required for iterate completion type",
        );
      } else if (
        typeof completionConfig.maxIterations !== "number" ||
        completionConfig.maxIterations < 1
      ) {
        errors.push(
          "behavior.completionConfig.maxIterations must be a positive number",
        );
      }
      break;

    case "manual":
      if (!completionConfig?.completionKeyword) {
        errors.push(
          "behavior.completionConfig.completionKeyword is required for manual completion type",
        );
      }
      break;

    case "custom":
      if (!completionConfig?.handlerPath) {
        errors.push(
          "behavior.completionConfig.handlerPath is required for custom completion type",
        );
      }
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
  return join(cwd, ".agent", agentName);
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
  const agentsDir = join(cwd, ".agent");
  const agents: string[] = [];

  try {
    for await (const entry of Deno.readDir(agentsDir)) {
      if (entry.isDirectory) {
        const definitionPath = join(agentsDir, entry.name, "agent.json");
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
