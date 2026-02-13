/**
 * Step Registry Serializer
 *
 * Functions for serializing and saving step registries.
 */

import type { StepRegistry } from "./types.ts";

/**
 * Serialize a registry to JSON string
 *
 * @param registry - Registry to serialize
 * @param pretty - Use pretty formatting (default: true)
 * @returns JSON string
 */
export function serializeRegistry(
  registry: StepRegistry,
  pretty = true,
): string {
  return JSON.stringify(registry, null, pretty ? 2 : 0);
}

/**
 * Save a registry to a file
 *
 * @param registry - Registry to save
 * @param filePath - Destination file path
 */
export async function saveStepRegistry(
  registry: StepRegistry,
  filePath: string,
): Promise<void> {
  const content = serializeRegistry(registry);
  await Deno.writeTextFile(filePath, content + "\n");
}
