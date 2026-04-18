/**
 * Schema Loader — convention-based loader that registers every JSON Schema
 * referenced from a workflow declaration into a {@link SchemaRegistry}.
 *
 * The loader is intentionally agent-agnostic: it neither inspects
 * `handoff.id` nor the payload shapes; it only follows the `schemaRef` /
 * `payloadSchema.$ref` strings as opaque filesystem paths.
 *
 * Convention:
 *   - `handoff.emit.schemaRef`  → `<repoRoot>/agents/common/schemas/<ref>.json`
 *   - `payloadSchema.$ref`      → resolved relative to `repoRoot`
 */

import { join } from "@std/path";

import type { SchemaRegistry } from "./schema-registry.ts";
import type { WorkflowConfig } from "./workflow-types.ts";

/**
 * Load and register every schema referenced by `workflow.handoffs[]` from
 * the common schema directory. Already-registered refs are skipped so the
 * loader is idempotent across repeated invocations.
 *
 * Throws {@link Error} when a referenced schema file cannot be read. The
 * message identifies the missing ref and resolved filesystem path to aid
 * diagnosis.
 */
export async function registerWorkflowSchemas(
  registry: SchemaRegistry,
  workflow: WorkflowConfig,
  repoRoot: string,
): Promise<void> {
  const refs = new Set<string>();
  for (const handoff of workflow.handoffs ?? []) {
    refs.add(handoff.emit.schemaRef);
  }

  for (const ref of refs) {
    if (registry.get(ref) !== undefined) continue;
    const schemaPath = join(
      repoRoot,
      "agents",
      "common",
      "schemas",
      `${ref}.json`,
    );
    // deno-lint-ignore no-await-in-loop
    const schema = await readJsonSchema(schemaPath, ref);
    registry.register(ref, schema);
  }
}

/**
 * Register the workflow-level payload schema referenced by
 * `workflow.payloadSchema.$ref`, resolved relative to `repoRoot`.
 *
 * Registration key is the schema's `$id` when present; otherwise the raw
 * `$ref` string is used. No-op when `payloadSchema` is absent or the key
 * is already registered.
 */
export async function registerPayloadSchema(
  registry: SchemaRegistry,
  workflow: WorkflowConfig,
  repoRoot: string,
): Promise<void> {
  const ref = workflow.payloadSchema?.$ref;
  if (ref === undefined) return;
  const schemaPath = join(repoRoot, ref);
  const schema = await readJsonSchema(schemaPath, ref);
  const id = typeof schema["$id"] === "string" ? schema["$id"] : ref;
  if (registry.get(id) !== undefined) return;
  registry.register(id, schema);
}

async function readJsonSchema(
  path: string,
  ref: string,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Schema '${ref}' not found at ${path}: ${cause}`,
      { cause: error },
    );
  }
  return JSON.parse(text) as Record<string, unknown>;
}
