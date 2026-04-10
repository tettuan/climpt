/**
 * C3L Prompt File Path Builder
 *
 * Shared utility for constructing C3L prompt file paths from step metadata.
 * Used by path-validator.ts and template-uv-validator.ts.
 *
 * @module
 */

import { join } from "@std/path";

/**
 * Build the C3L prompt file path for a step.
 *
 * Format: {agentDir}/prompts/{c1}/{c2}/{c3}/f_{edition}.md
 * or with adaptation: {agentDir}/prompts/{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md
 */
export function buildPromptFilePath(
  agentDir: string,
  c1: string,
  c2: string,
  c3: string,
  edition: string,
  adaptation?: string,
): string {
  const filename = adaptation
    ? `f_${edition}_${adaptation}.md`
    : `f_${edition}.md`;
  return join(agentDir, "prompts", c1, c2, c3, filename);
}
