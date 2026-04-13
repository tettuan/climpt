/**
 * Conformance + real-schema integration tests for the PR Merger handoff
 * pipeline.
 *
 * Two concerns:
 *
 * (A) Conformance — `.agent/workflow-merge.json`'s `handoffs[].payloadFrom`
 *     must cover every `required[]` field declared in the referenced
 *     schema (`agents/common/schemas/pr-merger-verdict@1.0.0.json`).
 *     Neither file is the sole source of truth; drift on either side
 *     breaks production runtime without warning.
 *
 * (B) Real-schema integration — unlike `artifact-emitter_test.ts` which
 *     uses a stubbed `SchemaRegistry`, these tests exercise the real
 *     `InMemorySchemaRegistry` + `registerWorkflowSchemas` flow against
 *     the actual on-disk schema. This catches the case where the stub
 *     accepts everything but the real Ajv-compiled schema does not.
 *
 * If this test fails, the `Fix:` / `IF/THEN` guidance in each assertion
 * identifies which of the two peer configs to update.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

import {
  DefaultArtifactEmitter,
  HandoffSchemaValidationError,
  type WorkflowAgentInfo,
} from "./artifact-emitter.ts";
import { InMemorySchemaRegistry } from "./schema-registry.ts";
import { registerWorkflowSchemas } from "./schema-loader.ts";
import type { HandoffDeclaration, WorkflowConfig } from "./workflow-types.ts";

// =============================================================================
// Repo-root resolution
// =============================================================================
// This test file lives at `<repo>/agents/orchestrator/`. Resolve repo root
// relative to the file URL so the suite is location-independent.
const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW_MERGE_PATH = join(REPO_ROOT, ".agent", "workflow-merge.json");
const SCHEMA_PATH = join(
  REPO_ROOT,
  "agents",
  "common",
  "schemas",
  "pr-merger-verdict@1.0.0.json",
);

// =============================================================================
// Helpers
// =============================================================================

async function loadWorkflowMerge(): Promise<WorkflowConfig> {
  const text = await Deno.readTextFile(WORKFLOW_MERGE_PATH);
  return JSON.parse(text) as WorkflowConfig;
}

async function loadVerdictSchema(): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(SCHEMA_PATH);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Pull every handoff targeting the pr-merger-verdict schema from the config. */
function prMergerHandoffs(
  wf: WorkflowConfig,
): ReadonlyArray<HandoffDeclaration> {
  return (wf.handoffs ?? []).filter(
    (h) => h.emit.schemaRef === "pr-merger-verdict@1.0.0",
  );
}

// =============================================================================
// (A) Conformance tests — workflow-merge.json ⇔ pr-merger-verdict@1.0.0
// =============================================================================

Deno.test(
  "conformance: every schema.required field is bound in workflow-merge payloadFrom",
  async () => {
    const wf = await loadWorkflowMerge();
    const schema = await loadVerdictSchema();

    const required = schema.required as ReadonlyArray<string> | undefined;
    assert(
      Array.isArray(required) && required.length > 0,
      `Schema must declare a non-empty required[]. File: ${SCHEMA_PATH}`,
    );

    const handoffs = prMergerHandoffs(wf);
    assert(
      handoffs.length > 0,
      `Expected at least one handoff referencing pr-merger-verdict@1.0.0. ` +
        `File: ${WORKFLOW_MERGE_PATH}`,
    );

    for (const h of handoffs) {
      const bound = Object.keys(h.payloadFrom);
      const missing = required.filter((k) => !bound.includes(k));
      assertEquals(
        missing,
        [],
        `Handoff '${h.id}' is missing schema-required payloadFrom keys: ` +
          `${JSON.stringify(missing)}\n` +
          `  IF the schema is authoritative: add bindings to ${WORKFLOW_MERGE_PATH}\n` +
          `  IF the handoff is authoritative: remove the keys from required[] in ${SCHEMA_PATH}`,
      );
    }
  },
);

Deno.test(
  "conformance: workflow-merge literal 'approved'/'rejected' is accepted by schema.verdict enum",
  async () => {
    const wf = await loadWorkflowMerge();
    const schema = await loadVerdictSchema();

    const verdictProp = (schema.properties as Record<string, unknown>)
      .verdict as { enum?: ReadonlyArray<string> } | undefined;
    assert(
      verdictProp !== undefined && Array.isArray(verdictProp.enum),
      `Schema must declare properties.verdict.enum. File: ${SCHEMA_PATH}`,
    );
    const allowed = verdictProp.enum ?? [];

    for (const h of prMergerHandoffs(wf)) {
      const expr = h.payloadFrom.verdict;
      if (expr === undefined) continue;
      // Only check literals; JSONPath expressions are validated at runtime.
      if (!(expr.startsWith("'") && expr.endsWith("'"))) continue;
      const literal = expr.slice(1, -1);
      assert(
        allowed.includes(literal),
        `Handoff '${h.id}' emits verdict literal '${literal}' not in schema enum ` +
          `[${allowed.join(", ")}].\n` +
          `  IF the handoff is authoritative: extend the enum in ${SCHEMA_PATH}\n` +
          `  IF the schema is authoritative: correct payloadFrom.verdict in ${WORKFLOW_MERGE_PATH}`,
      );
    }
  },
);

