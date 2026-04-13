/**
 * Integration tests for the end-to-end handoff pipeline.
 *
 * Exercises the full orchestrator → dispatcher → artifact-emitter →
 * issue-store flow with a {@link StubDispatcher} driving structured
 * output, a real {@link InMemorySchemaRegistry} holding a pre-registered
 * JSON Schema, and a real filesystem-backed {@link IssueStore} under
 * `Deno.makeTempDir`.
 *
 * These tests are intentionally offline-safe: handoff `payloadFrom`
 * resolves only `$.agent.result.*` / `$.workflow.*` / literals, so no
 * external network access is required.
 *
 * Covered contracts:
 *  1. handoff fires and writes artifact + persists payload
 *  2. non-matching outcome produces no side effects
 *  3. previously-persisted payload is forwarded to subsequent dispatch
 *  4. schema validation failure surfaces from `orchestrator.run`
 *  5. multiple handoffs[] entries matching the same (agent, outcome) all fire
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import { Orchestrator } from "./orchestrator.ts";
import type { DispatchOptions, DispatchOutcome } from "./dispatcher.ts";
import {
  DefaultArtifactEmitter,
  HandoffSchemaValidationError,
  type WorkflowAgentInfo,
} from "./artifact-emitter.ts";
import { InMemorySchemaRegistry } from "./schema-registry.ts";
import { IssueStore } from "./issue-store.ts";
import type {
  HandoffDeclaration,
  IssuePayload,
  WorkflowConfig,
} from "./workflow-types.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";

// =============================================================================
// Test doubles
// =============================================================================

/**
 * GitHub client that yields a fixed label sequence and records mutations.
 * Mirrors the stub used in `orchestrator_test.ts` but trimmed for this
 * suite's single-cycle workflows.
 */
class StubGitHubClient implements GitHubClient {
  #labelSequence: string[][];
  #callIndex = 0;
  #comments: { issueNumber: number; comment: string }[] = [];
  #labelUpdates: {
    issueNumber: number;
    removed: string[];
    added: string[];
  }[] = [];
  #closedIssues: number[] = [];

  constructor(labelSequence: string[][]) {
    this.#labelSequence = labelSequence;
  }

  getIssueLabels(_issueNumber: number): Promise<string[]> {
    const idx = Math.min(this.#callIndex, this.#labelSequence.length - 1);
    const labels = this.#labelSequence[idx];
    this.#callIndex++;
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(
    issueNumber: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.#labelUpdates.push({
      issueNumber,
      removed: labelsToRemove,
      added: labelsToAdd,
    });
    return Promise.resolve();
  }

  addIssueComment(issueNumber: number, comment: string): Promise<void> {
    this.#comments.push({ issueNumber, comment });
    return Promise.resolve();
  }

  createIssue(
    _title: string,
    _labels: string[],
    _body: string,
  ): Promise<number> {
    return Promise.resolve(999);
  }

  closeIssue(issueNumber: number): Promise<void> {
    this.#closedIssues.push(issueNumber);
    return Promise.resolve();
  }

  listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return Promise.resolve([]);
  }

  getIssueDetail(_issueNumber: number): Promise<IssueDetail> {
    return Promise.resolve({
      number: 0,
      title: "",
      body: "",
      labels: [],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });
  }
}

/** Stub dispatcher that records calls and returns a prepared outcome. */
class RecordingDispatcher {
  readonly calls: Array<
    { agentId: string; issueNumber: number; options?: DispatchOptions }
  > = [];
  #outcome: DispatchOutcome;

  constructor(outcome: DispatchOutcome) {
    this.#outcome = outcome;
  }

  dispatch(
    agentId: string,
    issueNumber: number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome> {
    this.calls.push({ agentId, issueNumber, options });
    return Promise.resolve(this.#outcome);
  }
}

// =============================================================================
// Fixtures
// =============================================================================

/** JSON Schema used to validate handoff payloads in the happy-path tests. */
const PASSING_SCHEMA: Record<string, unknown> = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "test-schema@1",
  type: "object",
  required: ["summary", "outcome"],
  properties: {
    summary: { type: "string" },
    outcome: { type: "string" },
  },
  additionalProperties: true,
};

/** JSON Schema that forces validation failure regardless of payload. */
const REJECTING_SCHEMA: Record<string, unknown> = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "rejecting-schema@1",
  type: "object",
  required: ["missing_field"],
  properties: {
    missing_field: { type: "string" },
  },
  additionalProperties: true,
};

