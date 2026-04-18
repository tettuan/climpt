/**
 * Tests for artifact-emitter.ts
 *
 * Contract surface:
 *  - payload resolution across $.agent.result.* and $.workflow.* roots
 *  - single-quoted literal expressions
 *  - `[sourceAgent]` sentinel substitution for $.workflow.agents[...]
 *  - missing sources raise HandoffResolveError
 *  - schema validation failure raises HandoffSchemaValidationError
 *  - persistPayloadTo: "subjectStore" persists via writeWorkflowPayload
 *  - persistPayloadTo: "none" skips persistence
 *  - `${payload.*}` template is expanded after payloadFrom resolution
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  DefaultArtifactEmitter,
  HandoffResolveError,
  HandoffSchemaValidationError,
  type WorkflowAgentInfo,
} from "./artifact-emitter.ts";
import type { ValidationOutcome } from "./schema-registry.ts";
import type { HandoffDeclaration, SubjectPayload } from "./workflow-types.ts";

// =============================================================================
// Shared constants
// =============================================================================
// Single source of truth for the fixed clock instant. Both the fixture
// (`fixedClock(FIXED_NOW_ISO)`) and the assertion (`evaluatedAt === FIXED_NOW_ISO`)
// must derive from the same constant — otherwise a drift between fixture
// and assertion becomes an undiagnosable synchronization point.
const FIXED_NOW_ISO = "2026-04-14T10:00:00.000Z";

// =============================================================================
// Test doubles
// =============================================================================

interface StubSchemaRegistryOptions {
  /** Force validate() to return this outcome regardless of ref. */
  readonly outcome?: ValidationOutcome;
}

function stubSchemaRegistry(opts: StubSchemaRegistryOptions = {}) {
  const calls: Array<{ ref: string; data: unknown }> = [];
  return {
    calls,
    registry: {
      register: () => {
        throw new Error("stubSchemaRegistry.register: not implemented");
      },
      get: () => undefined,
      validate: (ref: string, data: unknown): ValidationOutcome => {
        calls.push({ ref, data });
        return opts.outcome ?? { valid: true, errors: [] };
      },
    },
  };
}

interface StubSubjectStoreCall {
  readonly subjectId: number;
  readonly workflowId: string;
  readonly payload: SubjectPayload;
}

function stubSubjectStore() {
  const calls: StubSubjectStoreCall[] = [];
  return {
    calls,
    store: {
      writeWorkflowPayload: (
        subjectId: number,
        workflowId: string,
        payload: SubjectPayload,
      ): Promise<void> => {
        calls.push({ subjectId, workflowId, payload });
        return Promise.resolve();
      },
    },
  };
}

function fixedClock(iso: string) {
  return { now: () => new Date(iso) };
}

function makeWriter() {
  const writes: Array<{ path: string; data: string }> = [];
  return {
    writes,
    writeFile: (path: string, data: string): Promise<void> => {
      writes.push({ path, data });
      return Promise.resolve();
    },
  };
}

const DEFAULT_AGENTS: Readonly<Record<string, WorkflowAgentInfo>> = {
  "sample-source": {
    id: "sample-source",
    version: "2.3.4",
    dir: "agents/sample-source",
  },
};

// =============================================================================
// Fixtures
// =============================================================================

