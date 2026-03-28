/**
 * Standalone system prompt resolver.
 * Extracted from PromptResolverAdapter for Phase B migration.
 */

import { join } from "@std/path";
import { DefaultFallbackProvider } from "./fallback.ts";
import { prSystemPromptLoadFailed } from "../shared/errors/config-errors.ts";

export interface SystemPromptOptions {
  agentDir: string;
  systemPromptPath?: string;
  variables: Record<string, string>;
}

export interface SystemPromptResult {
  content: string;
  source: "file" | "fallback";
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
 * Resolution order:
 *   1. Read file at agentDir / systemPromptPath (default "prompts/system.md")
 *      and substitute {uv-xxx} variables.
 *   2. Fallback to DefaultFallbackProvider.getSystemPrompt().
 */
export async function resolveSystemPrompt(
  options: SystemPromptOptions,
): Promise<SystemPromptResult> {
  const { agentDir, variables } = options;
  const relPath = options.systemPromptPath ?? "prompts/system.md";
  const fullPath = join(agentDir, relPath);

  // 1. Try file-based resolution
  try {
    const raw = await Deno.readTextFile(fullPath);
    const content = substituteVariables(raw, variables);
    return { content, source: "file", path: relPath };
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      // Permission error, decode error, etc. — do not silently fall back
      throw prSystemPromptLoadFailed(fullPath, String(error));
    }
  }

  // 2. Fallback (file not found only)
  const fallback = new DefaultFallbackProvider();
  const content = fallback.getSystemPrompt(variables);
  return { content, source: "fallback" };
}
