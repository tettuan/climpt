/**
 * @fileoverview Detector module for detecting existing climpt configuration
 * @module init/detector
 */

import { resolve } from "@std/path";
import type { DetectionResult } from "./types.ts";

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
 * Detect existing climpt configuration
 */
export async function detectExisting(
  projectRoot: string,
  workingDir: string,
): Promise<DetectionResult> {
  const fullWorkingDir = resolve(projectRoot, workingDir);
  const configDir = `${fullWorkingDir}/config`;

  return {
    hasWorkingDir: await exists(fullWorkingDir),
    hasMetaAppYml: await exists(`${configDir}/meta-app.yml`),
    hasMetaUserYml: await exists(`${configDir}/meta-user.yml`),
    hasRegistryConfig: await exists(`${configDir}/registry_config.json`),
    hasRegistry: await exists(`${fullWorkingDir}/registry.json`),
    hasSchemaDir: await exists(`${fullWorkingDir}/frontmatter-to-schema`),
    hasPromptsDir: await exists(`${fullWorkingDir}/prompts`),
    hasMetaPromptsDir: await exists(`${fullWorkingDir}/prompts/meta`),
  };
}

/**
 * Check if overwrite is needed
 */
export function hasExistingFiles(detection: DetectionResult): boolean {
  return detection.hasMetaAppYml ||
    detection.hasRegistryConfig ||
    detection.hasRegistry;
}
