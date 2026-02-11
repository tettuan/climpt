/**
 * @fileoverview Basic initialization module for climpt
 * @module init/basic-init
 */

import { ensureDir } from "@std/fs/ensure-dir";
import { exists } from "@std/fs/exists";
import { resolve } from "@std/path";
import { createInitResult } from "./types.ts";

/**
 * Execute basic configuration initialization
 * Note: default-app.yml is not created (only meta initialization)
 */
export async function initBasic(
  projectRoot: string,
  workingDir: string,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = createInitResult();
  const fullWorkingDir = resolve(projectRoot, workingDir);

  // Create working directories (config/, prompts/, schema/ only)
  const directories = [
    "config",
    "prompts",
    "schema",
  ];

  const createPromises = directories.map(async (dir) => {
    const fullPath = resolve(fullWorkingDir, dir);
    if (!(await exists(fullPath))) {
      await ensureDir(fullPath);
      result.created.push(fullPath);
      // deno-lint-ignore no-console
      console.log(`  Created: ${fullPath}`);
    }
  });
  await Promise.all(createPromises);

  return result;
}
