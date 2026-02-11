/**
 * @fileoverview Meta domain initialization module for climpt
 * @module init/meta-init
 */

import { ensureDir } from "@std/fs/ensure-dir";
import { exists } from "@std/fs/exists";
import { dirname, resolve } from "@std/path";
import { createInitResult } from "./types.ts";
import { BUILD_FRONTMATTER_PROMPT } from "./templates/build-frontmatter-prompt.ts";
import { CREATE_INSTRUCTION_PROMPT } from "./templates/create-instruction-prompt.ts";

/**
 * Configuration file content for Meta domain
 */
const META_APP_CONFIG = `# Build Configuration for meta domain
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/meta"
app_schema:
  base_dir: "schema/meta"
`;

const META_USER_CONFIG = `# Breakdown Configuration for meta domain
params:
  two:
    directiveType:
      pattern: "^(build|create)$"
    layerType:
      pattern: "^(frontmatter|instruction)$"
`;

/**
 * Meta domain prompts (embedded)
 */
const META_PROMPTS: Record<string, string> = {
  "build/frontmatter/f_default.md": BUILD_FRONTMATTER_PROMPT,
  "create/instruction/f_default.md": CREATE_INSTRUCTION_PROMPT,
};

/**
 * Execute Meta domain initialization
 */
export async function initMetaDomain(
  workingDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = createInitResult();
  const configDir = resolve(workingDir, "config");
  const promptsDir = resolve(workingDir, "prompts");

  // 1. Generate meta-app.yml
  const metaAppResult = await createMetaAppYml(configDir, force);
  result.created.push(...metaAppResult.created);
  result.skipped.push(...metaAppResult.skipped);

  // 2. Generate meta-user.yml
  const metaUserResult = await createMetaUserYml(configDir, force);
  result.created.push(...metaUserResult.created);
  result.skipped.push(...metaUserResult.skipped);

  // 3. Deploy meta prompts
  const promptsResult = await deployMetaPrompts(promptsDir, force);
  result.created.push(...promptsResult.created);
  result.skipped.push(...promptsResult.skipped);

  return result;
}

/**
 * Generate meta-app.yml
 */
async function createMetaAppYml(
  configDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = createInitResult();
  const path = resolve(configDir, "meta-app.yml");

  if ((await exists(path)) && !force) {
    result.skipped.push(path);
    // deno-lint-ignore no-console
    console.log(`  Skip: ${path} (already exists)`);
    return result;
  }

  await ensureDir(configDir);
  await Deno.writeTextFile(path, META_APP_CONFIG);
  result.created.push(path);
  // deno-lint-ignore no-console
  console.log(`  Created: ${path}`);

  return result;
}

/**
 * Generate meta-user.yml
 */
async function createMetaUserYml(
  configDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = createInitResult();
  const path = resolve(configDir, "meta-user.yml");

  if ((await exists(path)) && !force) {
    result.skipped.push(path);
    // deno-lint-ignore no-console
    console.log(`  Skip: ${path} (already exists)`);
    return result;
  }

  await Deno.writeTextFile(path, META_USER_CONFIG);
  result.created.push(path);
  // deno-lint-ignore no-console
  console.log(`  Created: ${path}`);

  return result;
}

/**
 * Deploy Meta domain prompts
 */
async function deployMetaPrompts(
  promptsDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = createInitResult();
  const metaDir = resolve(promptsDir, "meta");

  for (const [relativePath, content] of Object.entries(META_PROMPTS)) {
    const fullPath = resolve(metaDir, relativePath);
    const dir = dirname(fullPath);

    // deno-lint-ignore no-await-in-loop
    if ((await exists(fullPath)) && !force) {
      result.skipped.push(fullPath);
      // deno-lint-ignore no-console
      console.log(`  Skip: ${fullPath} (already exists)`);
      continue;
    }

    // deno-lint-ignore no-await-in-loop
    await ensureDir(dir);
    // deno-lint-ignore no-await-in-loop
    await Deno.writeTextFile(fullPath, content);
    result.created.push(fullPath);
    // deno-lint-ignore no-console
    console.log(`  Created: ${fullPath}`);
  }

  return result;
}
