/**
 * Variable Substitutor - Prompt variable substitution
 *
 * Responsibility: Substitute {uv-xxx} variables with values
 * Side effects: None (Query)
 */

import type { Variables } from "../src_common/contracts.ts";

/**
 * Pattern for UV variables: {uv-variableName}
 */
const UV_PATTERN = /\{uv-([a-zA-Z0-9_-]+)\}/g;

/**
 * Substitute UV variables in content.
 *
 * @param content - Content with {uv-xxx} placeholders
 * @param variables - Map of variable names to values (without uv- prefix)
 * @returns Content with variables substituted
 */
export function substituteVariables(
  content: string,
  variables: Variables,
): string {
  return content.replace(UV_PATTERN, (match, varName) => {
    const value = variables[varName] ?? variables[`uv-${varName}`];
    if (value !== undefined) {
      return String(value);
    }
    // Leave unsubstituted if variable not found
    // deno-lint-ignore no-console
    console.warn(`[PromptResolver] Undefined variable: ${varName}`);
    return match;
  });
}

/**
 * Extract variable names from content.
 *
 * @param content - Content with {uv-xxx} placeholders
 * @returns Array of variable names (without uv- prefix)
 */
export function extractVariableNames(content: string): string[] {
  const names: string[] = [];
  const pattern = /\{uv-([a-zA-Z0-9_-]+)\}/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }

  return names;
}

/**
 * Check if all required variables are provided.
 *
 * @param content - Content with {uv-xxx} placeholders
 * @param variables - Provided variables
 * @returns Object with missing and provided variable names
 */
export function checkVariables(
  content: string,
  variables: Variables,
): { missing: string[]; provided: string[] } {
  const required = extractVariableNames(content);
  const missing: string[] = [];
  const provided: string[] = [];

  for (const name of required) {
    if (
      variables[name] !== undefined || variables[`uv-${name}`] !== undefined
    ) {
      provided.push(name);
    } else {
      missing.push(name);
    }
  }

  return { missing, provided };
}