Deno.test(
  "conformance: workflow-merge literal schema_version matches schema.properties.schema_version.const",
  async () => {
    const wf = await loadWorkflowMerge();
    const schema = await loadVerdictSchema();

    const svProp = (schema.properties as Record<string, unknown>)
      .schema_version as { const?: string } | undefined;
    assert(
      svProp?.const !== undefined,
      `Schema must pin schema_version via properties.schema_version.const. ` +
        `File: ${SCHEMA_PATH}`,
    );
    const pinned = svProp.const;

    for (const h of prMergerHandoffs(wf)) {
      const expr = h.payloadFrom.schema_version;
      assert(
        typeof expr === "string" && expr.startsWith("'") && expr.endsWith("'"),
        `Handoff '${h.id}'.payloadFrom.schema_version must be a single-quoted ` +
          `literal. Got: ${expr}`,
      );
      const literal = expr.slice(1, -1);
      assertEquals(
        literal,
        pinned,
        `Handoff '${h.id}' emits schema_version='${literal}' but schema pins ` +
          `'${pinned}'.\n` +
          `  Fix: align ${WORKFLOW_MERGE_PATH} payloadFrom.schema_version to '${pinned}'.`,
      );
    }
  },
);

// =============================================================================
// (B) Real-schema integration — end-to-end emit against on-disk schema
// =============================================================================

/**
 * Build a real `InMemorySchemaRegistry` seeded via `registerWorkflowSchemas`.
 * The registry loads every `handoff.emit.schemaRef` referenced by the given
 * workflow from `<repoRoot>/agents/common/schemas/<ref>.json`.
 */
async function buildRealRegistry(
  wf: WorkflowConfig,
): Promise<InMemorySchemaRegistry> {
  const registry = new InMemorySchemaRegistry();
  await registerWorkflowSchemas(registry, wf, REPO_ROOT);
  return registry;
}

/**
 * Emitter dependencies wired against the real schema registry with an
 * in-memory writer (no disk side effects) and a stub issue store.
 */
interface RealEmitterHarness {
  readonly writes: Array<{ path: string; data: string }>;
  readonly persistedPayloads: Array<Record<string, unknown>>;
  readonly emitter: DefaultArtifactEmitter;
}

async function buildRealEmitter(
  wf: WorkflowConfig,
): Promise<RealEmitterHarness> {
  const registry = await buildRealRegistry(wf);
  const writes: Array<{ path: string; data: string }> = [];
  const persistedPayloads: Array<Record<string, unknown>> = [];

  const agents: Readonly<Record<string, WorkflowAgentInfo>> = {
    reviewer: { id: "reviewer", version: "1.12.0", dir: "agents/reviewer" },
  };

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: {
      writeWorkflowPayload: (_issue, _wfId, payload) => {
        persistedPayloads.push({ ...payload });
        return Promise.resolve();
      },
    },
    clock: { now: () => new Date("2026-04-14T10:00:00.000Z") },
    writeFile: (path, data) => {
      writes.push({ path, data });
      return Promise.resolve();
    },
    workflowAgents: agents,
  });

  return { writes, persistedPayloads, emitter };
}

Deno.test(
  "real-schema: approved handoff produces a payload accepted by pr-merger-verdict@1.0.0",
  async () => {
    const wf = await loadWorkflowMerge();
    const { emitter, writes, persistedPayloads } = await buildRealEmitter(wf);

    const approvedHandoff = prMergerHandoffs(wf).find(
      (h) => h.when.outcome === "approved",
    );
    assert(
      approvedHandoff !== undefined,
      `Expected a handoff with when.outcome='approved' in ${WORKFLOW_MERGE_PATH}`,
    );

    // agentResult satisfies every `$.agent.result.*` binding referenced by
    // the approved handoff's payloadFrom. Keeping this fixture aligned with
    // payloadFrom is intentional — if payloadFrom grows a new binding, this
    // fixture surfaces the gap via HandoffResolveError, which is the
    // diagnostic we want.
    const agentResult = {
      pr_number: 123,
      base_branch: "main",
      merge_method: "squash",
      delete_branch: true,
      summary: "All checks green",
      ci_required: true,
    };

    const result = await emitter.emit({
      workflowId: "merge",
      issueNumber: 123,
      sourceAgent: "reviewer",
      sourceOutcome: "approved",
      agentResult,
      handoff: approvedHandoff,
    });

    // Real schema validation passed (otherwise HandoffSchemaValidationError
    // would have thrown). Verify the emit observable side effects.
    assertEquals(result.payload.pr_number, 123);
    assertEquals(result.payload.verdict, "approved");
    assertEquals(result.payload.schema_version, "1.0.0");
    assertEquals(writes.length, 1);
    assertEquals(persistedPayloads.length, 1);
  },
);