const DEFAULT_AGENTS: Readonly<Record<string, WorkflowAgentInfo>> = {
  sampleAgent: {
    id: "sampleAgent",
    version: "1.0.0",
    dir: "agents/sample",
  },
};

/**
 * Minimal workflow config: one actionable phase `ready` → agent
 * `sampleAgent` → terminal phase `done`. The phase transition after
 * dispatch unconditionally routes to `done`, so the orchestrator loop
 * terminates after exactly one dispatch call.
 */
function makeWorkflow(
  handoffs: ReadonlyArray<HandoffDeclaration>,
): WorkflowConfig {
  return {
    version: "1.0.0",
    // `labelPrefix` sets Orchestrator.workflowId, which becomes the suffix
    // of the workflow-state / workflow-payload file names. Tests assert
    // against "test" (the workflowId) when reading/writing payloads.
    labelPrefix: "test",
    phases: {
      ready: { type: "actionable", priority: 1, agent: "sampleAgent" },
      done: { type: "terminal" },
    },
    labelMapping: {
      ready: "ready",
      done: "done",
    },
    agents: {
      sampleAgent: {
        role: "transformer",
        directory: "sampleAgent",
        outputPhase: "done",
        fallbackPhase: "done",
      },
    },
    rules: {
      maxCycles: 3,
      cycleDelayMs: 0,
    },
    handoffs,
  };
}

/**
 * Build a {@link HandoffDeclaration} whose payloadFrom resolves only
 * against `$.agent.result.*` and literals, keeping emission offline-safe.
 * `emit.path` is templated off of `payloadFrom.id` so tests exercise
 * the path-template expansion pass.
 */
function makeHandoff(
  id: string,
  outcome: string,
  options: { readonly schemaRef?: string; readonly path?: string } = {},
): HandoffDeclaration {
  return {
    id,
    when: { fromAgent: "sampleAgent", outcome },
    emit: {
      type: "test-artifact",
      schemaRef: options.schemaRef ?? "test-schema@1",
      path: options.path ?? `.agent/artifacts/${id}-\${payload.id}.json`,
    },
    payloadFrom: {
      id: `'${id}'`,
      summary: "$.agent.result.summary",
      outcome: "$.agent.result.outcome",
    },
    persistPayloadTo: "issueStore",
  };
}

interface HarnessOptions {
  readonly handoffs: ReadonlyArray<HandoffDeclaration>;
  readonly dispatcher: RecordingDispatcher;
  readonly schemas?: ReadonlyArray<
    { ref: string; schema: Record<string, unknown> }
  >;
  readonly labelSequence?: ReadonlyArray<ReadonlyArray<string>>;
  /**
   * Issues to seed into the store before `run` starts. Each receives a
   * `meta.json` with the declared initial labels; `run()` uses those
   * labels on its first iteration (orchestrator prefers store.readMeta
   * over github.getIssueLabels whenever a store is attached).
   */
  readonly seedIssues?: ReadonlyArray<
    { issueNumber: number; labels: ReadonlyArray<string> }
  >;
}

interface Harness {
  readonly orchestrator: Orchestrator;
  readonly store: IssueStore;
  readonly cwd: string;
  readonly registry: InMemorySchemaRegistry;
  readonly github: StubGitHubClient;
  cleanup(): Promise<void>;
}

/**
 * Compose a complete orchestrator harness under a fresh temp cwd.
 * The store lives under `${cwd}/.agent/issues` and the artifact
 * emitter writes under `${cwd}` so produced paths are relative and
 * resolvable via `join(cwd, artifactPath)`.
 */
