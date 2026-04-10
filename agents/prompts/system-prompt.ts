/**
 * Standalone system prompt resolver.
 * Extracted from PromptResolverAdapter for Phase B migration.
 */

import { join } from "@std/path";
import {
  prSystemPromptLoadFailed,
  prSystemPromptNotFound,
} from "../shared/errors/config-errors.ts";

export interface SystemPromptOptions {
  agentDir: string;
  systemPromptPath?: string;
  variables: Record<string, string>;
}

export interface SystemPromptResult {
  content: string;
  source: "file";
  path?: string;
}

/**
 * Substitute {uv-xxx} placeholders in content.
 *
 * Lookup order per placeholder `{uv-<name>}`:
 *   1. variables["uv-<name>"]
 *   2. variables["<name>"]
 *   3. Keep original placeholder (graceful miss)
 */
function substituteVariables(
  content: string,
  variables: Record<string, string>,
): string {
  return content.replace(
    /\{uv-([a-zA-Z0-9_-]+)\}/g,
    (match, varName) => {
      const value = variables[`uv-${varName}`] ?? variables[varName];
      return value ?? match;
    },
  );
}

/**
 * Resolve the system prompt for an agent.
 *
 * Reads the file at agentDir / systemPromptPath (default "prompts/system.md")
 * and substitutes {uv-xxx} variables.
 *
 * @throws {ConfigError} PR-SYSTEM-002 if the file does not exist.
 * @throws {ConfigError} PR-SYSTEM-001 if the file exists but cannot be read.
 */
export async function resolveSystemPrompt(
  options: SystemPromptOptions,
): Promise<SystemPromptResult> {
  const { agentDir, variables } = options;
  const relPath = options.systemPromptPath ?? "prompts/system.md";
  const fullPath = join(agentDir, relPath);

  try {
    const raw = await Deno.readTextFile(fullPath);
    const content = substituteVariables(raw, variables);
    return { content, source: "file", path: relPath };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw prSystemPromptNotFound(fullPath);
    }
    // Permission error, decode error, etc.
    throw prSystemPromptLoadFailed(fullPath, String(error));
  }
}
