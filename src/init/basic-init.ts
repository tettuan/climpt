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
 * 基本構成初期化を実行
 * ※ default-app.yml は作成しない（meta のみ初期化）
 */
export async function initBasic(
  projectRoot: string,
  workingDir: string,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const fullWorkingDir = resolve(projectRoot, workingDir);

  // 作業ディレクトリ作成（config/, prompts/, schema/ のみ）
  const directories = [
    "config",
    "prompts",
    "schema",
  ];

  for (const dir of directories) {
    const fullPath = resolve(fullWorkingDir, dir);
    if (!(await exists(fullPath))) {
      await ensureDir(fullPath);
      result.created.push(fullPath);
      console.log(`  Created: ${fullPath}`);
    }
  }

  return result;
}