function baseHandoff(
  overrides: Partial<HandoffDeclaration> = {},
): HandoffDeclaration {
  return {
    id: "sample-handoff",
    when: { fromAgent: "sample-source", outcome: "approved" },
    emit: {
      type: "artifact",
      schemaRef: "sample-artifact@1.0.0",
      path: ".agent/artifacts/${payload.prNumber}.json",
    },
    payloadFrom: {
      prNumber: "$.agent.result.pr_number",
      baseBranch: "$.agent.result.base_branch",
      outcome: "$.agent.result.outcome",
      summary: "$.agent.result.summary",
      schemaVersion: "'1.0.0'",
      evaluatedAt: "$.workflow.context.now",
      sourceVersion: "$.workflow.agents[sourceAgent].version",
    },
    persistPayloadTo: "subjectStore",
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

Deno.test("emit: resolves payload across agent / workflow roots", async () => {
  const { registry } = stubSchemaRegistry();
  const { store, calls: storeCalls } = stubSubjectStore();
  const { writes, writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const result = await emitter.emit({
    workflowId: "sample-workflow",
    subjectId: 42,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: {
      pr_number: 42,
      base_branch: "main",
      outcome: "approved",
      summary: "Looks good",
    },
    handoff: baseHandoff(),
  });

  assertEquals(result.payload.prNumber, 42);
  assertEquals(result.payload.baseBranch, "main");
  assertEquals(result.payload.outcome, "approved");
  assertEquals(result.payload.summary, "Looks good");
  assertEquals(result.payload.schemaVersion, "1.0.0");
  assertEquals(result.payload.evaluatedAt, FIXED_NOW_ISO);
  assertEquals(result.payload.sourceVersion, "2.3.4");

  assertEquals(result.artifactPath, ".agent/artifacts/42.json");
  assertEquals(writes.length, 1);
  assertEquals(writes[0].path, ".agent/artifacts/42.json");
  assertEquals(storeCalls.length, 1);
  assertEquals(storeCalls[0].subjectId, 42);
  assertEquals(storeCalls[0].workflowId, "sample-workflow");
});

Deno.test("emit: single-quoted literal becomes string payload value", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubSubjectStore();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const handoff = baseHandoff({
    payloadFrom: {
      marker: "'static-value'",
      flag: "'true'",
    },
    emit: {
      type: "artifact",
      schemaRef: "sample-artifact@1.0.0",
      path: ".agent/artifacts/literal.json",
    },
    persistPayloadTo: "none",
  });

  const result = await emitter.emit({
    workflowId: "sample-workflow",
    subjectId: 1,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: {},
    handoff,
  });

  assertEquals(result.payload.marker, "static-value");
  assertEquals(result.payload.flag, "true");
});

Deno.test("emit: [sourceAgent] sentinel resolves to input.sourceAgent", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubSubjectStore();
  const { writeFile } = makeWriter();

  const agents: Readonly<Record<string, WorkflowAgentInfo>> = {
    "dynamic-source": {
      id: "dynamic-source",
      version: "9.9.9",
      dir: "agents/dynamic-source",
    },
  };

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: agents,
  });

  const handoff = baseHandoff({
    payloadFrom: {
      sourceVersion: "$.workflow.agents[sourceAgent].version",
      sourceDir: "$.workflow.agents[sourceAgent].dir",
    },
    emit: {
      type: "artifact",
      schemaRef: "sample-artifact@1.0.0",
      path: ".agent/artifacts/dynamic.json",
    },
    persistPayloadTo: "none",
  });

  const result = await emitter.emit({
    workflowId: "sample-workflow",
    subjectId: 7,
    sourceAgent: "dynamic-source",
    sourceOutcome: "approved",
    agentResult: {},
    handoff,
  });

  assertEquals(result.payload.sourceVersion, "9.9.9");
  assertEquals(result.payload.sourceDir, "agents/dynamic-source");
});

Deno.test("emit: missing source value throws HandoffResolveError", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubSubjectStore();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const handoff = baseHandoff({
    payloadFrom: {
      missing: "$.agent.result.doesNotExist",
    },
    persistPayloadTo: "none",
    emit: {
      type: "artifact",
      schemaRef: "sample-artifact@1.0.0",
      path: ".agent/artifacts/missing.json",
    },
  });

  await assertRejects(
    () =>
      emitter.emit({
        workflowId: "sample-workflow",
        subjectId: 1,
        sourceAgent: "sample-source",
        sourceOutcome: "approved",
        agentResult: {},
        handoff,
      }),
    HandoffResolveError,
  );
});

