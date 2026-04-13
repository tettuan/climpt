/**
 * Tests for schema-loader.ts
 *
 * Contract: the loader maps every `handoff.emit.schemaRef` in a workflow
 * to a JSON file under `<repoRoot>/agents/common/schemas/<ref>.json` and
 * registers it exactly once.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import {
  registerPayloadSchema,
  registerWorkflowSchemas,
} from "./schema-loader.ts";
import { InMemorySchemaRegistry } from "./schema-registry.ts";
import type { HandoffDeclaration, WorkflowConfig } from "./workflow-types.ts";

function buildWorkflow(
  handoffs: ReadonlyArray<HandoffDeclaration>,
  payloadSchema?: { readonly $ref: string },
): WorkflowConfig {
  return {
    version: "1.0.0",
    phases: { "p": { type: "actionable" } },
    labelMapping: { "l": "p" },
    agents: {},
    rules: { maxCycles: 1, cycleDelayMs: 0 },
    handoffs,
    payloadSchema,
  };
}

function makeHandoff(schemaRef: string, id = "h1"): HandoffDeclaration {
  return {
    id,
    when: { fromAgent: "a", outcome: "ok" },
    emit: { type: "t", schemaRef, path: "out.json" },
    payloadFrom: {},
    persistPayloadTo: "none",
  };
}

async function makeTempRepo(): Promise<
  { root: string; cleanup: () => Promise<void> }
> {
  const root = await Deno.makeTempDir({ prefix: "schema-loader-test-" });
  await Deno.mkdir(join(root, "agents", "common", "schemas"), {
    recursive: true,
  });
  return {
    root,
    cleanup: () => Deno.remove(root, { recursive: true }),
  };
}

async function writeCommonSchema(
  root: string,
  ref: string,
  schema: Record<string, unknown>,
): Promise<void> {
  const path = join(root, "agents", "common", "schemas", `${ref}.json`);
  await Deno.writeTextFile(path, JSON.stringify(schema));
}

// =============================================================================
// (a) loads referenced schema from the common dir
// =============================================================================

Deno.test("registerWorkflowSchemas: loads referenced schema from common dir", async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const ref = "sample-schema@1.0.0";
    const schema = {
      $id: ref,
      type: "object",
      properties: { x: { type: "number" } },
    };
    await writeCommonSchema(root, ref, schema);

    const registry = new InMemorySchemaRegistry();
    const workflow = buildWorkflow([makeHandoff(ref)]);
    await registerWorkflowSchemas(registry, workflow, root);

    const outcome = registry.validate(ref, { x: 7 });
    assertEquals(
      outcome.valid,
      true,
      `registry should validate against loaded schema; errors: ${
        outcome.errors.join(", ")
      }`,
    );
  } finally {
    await cleanup();
  }
});

// =============================================================================
// (b) throws on missing file
// =============================================================================

Deno.test("registerWorkflowSchemas: throws when referenced file missing", async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const registry = new InMemorySchemaRegistry();
    const workflow = buildWorkflow([makeHandoff("absent-schema@9.9.9")]);

    await assertRejects(
      () => registerWorkflowSchemas(registry, workflow, root),
      Error,
      "absent-schema@9.9.9",
      "Missing schema file must raise an error identifying the ref. " +
        "Fix: check registerWorkflowSchemas error path",
    );
  } finally {
    await cleanup();
  }
});

// =============================================================================
// (c) idempotent on duplicate refs
// =============================================================================

Deno.test("registerWorkflowSchemas: idempotent across duplicate refs and repeat calls", async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const ref = "dup-schema@1.0.0";
    await writeCommonSchema(root, ref, { type: "object" });

    const registry = new InMemorySchemaRegistry();
    const workflow = buildWorkflow([
      makeHandoff(ref, "h-a"),
      makeHandoff(ref, "h-b"),
    ]);

    // First call: two handoffs share the same ref → register exactly once.
    await registerWorkflowSchemas(registry, workflow, root);
    // Second call: already-registered ref must be skipped (no throw).
    await registerWorkflowSchemas(registry, workflow, root);

    assertEquals(
      registry.get(ref) !== undefined,
      true,
      "ref should remain registered after idempotent repeat call",
    );
  } finally {
    await cleanup();
  }
});

// =============================================================================
// registerPayloadSchema
// =============================================================================

Deno.test("registerPayloadSchema: registers workflow payload schema under its $id", async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const schemaRel = ".agent/workflow-sample/schemas/payload.json";
    const schemaAbs = join(root, schemaRel);
    await Deno.mkdir(join(root, ".agent/workflow-sample/schemas"), {
      recursive: true,
    });
    const schema = {
      $id: "sample-payload@1.0.0",
      type: "object",
      properties: { k: { type: "string" } },
    };
    await Deno.writeTextFile(schemaAbs, JSON.stringify(schema));

    const registry = new InMemorySchemaRegistry();
    const workflow = buildWorkflow([], { $ref: schemaRel });

    await registerPayloadSchema(registry, workflow, root);

    assertEquals(
      registry.get("sample-payload@1.0.0") !== undefined,
      true,
      "payload schema must be registered under its $id",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("registerPayloadSchema: no-op when payloadSchema is absent", async () => {
  const { root, cleanup } = await makeTempRepo();
  try {
    const registry = new InMemorySchemaRegistry();
    const workflow = buildWorkflow([]);
    await registerPayloadSchema(registry, workflow, root);
    // No throw, no registration.
  } finally {
    await cleanup();
  }
});