Deno.test(
  "real-schema: rejected handoff produces a payload accepted by pr-merger-verdict@1.0.0",
  async () => {
    const wf = await loadWorkflowMerge();
    const { emitter } = await buildRealEmitter(wf);

    const rejectedHandoff = prMergerHandoffs(wf).find(
      (h) => h.when.outcome === "rejected",
    );
    assert(
      rejectedHandoff !== undefined,
      `Expected a handoff with when.outcome='rejected' in ${WORKFLOW_MERGE_PATH}`,
    );

    const agentResult = {
      pr_number: 456,
      base_branch: "main",
      summary: "Conflicts unresolved",
    };

    const result = await emitter.emit({
      workflowId: "merge",
      issueNumber: 456,
      sourceAgent: "reviewer",
      sourceOutcome: "rejected",
      agentResult,
      handoff: rejectedHandoff,
    });

    assertEquals(result.payload.verdict, "rejected");
    assertEquals(result.payload.pr_number, 456);
  },
);

Deno.test(
  "real-schema: dropping a required binding from agentResult triggers HandoffResolveError",
  async () => {
    const wf = await loadWorkflowMerge();
    const { emitter } = await buildRealEmitter(wf);

    const approvedHandoff = prMergerHandoffs(wf).find(
      (h) => h.when.outcome === "approved",
    );
    assert(approvedHandoff !== undefined);

    // Intentionally omit `base_branch` — $.agent.result.base_branch cannot
    // be resolved. This proves the handoff's payloadFrom is *actually*
    // consulted at emit time (non-vacuity of the happy-path test above).
    const incompleteAgentResult = {
      pr_number: 789,
      merge_method: "squash",
      delete_branch: false,
      summary: "",
      ci_required: true,
    };

    let thrown: unknown;
    try {
      await emitter.emit({
        workflowId: "merge",
        issueNumber: 789,
        sourceAgent: "reviewer",
        sourceOutcome: "approved",
        agentResult: incompleteAgentResult,
        handoff: approvedHandoff,
      });
    } catch (err) {
      thrown = err;
    }

    assert(
      thrown instanceof Error,
      "Expected emit() to reject when a $.agent.result.* binding is unresolved.",
    );
    assert(
      (thrown as Error).message.includes("base_branch"),
      `Error must name the unresolved key for diagnosability. ` +
        `Got: ${(thrown as Error).message}`,
    );
  },
);

Deno.test(
  "real-schema: schema-breaking payload type raises HandoffSchemaValidationError",
  async () => {
    const wf = await loadWorkflowMerge();
    const { emitter } = await buildRealEmitter(wf);

    const approvedHandoff = prMergerHandoffs(wf).find(
      (h) => h.when.outcome === "approved",
    );
    assert(approvedHandoff !== undefined);

    // pr_number is `{ type: "number" }` in the schema. Feed a string and
    // verify Ajv catches it via the real registry (not the stub).
    const badAgentResult = {
      pr_number: "not-a-number",
      base_branch: "main",
      merge_method: "squash",
      delete_branch: false,
      summary: "",
      ci_required: true,
    };

    let thrown: unknown;
    try {
      await emitter.emit({
        workflowId: "merge",
        issueNumber: 1,
        sourceAgent: "reviewer",
        sourceOutcome: "approved",
        agentResult: badAgentResult,
        handoff: approvedHandoff,
      });
    } catch (err) {
      thrown = err;
    }

    assert(
      thrown instanceof HandoffSchemaValidationError,
      `Expected HandoffSchemaValidationError from real schema. ` +
        `Got: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    );
    const err = thrown as HandoffSchemaValidationError;
    assertEquals(err.schemaRef, "pr-merger-verdict@1.0.0");
    assert(
      err.validationErrors.length > 0,
      "Schema validation error list must be non-empty.",
    );
  },
);
