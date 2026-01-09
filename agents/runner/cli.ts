/**
 * CLI argument parser
 */

import { parseArgs } from "@std/cli/parse-args";
import type { ParameterDefinition } from "../src_common/types.ts";
import { loadAgentDefinition } from "./loader.ts";

export interface ParsedCliArgs {
  agentName: string;
  args: Record<string, unknown>;
  init?: boolean;
  help?: boolean;
  list?: boolean;
  cwd?: string;
}

/**
 * Parse CLI arguments for agent execution
 */
export async function parseCliArgs(cliArgs: string[]): Promise<ParsedCliArgs> {
  // First pass: get global flags
  const initial = parseArgs(cliArgs, {
    string: ["agent", "cwd"],
    boolean: ["init", "help", "list"],
    alias: { h: "help", a: "agent" },
  });

  if (initial.help) {
    return { agentName: "", args: {}, help: true };
  }

  if (initial.list) {
    return { agentName: "", args: {}, list: true };
  }

  if (initial.init) {
    return {
      agentName: (initial.agent as string) ?? "",
      args: {},
      init: true,
      cwd: initial.cwd as string | undefined,
    };
  }

  const agentName = initial.agent as string;
  if (!agentName) {
    throw new Error(
      "--agent <name> is required. Use --list to see available agents.",
    );
  }

  const cwd = (initial.cwd as string) ?? Deno.cwd();

  // Load definition to get parameter specs
  const definition = await loadAgentDefinition(agentName, cwd);

  // Build parser config from parameters
  const parseConfig = buildParseConfig(definition.parameters);
  const parsed = parseArgs(cliArgs, parseConfig);

  // Extract and validate parameter values
  const args = extractParameterValues(parsed, definition.parameters);
  validateRequiredParameters(args, definition.parameters);

  return { agentName, args, cwd };
}

function buildParseConfig(
  parameters: Record<string, ParameterDefinition>,
): Parameters<typeof parseArgs>[1] {
  const stringFlags: string[] = ["agent", "cwd"];
  const booleanFlags: string[] = ["init", "help", "list"];
  const defaults: Record<string, unknown> = {};
  const aliases: Record<string, string> = { h: "help", a: "agent" };

  for (const [_name, param] of Object.entries(parameters)) {
    const flag = param.cli.replace(/^--/, "");

    switch (param.type) {
      case "string":
        stringFlags.push(flag);
        break;
      case "boolean":
        booleanFlags.push(flag);
        break;
      case "number":
        // Parse as string, convert later
        stringFlags.push(flag);
        break;
      case "array":
        // Handle as collect
        stringFlags.push(flag);
        break;
    }

    if (param.default !== undefined) {
      defaults[flag] = param.default;
    }
  }

  return {
    string: stringFlags,
    boolean: booleanFlags,
    default: defaults,
    alias: aliases,
  };
}

function extractParameterValues(
  parsed: Record<string, unknown>,
  parameters: Record<string, ParameterDefinition>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [name, param] of Object.entries(parameters)) {
    const flag = param.cli.replace(/^--/, "");
    let value = parsed[flag];

    if (value === undefined) {
      value = param.default;
    }

    // Type conversion
    if (value !== undefined) {
      switch (param.type) {
        case "number":
          value = Number(value);
          if (isNaN(value as number)) {
            throw new Error(
              `Parameter '${name}' (${param.cli}) must be a number`,
            );
          }
          break;
        case "boolean":
          value = Boolean(value);
          break;
        case "array":
          if (typeof value === "string") {
            value = value.split(",").map((s) => s.trim());
          } else if (!Array.isArray(value)) {
            value = [value];
          }
          break;
      }
    }

    result[name] = value;
  }

  return result;
}

function validateRequiredParameters(
  args: Record<string, unknown>,
  parameters: Record<string, ParameterDefinition>,
): void {
  for (const [name, param] of Object.entries(parameters)) {
    // Required validation
    if (param.required && args[name] === undefined) {
      throw new Error(`Required parameter '${name}' (${param.cli}) is missing`);
    }

    // Skip validation if value is undefined
    if (args[name] === undefined) continue;

    const value = args[name];

    // Validation rules
    if (param.validation) {
      if (
        param.validation.min !== undefined &&
        typeof value === "number" &&
        value < param.validation.min
      ) {
        throw new Error(
          `Parameter '${name}' must be >= ${param.validation.min}`,
        );
      }

      if (
        param.validation.max !== undefined &&
        typeof value === "number" &&
        value > param.validation.max
      ) {
        throw new Error(
          `Parameter '${name}' must be <= ${param.validation.max}`,
        );
      }

      if (param.validation.pattern) {
        const regex = new RegExp(param.validation.pattern);
        if (!regex.test(String(value))) {
          throw new Error(
            `Parameter '${name}' must match pattern: ${param.validation.pattern}`,
          );
        }
      }

      if (
        param.validation.enum &&
        !param.validation.enum.includes(String(value))
      ) {
        throw new Error(
          `Parameter '${name}' must be one of: ${
            param.validation.enum.join(", ")
          }`,
        );
      }
    }
  }
}

/**
 * Generate help text for an agent
 */
export function generateAgentHelp(
  agentName: string,
  parameters: Record<string, ParameterDefinition>,
): string {
  const lines: string[] = [];

  lines.push(`Usage: deno task agent --agent ${agentName} [options]`);
  lines.push("");
  lines.push("Options:");

  const paramEntries = Object.entries(parameters);
  if (paramEntries.length === 0) {
    lines.push("  (no parameters defined)");
  } else {
    const maxFlagLength = Math.max(
      ...paramEntries.map(([_, p]) => p.cli.length),
    );

    for (const [_name, param] of paramEntries) {
      const required = param.required ? " (required)" : "";
      const defaultVal = param.default !== undefined
        ? ` [default: ${JSON.stringify(param.default)}]`
        : "";
      const padding = " ".repeat(maxFlagLength - param.cli.length + 2);
      lines.push(
        `  ${param.cli}${padding}${param.description}${required}${defaultVal}`,
      );
    }
  }

  return lines.join("\n");
}