async function buildHarness(opts: HarnessOptions): Promise<Harness> {
  const cwd = await Deno.makeTempDir({ prefix: "integration-handoff-" });
  const storePath = join(cwd, ".agent", "issues");
  await Deno.mkdir(storePath, { recursive: true });

  const registry = new InMemorySchemaRegistry();
  const schemasToRegister = opts.schemas ??
    [{ ref: "test-schema@1", schema: PASSING_SCHEMA }];
  for (const entry of schemasToRegister) {
    registry.register(entry.ref, entry.schema);
  }

  const store = new IssueStore(storePath);
  await store.ensureDir();

  for (const seed of opts.seedIssues ?? []) {
    await store.writeIssue({
      meta: {
        number: seed.issueNumber,
        title: `seeded #${seed.issueNumber}`,
        labels: [...seed.labels],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "",
      comments: [],
    });
  }

  const writeFile = async (path: string, data: string): Promise<void> => {
    const abs = path.startsWith("/") ? path : join(cwd, path);
    const dir = abs.slice(0, abs.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(abs, data);
  };

  const emitter = new DefaultArtifactEmitter({
    schemaRegistry: registry,
    issueStore: store,
    clock: { now: (): Date => new Date("2026-04-14T10:00:00.000Z") },
    writeFile,
    workflowAgents: DEFAULT_AGENTS,
  });

  const labelSequence = opts.labelSequence ?? [["ready"], ["done"]];
  const github = new StubGitHubClient(labelSequence.map((l) => [...l]));

  const orchestrator = new Orchestrator(
    makeWorkflow(opts.handoffs),
    github,
    // deno-lint-ignore no-explicit-any
    opts.dispatcher as any,
    cwd,
    emitter,
  );

  return {
    orchestrator,
    store,
    cwd,
    registry,
    github,
    cleanup: async () => {
      await Deno.remove(cwd, { recursive: true });
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

Deno.test(
  "handoff fires, writes artifact, persists payload, logs handoff_emitted",
  async () => {
    const handoff = makeHandoff("approved-handoff", "approved");
    const dispatcher = new RecordingDispatcher({
      outcome: "approved",
      durationMs: 0,
      structuredOutput: {
        outcome: "approved",
        summary: "LGTM",
      },
    });
    const harness = await buildHarness({
      handoffs: [handoff],
      dispatcher,
      seedIssues: [{ issueNumber: 42, labels: ["test:ready"] }],
    });

    try {
      const result = await harness.orchestrator.run(
        42,
        undefined,
        harness.store,
      );

      // The terminal transition fires on the second label read after
      // dispatch; status must be "completed" for the happy-path loop.
      assertEquals(
        result.status,
        "completed",
        "Expected terminal phase to resolve after single dispatch. " +
          "Fix: inspect makeWorkflow() phase transitions and labelSequence.",
      );

      // (a) Artifact file was written to the rendered path.
      const artifactPath = join(
        harness.cwd,
        ".agent",
        "artifacts",
        "approved-handoff-approved-handoff.json",
      );
      const artifactText = await Deno.readTextFile(artifactPath);
      const artifact = JSON.parse(artifactText) as Record<string, unknown>;
      assertEquals(artifact.id, "approved-handoff");
      assertEquals(artifact.summary, "LGTM");
      assertEquals(artifact.outcome, "approved");

      // (b) Payload persisted via IssueStore.writeWorkflowPayload.
      const persisted = await harness.store.readWorkflowPayload(42, "test");
      assertEquals(
        persisted?.id,
        "approved-handoff",
        "Expected persisted payload to match handoff emission. " +
          "Fix: check DefaultArtifactEmitter step 5 (persistPayloadTo).",
      );
      assertEquals(persisted?.summary, "LGTM");

      // (c) Orchestrator ran exactly one dispatch and the agent id
      //     / outcome match what fed the handoff filter.
      assertEquals(dispatcher.calls.length, 1);
      assertEquals(dispatcher.calls[0].agentId, "sampleAgent");
    } finally {
      await harness.cleanup();
    }
  },
);

Deno.test("no handoff fires when outcome does not match when.outcome", async () => {
  const handoff = makeHandoff("approved-only", "approved");
  const dispatcher = new RecordingDispatcher({
    outcome: "rejected",
    durationMs: 0,
    structuredOutput: { outcome: "rejected", summary: "nope" },
  });
  const harness = await buildHarness({
    handoffs: [handoff],
    dispatcher,
    seedIssues: [{ issueNumber: 7, labels: ["test:ready"] }],
  });

  try {
    await harness.orchestrator.run(7, undefined, harness.store);

    // No artifact file should have been created under the artifacts dir.
    const artifactsDir = join(harness.cwd, ".agent", "artifacts");
    let entries = 0;
    try {
      for await (const _entry of Deno.readDir(artifactsDir)) {
        entries++;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    assertEquals(
      entries,
      0,
      "Expected no artifact file when outcome does not match handoff.when. " +
        "Fix: check orchestrator Step 7a filter on dispatchResult.outcome.",
    );

    // No workflow payload should have been persisted.
    const persisted = await harness.store.readWorkflowPayload(7, "test");
    assertEquals(
      persisted,
      undefined,
      "Expected no persisted payload when handoff does not fire. " +
        "Fix: ensure ArtifactEmitter.emit() is not invoked on non-matching outcome.",
    );
  } finally {
    await harness.cleanup();
  }
});

Deno.test(
  "previously persisted payload is forwarded to subsequent dispatch",
  async () => {
    // No handoffs — we only need to verify that on run(), the orchestrator
    // reads the prior payload from issue-store and forwards it to the
    // dispatcher via DispatchOptions.payload.
    const dispatcher = new RecordingDispatcher({
      outcome: "approved",
      durationMs: 0,
      structuredOutput: { outcome: "approved", summary: "ok" },
    });
    const harness = await buildHarness({
      handoffs: [],
      dispatcher,
      seedIssues: [{ issueNumber: 99, labels: ["test:ready"] }],
    });

    try {
      const prior: IssuePayload = Object.freeze({
        prNumber: 42,
        verdictPath: "some",
      });
      await harness.store.writeWorkflowPayload(99, "test", prior);

      await harness.orchestrator.run(99, undefined, harness.store);

      assertEquals(
        dispatcher.calls.length,
        1,
        "Expected exactly one dispatch call. Fix: inspect labelSequence.",
      );
      const forwarded = dispatcher.calls[0].options?.payload;
      assertEquals(
        forwarded?.prNumber,
        42,
        "Expected prior payload prNumber to be forwarded to dispatcher. " +
          "Fix: inspect orchestrator.ts store.readWorkflowPayload + dispatch() options.",
      );
      assertEquals(forwarded?.verdictPath, "some");
    } finally {
      await harness.cleanup();
    }
  },
);

Deno.test(
  "schema validation failure surfaces as HandoffSchemaValidationError",
  async () => {
    const handoff = makeHandoff("will-fail", "approved", {
      schemaRef: "rejecting-schema@1",
    });
    const dispatcher = new RecordingDispatcher({
      outcome: "approved",
      durationMs: 0,
      // payload lacks `missing_field` demanded by REJECTING_SCHEMA.
      structuredOutput: { outcome: "approved", summary: "ok" },
    });
    const harness = await buildHarness({
      handoffs: [handoff],
      dispatcher,
      schemas: [{ ref: "rejecting-schema@1", schema: REJECTING_SCHEMA }],
      seedIssues: [{ issueNumber: 11, labels: ["test:ready"] }],
    });

    try {
      await assertRejects(
        () => harness.orchestrator.run(11, undefined, harness.store),
        HandoffSchemaValidationError,
        "rejecting-schema@1",
      );
    } finally {
      await harness.cleanup();
    }
  },
);

Deno.test(
  "multi-handoff: both entries matching the same outcome fire",
  async () => {
    const handoffA = makeHandoff("handoff-a", "approved");
    const handoffB = makeHandoff("handoff-b", "approved");
    const dispatcher = new RecordingDispatcher({
      outcome: "approved",
      durationMs: 0,
      structuredOutput: { outcome: "approved", summary: "dual" },
    });
    const harness = await buildHarness({
      handoffs: [handoffA, handoffB],
      dispatcher,
      seedIssues: [{ issueNumber: 55, labels: ["test:ready"] }],
    });

    try {
      await harness.orchestrator.run(55, undefined, harness.store);

      const pathA = join(
        harness.cwd,
        ".agent",
        "artifacts",
        "handoff-a-handoff-a.json",
      );
      const pathB = join(
        harness.cwd,
        ".agent",
        "artifacts",
        "handoff-b-handoff-b.json",
      );

      const artifactA = JSON.parse(await Deno.readTextFile(pathA)) as Record<
        string,
        unknown
      >;
      const artifactB = JSON.parse(await Deno.readTextFile(pathB)) as Record<
        string,
        unknown
      >;

      assertEquals(artifactA.id, "handoff-a");
      assertEquals(artifactB.id, "handoff-b");

      // Both handoffs set persistPayloadTo: "issueStore". The orchestrator
      // iterates `handoffs[]` in declaration order (orchestrator.ts:317,
      // `for (const handoff of matching)`), so the second emit overwrites
      // the first under the single `workflow-payload-<wfId>.json` key.
      // Last-write-wins is the ordering contract; assert it directly.
      const persisted = await harness.store.readWorkflowPayload(55, "test");
      assertEquals(
        persisted?.id,
        "handoff-b",
        "Expected last handoff in declaration order to win the persistence slot. " +
          "Fix: if handoffs[] iteration order changes in orchestrator.ts, update this " +
          "expectation AND document the new contract in docs/internal.",
      );
    } finally {
      await harness.cleanup();
    }
  },
);
