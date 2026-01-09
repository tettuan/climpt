/**
 * @fileoverview Basic initialization module for climpt
 * @module init/basic-init
 */

import { resolve } from "@std/path";

/**
 * Check if a path exists
 */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/**
 * Ensure directory exists, creating it if necessary
 */
async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

/**
 * Execute basic configuration initialization
 * Note: default-app.yml is not created (only meta initialization)
 */
export async function initBasic(
  projectRoot: string,
  workingDir: string,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
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
