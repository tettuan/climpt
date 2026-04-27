/**
 * C3L Prompt File Path Builder
 *
 * Shared utility for constructing C3L prompt file paths from step metadata.
 * Used by path-validator.ts, template-uv-validator.ts, prompt-validator.ts,
 * and frontmatter-registry-validator.ts.
 *
 * Path resolution delegates to @tettuan/breakdownconfig, which merges
 * app.yml and user.yml to produce the resolved prompt root:
 *   getPromptDir() = resolve(resolve(baseDir, working_dir), app_prompt.base_dir)
 *
 * @module
 */

import { join, relative } from "@std/path";
import { BreakdownConfig } from "@tettuan/breakdownconfig";
import type { C3LAddress } from "../common/step-registry/types.ts";

// ---------------------------------------------------------------------------
// Prompt root resolution via BreakdownConfig
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute prompt root directory from breakdown config
 * (app.yml + user.yml merged).
 *
 * Uses BreakdownConfig to read {projectRoot}/.agent/climpt/config/{agentId}-{c1}-app.yml
 * and the corresponding user.yml, merging them per breakdown's resolution rules.
 *
 * @param projectRoot - Absolute path to the project root
 * @param agentId     - Agent identifier from steps_registry.json
 * @param c1          - C3L c1 component from steps_registry.json
 * @returns Absolute prompt root path, or null if config is missing/invalid
 */
export async function resolvePromptRoot(
  projectRoot: string,
  agentId: string,
  c1: string,
): Promise<string | null> {
  const profilePrefix = `${agentId}-${c1}`;
  // BreakdownConfig rejects absolute paths (ABSOLUTE_PATH_NOT_ALLOWED) and
  // resolves from Deno.cwd(). Convert projectRoot to a cwd-relative path.
  const relRoot = relative(Deno.cwd(), projectRoot) || ".";
  const createResult = BreakdownConfig.create(profilePrefix, relRoot);
  if (!createResult.success) return null;

  const config = createResult.data;
  const loadResult = await config.loadConfigSafe();
  if (!loadResult.success) return null;

  const promptDirResult = await config.getPromptDirSafe();
  if (!promptDirResult.success) return null;

  return promptDirResult.data;
}

// ---------------------------------------------------------------------------
// Path building
// ---------------------------------------------------------------------------

/**
 * Build the C3L prompt file path from a {@link C3LAddress}.
 *
 * Format: {promptRoot}/{c2}/{c3}/f_{edition}.md
 * or with adaptation: {promptRoot}/{c2}/{c3}/f_{edition}_{adaptation}.md
 *
 * promptRoot is the resolved path from BreakdownConfig:
 *   resolve(resolve(projectRoot, working_dir), app_prompt.base_dir)
 *
 * c1 does not appear in the resulting path — it is already absorbed into
 * the config's base_dir (e.g., base_dir: "prompts/steps" contains c1="steps").
 *
 * Validators that read raw disk JSON (without the typed Step ADT) can
 * synthesize the address inline:
 * `buildPromptFilePath(promptRoot, { c1, c2, c3, edition, adaptation })`.
 */
export function buildPromptFilePath(
  promptRoot: string,
  address: C3LAddress,
): string {
  const filename = address.adaptation
    ? `f_${address.edition}_${address.adaptation}.md`
    : `f_${address.edition}.md`;
  return join(promptRoot, address.c2, address.c3, filename);
}