Deno.test("emit: schema validation failure throws HandoffSchemaValidationError", async () => {
  const { registry } = stubSchemaRegistry({
    outcome: { valid: false, errors: ["/prNumber must be string"] },
  });
  const { store } = stubSubjectStore();
  const { writeFile, writes } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  await assertRejects(
    () =>
      emitter.emit({
        workflowId: "sample-workflow",
        subjectId: 42,
        sourceAgent: "sample-source",
        sourceOutcome: "approved",
        agentResult: {
          pr_number: 42,
          base_branch: "main",
          outcome: "approved",
          summary: "ok",
        },
        handoff: baseHandoff(),
      }),
    HandoffSchemaValidationError,
    "must be string",
  );

  assertEquals(
    writes.length,
    0,
    "writeFile must not be called when schema validation fails",
  );
});

Deno.test("emit: persistPayloadTo 'subjectStore' calls writeWorkflowPayload", async () => {
  const { registry } = stubSchemaRegistry();
  const { store, calls } = stubSubjectStore();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  await emitter.emit({
    workflowId: "persist-wf",
    subjectId: 99,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: {
      pr_number: 99,
      base_branch: "main",
      outcome: "approved",
      summary: "ok",
    },
    handoff: baseHandoff({ persistPayloadTo: "subjectStore" }),
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].subjectId, 99);
  assertEquals(calls[0].workflowId, "persist-wf");
});

Deno.test("emit: persistPayloadTo 'none' skips writeWorkflowPayload", async () => {
  const { registry } = stubSchemaRegistry();
  const { store, calls } = stubSubjectStore();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  await emitter.emit({
    workflowId: "no-persist",
    subjectId: 11,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: {
      pr_number: 11,
      base_branch: "main",
      outcome: "approved",
      summary: "ok",
    },
    handoff: baseHandoff({ persistPayloadTo: "none" }),
  });

  assertEquals(
    calls.length,
    0,
    "persistPayloadTo='none' must not invoke writeWorkflowPayload",
  );
});

Deno.test("emit: path template expansion resolves after payloadFrom", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubSubjectStore();
  const { writes, writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const handoff = baseHandoff({
    payloadFrom: {
      prNumber: "$.agent.result.pr_number",
      // payload key referencing another payload key — must resolve in a
      // second pass after prNumber is populated.
      artifactRef: "artifacts/${payload.prNumber}.json",
    },
    emit: {
      type: "artifact",
      schemaRef: "sample-artifact@1.0.0",
      path: ".agent/out/${payload.prNumber}-${payload.prNumber}.json",
    },
    persistPayloadTo: "none",
  });

  const result = await emitter.emit({
    workflowId: "sample-workflow",
    subjectId: 1007,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: { pr_number: 1007 },
    handoff,
  });

  assertEquals(result.payload.prNumber, 1007);
  assertEquals(result.payload.artifactRef, "artifacts/1007.json");
  assertEquals(result.artifactPath, ".agent/out/1007-1007.json");
  assertEquals(writes[0].path, ".agent/out/1007-1007.json");
});

Deno.test("emit: unknown workflow agent id raises HandoffResolveError", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubSubjectStore();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const handoff = baseHandoff({
    payloadFrom: {
      ver: "$.workflow.agents[sourceAgent].version",
    },
    persistPayloadTo: "none",
    emit: {
      type: "artifact",
      schemaRef: "sample-artifact@1.0.0",
      path: ".agent/artifacts/x.json",
    },
  });

  await assertRejects(
    () =>
      emitter.emit({
        workflowId: "sample-workflow",
        subjectId: 1,
        sourceAgent: "not-registered",
        sourceOutcome: "approved",
        agentResult: {},
        handoff,
      }),
    HandoffResolveError,
    "not-registered",
  );
});

// =============================================================================
// Error-path enumeration
// =============================================================================
// Every branch that throws HandoffResolveError in artifact-emitter.ts is
// a public contract: it identifies which binding expression is malformed
// so a workflow author can fix it. These tests exercise each branch and
// assert the error message names the offending key or path fragment so
// diagnostics stay actionable.

