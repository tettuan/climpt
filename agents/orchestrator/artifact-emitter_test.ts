/**
 * Tests for artifact-emitter.ts
 *
 * Contract surface:
 *  - payload resolution across all supported JSONPath roots
 *  - single-quoted literal expressions
 *  - `[sourceAgent]` sentinel substitution for $.workflow.agents[...]
 *  - missing sources raise HandoffResolveError
 *  - schema validation failure raises HandoffSchemaValidationError
 *  - persistPayloadTo: "issueStore" persists via writeWorkflowPayload
 *  - persistPayloadTo: "none" skips persistence
 *  - `${payload.*}` template is expanded after payloadFrom resolution
 *  - GitHub fetch is lazy — never called when no $.github.pr.* reference
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  DefaultArtifactEmitter,
  type GithubClient,
  HandoffResolveError,
  HandoffSchemaValidationError,
  type PrMetadata,
  type WorkflowAgentInfo,
} from "./artifact-emitter.ts";
import type { ValidationOutcome } from "./schema-registry.ts";
import type { HandoffDeclaration, IssuePayload } from "./workflow-types.ts";

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

interface StubIssueStoreCall {
  readonly issueNumber: number;
  readonly workflowId: string;
  readonly payload: IssuePayload;
}

function stubIssueStore() {
  const calls: StubIssueStoreCall[] = [];
  return {
    calls,
    store: {
      writeWorkflowPayload: (
        issueNumber: number,
        workflowId: string,
        payload: IssuePayload,
      ): Promise<void> => {
        calls.push({ issueNumber, workflowId, payload });
        return Promise.resolve();
      },
    },
  };
}

interface StubGithubClient extends GithubClient {
  readonly callCount: { value: number };
}

function stubGithubClient(metadata?: PrMetadata): StubGithubClient {
  const callCount = { value: 0 };
  const pr: PrMetadata = metadata ?? { number: 123, baseRefName: "develop" };
  return {
    callCount,
    prView(prNumber: number): Promise<PrMetadata> {
      callCount.value++;
      return Promise.resolve({ ...pr, number: prNumber });
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
      prNumber: "$.github.pr.number",
      baseBranch: "$.github.pr.baseRefName",
      outcome: "$.agent.result.outcome",
      summary: "$.agent.result.summary",
      schemaVersion: "'1.0.0'",
      evaluatedAt: "$.workflow.context.now",
      sourceVersion: "$.workflow.agents[sourceAgent].version",
    },
    persistPayloadTo: "issueStore",
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

Deno.test("emit: resolves payload across agent / github / workflow roots", async () => {
  const { registry } = stubSchemaRegistry();
  const { store, calls: storeCalls } = stubIssueStore();
  const github = stubGithubClient({ number: 42, baseRefName: "main" });
  const { writes, writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const result = await emitter.emit({
    workflowId: "sample-workflow",
    issueNumber: 42,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: { outcome: "approved", summary: "Looks good" },
    handoff: baseHandoff(),
  });

  assertEquals(result.payload.prNumber, 42);
  assertEquals(result.payload.baseBranch, "main");
  assertEquals(result.payload.outcome, "approved");
  assertEquals(result.payload.summary, "Looks good");
  assertEquals(result.payload.schemaVersion, "1.0.0");
  assertEquals(result.payload.evaluatedAt, "2026-04-14T10:00:00.000Z");
  assertEquals(result.payload.sourceVersion, "2.3.4");

  assertEquals(result.artifactPath, ".agent/artifacts/42.json");
  assertEquals(writes.length, 1);
  assertEquals(writes[0].path, ".agent/artifacts/42.json");
  assertEquals(storeCalls.length, 1);
  assertEquals(storeCalls[0].issueNumber, 42);
  assertEquals(storeCalls[0].workflowId, "sample-workflow");
});

Deno.test("emit: single-quoted literal becomes string payload value", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubIssueStore();
  const github = stubGithubClient();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
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
    issueNumber: 1,
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
  const { store } = stubIssueStore();
  const github = stubGithubClient();
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
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
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
    issueNumber: 7,
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
  const { store } = stubIssueStore();
  const github = stubGithubClient();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
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
        issueNumber: 1,
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
  const { store } = stubIssueStore();
  const github = stubGithubClient();
  const { writeFile, writes } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  await assertRejects(
    () =>
      emitter.emit({
        workflowId: "sample-workflow",
        issueNumber: 42,
        sourceAgent: "sample-source",
        sourceOutcome: "approved",
        agentResult: { outcome: "approved", summary: "ok" },
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

Deno.test("emit: persistPayloadTo 'issueStore' calls writeWorkflowPayload", async () => {
  const { registry } = stubSchemaRegistry();
  const { store, calls } = stubIssueStore();
  const github = stubGithubClient();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  await emitter.emit({
    workflowId: "persist-wf",
    issueNumber: 99,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: { outcome: "approved", summary: "ok" },
    handoff: baseHandoff({ persistPayloadTo: "issueStore" }),
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].issueNumber, 99);
  assertEquals(calls[0].workflowId, "persist-wf");
});

Deno.test("emit: persistPayloadTo 'none' skips writeWorkflowPayload", async () => {
  const { registry } = stubSchemaRegistry();
  const { store, calls } = stubIssueStore();
  const github = stubGithubClient();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  await emitter.emit({
    workflowId: "no-persist",
    issueNumber: 11,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: { outcome: "approved", summary: "ok" },
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
  const { store } = stubIssueStore();
  const github = stubGithubClient({ number: 1007, baseRefName: "main" });
  const { writes, writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const handoff = baseHandoff({
    payloadFrom: {
      prNumber: "$.github.pr.number",
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
    issueNumber: 1007,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: {},
    handoff,
  });

  assertEquals(result.payload.prNumber, 1007);
  assertEquals(result.payload.artifactRef, "artifacts/1007.json");
  assertEquals(result.artifactPath, ".agent/out/1007-1007.json");
  assertEquals(writes[0].path, ".agent/out/1007-1007.json");
});

Deno.test("emit: github fetch is lazy — skipped without $.github.pr.*", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubIssueStore();
  const github = stubGithubClient();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const handoff = baseHandoff({
    payloadFrom: {
      outcome: "$.agent.result.outcome",
      evaluatedAt: "$.workflow.context.now",
      marker: "'literal'",
    },
    emit: {
      type: "artifact",
      schemaRef: "sample-artifact@1.0.0",
      path: ".agent/out/lazy.json",
    },
    persistPayloadTo: "none",
  });

  await emitter.emit({
    workflowId: "sample-workflow",
    issueNumber: 1,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: { outcome: "approved" },
    handoff,
  });

  assertEquals(
    github.callCount.value,
    0,
    "githubClient.prView must not be called unless payloadFrom references $.github.pr.*",
  );
});

Deno.test("emit: github fetch fires exactly once when $.github.pr.* is referenced", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubIssueStore();
  const github = stubGithubClient({ number: 42, baseRefName: "main" });
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  await emitter.emit({
    workflowId: "sample-workflow",
    issueNumber: 42,
    sourceAgent: "sample-source",
    sourceOutcome: "approved",
    agentResult: { outcome: "approved", summary: "ok" },
    handoff: baseHandoff(),
  });

  assertEquals(github.callCount.value, 1);
});

Deno.test("emit: unknown workflow agent id raises HandoffResolveError", async () => {
  const { registry } = stubSchemaRegistry();
  const { store } = stubIssueStore();
  const github = stubGithubClient();
  const { writeFile } = makeWriter();

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    githubClient: github,
    clock: fixedClock("2026-04-14T10:00:00.000Z"),
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
        issueNumber: 1,
        sourceAgent: "not-registered",
        sourceOutcome: "approved",
        agentResult: {},
        handoff,
      }),
    HandoffResolveError,
    "not-registered",
  );
});