function makeErrorPathEmitter(): DefaultArtifactEmitter {
  const { registry } = stubSchemaRegistry();
  const { store } = stubSubjectStore();
  const { writeFile } = makeWriter();
  return new DefaultArtifactEmitter({
    schemaRegistry: registry,
    subjectStore: store,
    clock: fixedClock(FIXED_NOW_ISO),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });
}

function minimalEmitInput(
  payloadFrom: Readonly<Record<string, string>>,
): Parameters<DefaultArtifactEmitter["emit"]>[0] {
  return {
    workflowId: "sample-workflow",
    subjectId: 1,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: {},
    handoff: baseHandoff({
      payloadFrom,
      persistPayloadTo: "none",
      emit: {
        type: "artifact",
        schemaRef: "sample-artifact@1.0.0",
        path: ".agent/artifacts/x.json",
      },
    }),
  };
}

Deno.test("error-path: expression not starting with $. or ' raises resolve error", async () => {
  const emitter = makeErrorPathEmitter();
  await assertRejects(
    () => emitter.emit(minimalEmitInput({ bad: "plain-string-no-root" })),
    HandoffResolveError,
    // Message must identify the offending key so the workflow author knows
    // which payloadFrom entry to fix.
    "bad",
  );
});

Deno.test("error-path: unknown root (not 'agent' or 'workflow') raises resolve error", async () => {
  const emitter = makeErrorPathEmitter();
  await assertRejects(
    () => emitter.emit(minimalEmitInput({ bad: "$.other.something" })),
    HandoffResolveError,
    "other",
  );
});

Deno.test("error-path: `$.root` without path segment raises resolve error", async () => {
  const emitter = makeErrorPathEmitter();
  await assertRejects(
    () => emitter.emit(minimalEmitInput({ bad: "$.agent" })),
    HandoffResolveError,
    "bad",
  );
});

Deno.test("error-path: $.agent.* without .result prefix raises resolve error", async () => {
  const emitter = makeErrorPathEmitter();
  await assertRejects(
    () => emitter.emit(minimalEmitInput({ bad: "$.agent.id" })),
    HandoffResolveError,
    // "only $.agent.result.* is supported" — message must surface the
    // constraint so the author fixes the expression, not the agent.
    "result",
  );
});

Deno.test("error-path: $.workflow.* outside .context / .agents raises resolve error", async () => {
  const emitter = makeErrorPathEmitter();
  await assertRejects(
    () => emitter.emit(minimalEmitInput({ bad: "$.workflow.unknown" })),
    HandoffResolveError,
    "workflow",
  );
});

Deno.test("error-path: $.workflow.agents[ without closing ']' raises resolve error", async () => {
  const emitter = makeErrorPathEmitter();
  await assertRejects(
    () => emitter.emit(minimalEmitInput({ bad: "$.workflow.agents[open" })),
    HandoffResolveError,
    // The parser error must identify the offending bracket so the author
    // does not mistake this for a missing-agent error.
    "']'",
  );
});

Deno.test("error-path: `${payload.<missing>}` template raises resolve error naming the key", async () => {
  const emitter = makeErrorPathEmitter();
  await assertRejects(
    () =>
      emitter.emit(minimalEmitInput({
        // Reference a key that will never be populated in the payload.
        derived: "prefix-${payload.neverResolved}",
      })),
    HandoffResolveError,
    "neverResolved",
  );
});

Deno.test("error-path: resolve error carries handoffId, key, and expr for diagnostics", async () => {
  const emitter = makeErrorPathEmitter();
  let captured: unknown;
  try {
    await emitter.emit(minimalEmitInput({ missing: "$.agent.result.nope" }));
  } catch (err) {
    captured = err;
  }
  if (!(captured instanceof HandoffResolveError)) {
    throw new Error(
      `Expected HandoffResolveError; got ${
        captured instanceof Error ? captured.message : String(captured)
      }`,
    );
  }
  // These fields are part of the public error contract — consumers
  // (orchestrator logging, future UI) read them structurally.
  assertEquals(captured.handoffId, "sample-handoff");
  assertEquals(captured.key, "missing");
  assertEquals(captured.expr, "$.agent.result.nope");
});
