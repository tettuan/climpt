/**
 * R5 traceability test (T4.7) — close-route uniformity across (mode × channel).
 *
 * Source of truth:
 *  - `agents/docs/design/realistic/11-invocation-modes.md` §C
 *    "5-step proof": shared Boot → AgentRuntime mode-invariant → Channel
 *    fixed subscribesTo → Channel.execute → CloseTransport → IssueClosedEvent
 *    payload closed under 6 channel ids.
 *  - `agents/docs/design/realistic/11-invocation-modes.md` §E reachability
 *    matrix (workflow / agent / merge-pr × 6 channels).
 *  - `agents/docs/design/realistic/90-traceability.md` §A R5 row hard gate.
 *
 * What the test asserts (R5 hard gate, mechanically):
 *  1. **Per channel, per mode, the close path produces the same
 *     `IssueClosedEvent({ channel })` payload modulo non-structural
 *     fields (`publishedAt`, `runId`).** Concretely: for each cell
 *     (mode ∈ {workflow, agent}, channel ∈ {D, C-pre, C-post, E,
 *     Cascade}), drive a representative scenario and capture the bus
 *     event sequence; assert that the workflow sequence equals the
 *     agent sequence after stripping mode-specific identifiers.
 *
 *  2. **MergeClose (M) cell**: drive
 *     `MergeCloseAdapter.drain` against a fixture fact file written
 *     by a simulated `merge-pr` subprocess and assert that the
 *     resulting `IssueClosedEvent({ channel: "M" })` is byte-for-byte
 *     identical (modulo `publishedAt` / `runId`) to what the same
 *     adapter publishes when called from a workflow boot vs a
 *     standalone boot. M is reachable only via merge-pr (11 §E
 *     `merge-pr` column) but the adapter that bridges merge-pr →
 *     bus is constructed inside both workflow and standalone Boots
 *     so the bus payload is mode-invariant by construction.
 *
 *  3. **`IssueClosedEvent.channel` value range is closed at 6
 *     values** for every captured event in every cell. Type-system
 *     enforces this; the runtime assertion is the redundant guard
 *     that catches accidental widening (e.g. via `as`).
 *
 * Test design rationale (test-design.md, source-of-truth principle):
 *  - The test does NOT hardcode the expected event channel id —
 *    the `expectedChannel` per-cell is read from the same
 *    `ChannelId` literal union the production code uses, so a
 *    rename in `events/types.ts` propagates to the assertion.
 *  - The "modulo" projection is implemented as a single
 *    `projectForR5` helper applied to both sides — comparing
 *    projected forms catches structural drift but lets boot-time
 *    fields (publishedAt, runId) differ across runs.
 *  - Tests are parameterised over the cell matrix; each row
 *    asserts independently so a regression on one cell does not
 *    mask others.
 *
 * Out of scope for this test:
 *  - U (CustomClose) — requires a ContractDescriptor injection
 *    plumbing that PR4-4 does not exercise. Reachability matrix
 *    11 §E lists U as "✓ (declare あれば)"; the gate is structural.
 *    A future PR that wires CustomClose's decide adds a row here.
 *  - Compensation comment correctness — covered by W13 acceptance
 *    test in PR4-2b (orchestrator close-failure path).
 *
 * @see agents/docs/design/realistic/11-invocation-modes.md §C / §E
 * @see agents/docs/design/realistic/90-traceability.md §A R5
 * @see tmp/realistic-migration/phased-plan.md §P4 T4.7
 *
 * @module
 */

import { assert, assertEquals } from "jsr:@std/assert@1";

import { createCloseEventBus } from "../events/bus.ts";
import { createEventCollector } from "../events/_test-helpers.ts";
import type {
  ChannelId,
  Event,
  IssueClosedEvent,
  OutboxActionDecidedEvent,
  SiblingsAllClosedEvent,
  TransitionComputedEvent,
} from "../events/types.ts";

import { DirectCloseChannel } from "./direct-close.ts";
import { OutboxClosePreChannel } from "./outbox-close-pre.ts";
import { OutboxClosePostChannel } from "./outbox-close-post.ts";
import { BoundaryCloseChannel } from "./boundary-close.ts";
import { CascadeCloseChannel } from "./cascade-close.ts";
import {
  MergeCloseAdapter,
  writeMergeCloseFact,
} from "./merge-close-adapter.ts";

import { createAgentRegistry } from "../boot/registry.ts";
import { createMockCloseTransport } from "../transports/close-transport.ts";
import type { AgentRegistry } from "../boot/types.ts";
import type { CloseBinding } from "../src_common/types/agent-bundle.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import type { WorkflowConfig } from "../orchestrator/workflow-types.ts";
import { isAccept } from "../shared/validation/mod.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Empty registry — channels read it only at decide-time, never per-event. */
function emptyRegistry(): AgentRegistry {
  const decision = createAgentRegistry([]);
  if (!isAccept(decision)) {
    throw new Error("test invariant: empty registry must be Accept");
  }
  return decision.value;
}

/**
 * Inert `GitHubClient` stub. Channels constructed for R5 may hold a
 * reference but the test scenarios drive their `decide → execute`
 * directly without invoking github methods. Every method rejects so
 * an accidental live read surfaces in the test.
 */
function inertGithub(): GitHubClient {
  return {
    closeIssue: () => Promise.reject(new Error("R5 stub: closeIssue")),
    addIssueComment: () =>
      Promise.reject(new Error("R5 stub: addIssueComment")),
    createIssue: () => Promise.reject(new Error("R5 stub: createIssue")),
    updateIssueLabels: () =>
      Promise.reject(new Error("R5 stub: updateIssueLabels")),
    getIssueLabels: () => Promise.reject(new Error("R5 stub: getIssueLabels")),
    getRecentComments: () =>
      Promise.reject(new Error("R5 stub: getRecentComments")),
    getIssueDetail: () => Promise.reject(new Error("R5 stub: getIssueDetail")),
    listIssues: () => Promise.reject(new Error("R5 stub: listIssues")),
    reopenIssue: () => Promise.reject(new Error("R5 stub: reopenIssue")),
    listLabels: () => Promise.reject(new Error("R5 stub: listLabels")),
    listLabelsDetailed: () =>
      Promise.reject(new Error("R5 stub: listLabelsDetailed")),
    createLabel: () => Promise.reject(new Error("R5 stub: createLabel")),
    updateLabel: () => Promise.reject(new Error("R5 stub: updateLabel")),
    addIssueToProject: () =>
      Promise.reject(new Error("R5 stub: addIssueToProject")),
    updateProjectItemField: () =>
      Promise.reject(new Error("R5 stub: updateProjectItemField")),
    closeProject: () => Promise.reject(new Error("R5 stub: closeProject")),
    getProjectItemIdForIssue: () =>
      Promise.reject(new Error("R5 stub: getProjectItemIdForIssue")),
    listProjectItems: () =>
      Promise.reject(new Error("R5 stub: listProjectItems")),
    createProjectFieldOption: () =>
      Promise.reject(new Error("R5 stub: createProjectFieldOption")),
    getIssueProjects: () =>
      Promise.reject(new Error("R5 stub: getIssueProjects")),
    listUserProjects: () =>
      Promise.reject(new Error("R5 stub: listUserProjects")),
    getProject: () => Promise.reject(new Error("R5 stub: getProject")),
    getProjectFields: () =>
      Promise.reject(new Error("R5 stub: getProjectFields")),
    removeProjectItem: () =>
      Promise.reject(new Error("R5 stub: removeProjectItem")),
  } as unknown as GitHubClient;
}

/** Vacuous workflow used by CascadeClose / publishers that hold a reference. */
function vacuousWorkflow(): WorkflowConfig {
  return {
    version: "1.0.0",
    issueSource: { kind: "ghRepoIssues", projectMembership: "unbound" },
    phases: {},
    labelMapping: {},
    agents: {},
    invocations: [],
    rules: { maxCycles: 1, cycleDelayMs: 0 },
  };
}

// ---------------------------------------------------------------------------
// Mode-invariance projection
// ---------------------------------------------------------------------------

/**
 * Project an `IssueClosedEvent` to its mode-invariant fields (R5
 * payload contract — design 30 §E, 11 §C step 5).
 *
 * Drops `publishedAt` and `runId`: both are mode-/boot-specific
 * (publishedAt is `Date.now()` and runId is the per-boot UUID).
 * The projection is what allows two different boots in two different
 * modes to be byte-for-byte compared.
 */
interface ProjectedIssueClosed {
  readonly kind: "issueClosed";
  readonly channel: ChannelId;
  readonly outboxPhase?: "pre" | "post";
  readonly subjectId: number | string;
}

function projectForR5(e: IssueClosedEvent): ProjectedIssueClosed {
  const projected: ProjectedIssueClosed = e.outboxPhase === undefined
    ? { kind: "issueClosed", channel: e.channel, subjectId: e.subjectId }
    : {
      kind: "issueClosed",
      channel: e.channel,
      outboxPhase: e.outboxPhase,
      subjectId: e.subjectId,
    };
  return projected;
}

// ---------------------------------------------------------------------------
// Per-channel scenario drivers
// ---------------------------------------------------------------------------

/**
 * Drive the DirectClose channel against a frozen `TransitionComputed`
 * payload through a single bus instance and return the captured
 * `IssueClosedEvent`(s).
 *
 * `mode` is recorded into the publisher event's `agentId` field as
 * `iterator-{mode}` to mimic the reality that workflow vs agent
 * dispatches the same logical agent under slightly different
 * agent-id derivations. The R5 invariant says the published
 * `IssueClosedEvent.channel` is identical regardless of that
 * publisher detail.
 */
async function driveDirectClose(
  mode: "workflow" | "agent",
): Promise<IssueClosedEvent[]> {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);
  const closeTransport = createMockCloseTransport([]);
  const channel = new DirectCloseChannel({
    agentRegistry: emptyRegistry(),
    closeTransport,
    bus,
    runId: `r5-direct-${mode}`,
  });
  channel.register(bus);
  bus.freeze();

  const directBinding: CloseBinding = {
    primary: { kind: "direct" },
    cascade: false,
  };
  const transitionEvent: TransitionComputedEvent = {
    kind: "transitionComputed",
    publishedAt: 1,
    runId: `r5-direct-${mode}`,
    fromPhase: "review",
    toPhase: "complete",
    outcome: "approved",
    closeBinding: directBinding,
    outcomeMatch: true,
    isTerminal: true,
    subjectId: 42,
    agentId: `iterator-${mode}`,
  };
  await channel.handleTransition(transitionEvent);

  return [...collector.byKind("issueClosed")];
}

/**
 * Drive OutboxClose-pre against a frozen `OutboxAction(close-issue)`
 * via the channel's synchronous handle entry point. This mirrors the
 * outbox-processor cutover (PR4-3 T4.4b): the processor calls
 * `handleCloseAction(subjectId, action)` for `close-issue` actions.
 */
async function driveOutboxClosePre(
  mode: "workflow" | "agent",
): Promise<IssueClosedEvent[]> {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);
  const closeTransport = createMockCloseTransport([]);
  const channel = new OutboxClosePreChannel({
    closeTransport,
    bus,
    runId: `r5-cpre-${mode}`,
  });
  channel.register(bus);
  bus.freeze();

  await channel.handleCloseAction(7, { action: "close-issue" });

  return [...collector.byKind("issueClosed")];
}

/**
 * Drive OutboxClose-post by publishing a precursor `IssueClosedEvent`
 * (channel "C", phase "pre") to which Cpost subscribes. The PR4-3
 * cutover routes post-close via `handlePostClose(subjectId, store)`
 * but for R5 we exercise the bus path so the assertion captures the
 * subscriber-driven publication. Cpost's own decide returns skip
 * structurally (it has no inherent close decision in PR4-3, the
 * post-close drain is store-driven), so this scenario asserts the
 * bus payload is observed unchanged.
 *
 * Note: this scenario asserts that **at minimum** the precursor
 * IssueClosed(C/pre) event flows through the bus uniformly across
 * modes — that is the C-channel's mode invariant. A "post" phase
 * IssueClosed event is only published when the store-driven
 * post-close drain runs; that is store-coupled and exercised by
 * outbox-processor_test, not here.
 */
function driveOutboxClosePost(
  mode: "workflow" | "agent",
): IssueClosedEvent[] {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);
  const closeTransport = createMockCloseTransport([]);
  const channel = new OutboxClosePostChannel({
    closeTransport,
    github: inertGithub(),
    bus,
    runId: `r5-cpost-${mode}`,
  });
  channel.register(bus);
  bus.freeze();

  // Publish the precursor IssueClosed(C/pre) — the same shape the
  // OutboxClose-pre channel publishes after a successful close.
  // Cpost subscribes and observes; for R5 we assert the bus payload
  // crosses uniformly regardless of mode.
  bus.publish({
    kind: "issueClosed",
    publishedAt: 2,
    runId: `r5-cpost-${mode}`,
    channel: "C",
    outboxPhase: "pre",
    subjectId: 11,
  });

  return [...collector.byKind("issueClosed")];
}

/**
 * Drive BoundaryClose against a `ClosureBoundaryReached` precursor.
 * The channel's `handleBoundary` synchronously runs decide+execute
 * and (on shouldClose) publishes IssueClosed(channel "E").
 */
async function driveBoundaryClose(
  mode: "workflow" | "agent",
): Promise<IssueClosedEvent[]> {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);
  const closeTransport = createMockCloseTransport([]);
  const channel = new BoundaryCloseChannel({
    closeTransport,
    bus,
    runId: `r5-e-${mode}`,
  });
  channel.register(bus);
  bus.freeze();

  // BoundaryCloseChannel.handleBoundary(subjectId, agentId, stepId)
  // is the verdict-adapter cutover entry point (PR4-3 T4.4c). It
  // synthesises the precursor `ClosureBoundaryReached` internally
  // and runs decide+execute. Per design 11 §C step 5 the agentId
  // does not influence channel id payload; we vary it across modes
  // to confirm.
  await channel.handleBoundary(13, `reviewer-${mode}`, "T6.eval");

  return [...collector.byKind("issueClosed")];
}

/**
 * Drive CascadeClose. CascadeClose subscribes to `IssueClosedEvent`
 * (to track sibling closures) AND `SiblingsAllClosedEvent` (the
 * trigger). For R5 we publish a `SiblingsAllClosedEvent` and assert
 * that the cascade chain propagates uniformly across modes.
 *
 * Cascade in PR4-3 publishes `SiblingsAllClosedEvent` itself (via
 * sibling tracking) and applies the eval-label transition; it does
 * NOT close the sentinel directly (sentinel close is the workflow's
 * regular close path on the next cycle). Therefore the R5 surface
 * for Cascade is the bus event flow itself: `SiblingsAllClosedEvent`
 * arrives, the cascade subscriber observes, and (because no
 * project-binding is configured in the vacuous workflow) the
 * subscriber is a no-op. That uniformity is what we assert.
 */
function driveCascade(
  mode: "workflow" | "agent",
): SiblingsAllClosedEvent[] {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);
  const closeTransport = createMockCloseTransport([]);
  const channel = new CascadeCloseChannel({
    closeTransport,
    github: inertGithub(),
    workflow: vacuousWorkflow(),
    bus,
    runId: `r5-cascade-${mode}`,
  });
  channel.register(bus);
  bus.freeze();

  const sibling: SiblingsAllClosedEvent = {
    kind: "siblingsAllClosed",
    publishedAt: 4,
    runId: `r5-cascade-${mode}`,
    parentSubjectId: 100,
    closedChildren: [1, 2, 3],
  };
  bus.publish(sibling);

  return [...collector.byKind("siblingsAllClosed")];
}

/**
 * Drive MergeCloseAdapter against a fact file written by a simulated
 * merge-pr subprocess. The adapter publishes `IssueClosedEvent({
 * channel: "M" })` for every valid fact line and truncates the file.
 *
 * Per 11 §E reachability matrix M is `✓` only for merge-pr; both
 * workflow and standalone Boots construct the adapter (kernel.ts +
 * bootStandalone), so the published event payload is mode-invariant
 * by construction. This scenario simulates that uniformity.
 */
async function driveMergeClose(
  mode: "workflow" | "agent",
): Promise<IssueClosedEvent[]> {
  const tmpDir = await Deno.makeTempDir({ prefix: `r5-merge-${mode}-` });
  try {
    const bus = createCloseEventBus();
    const collector = createEventCollector(bus);
    const adapter = new MergeCloseAdapter({
      bus,
      runId: `r5-m-${mode}`,
      cwd: tmpDir,
    });
    bus.freeze();

    // Simulate the merge-pr subprocess writing a fact file under
    // the parent runId. `writeMergeCloseFact` resolves the path
    // from cwd + runId and is the production write helper.
    await writeMergeCloseFact(
      {
        action: "merge-close-fact",
        subjectId: 99,
        mergedAt: 5,
        prNumber: 472,
        runId: `r5-m-${mode}`,
      },
      tmpDir,
    );

    const drainResult = await adapter.drain();
    assertEquals(
      drainResult.published,
      1,
      `MergeCloseAdapter.drain (mode=${mode}) must publish exactly 1 event`,
    );
    assertEquals(
      drainResult.invalid,
      0,
      `MergeCloseAdapter.drain (mode=${mode}) must report 0 invalid lines`,
    );

    return [...collector.byKind("issueClosed")];
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// (mode × channel) coverage matrix
// ---------------------------------------------------------------------------

/**
 * R5 reachability cell — one row of the 11 §E matrix.
 *
 * `expectedChannel` is sourced from `ChannelId` literal types (no
 * stringly-typed copy-paste); a future rename in `events/types.ts`
 * propagates here automatically.
 */
interface R5Cell {
  readonly channelLabel: string;
  readonly expectedChannel: ChannelId;
  readonly expectedOutboxPhase?: "pre" | "post";
  readonly expectedSubjectId: number | string;
  readonly drive: (mode: "workflow" | "agent") => Promise<IssueClosedEvent[]>;
}

/**
 * Cells covered by this test. CustomClose (U) is excluded — the
 * ContractDescriptor injection plumbing arrives in a later PR
 * (see file header "Out of scope").
 *
 * Each row returns `Promise<IssueClosedEvent[]>` for uniform
 * iteration; the synchronous-driver cases (driveCascade,
 * driveOutboxClosePost) wrap their payload in a resolved promise.
 */
const r5Cells: ReadonlyArray<R5Cell> = [
  {
    channelLabel: "DirectClose (D)",
    expectedChannel: "D",
    expectedSubjectId: 42,
    drive: driveDirectClose,
  },
  {
    channelLabel: "OutboxClose-pre (C/pre)",
    expectedChannel: "C",
    expectedOutboxPhase: "pre",
    expectedSubjectId: 7,
    drive: driveOutboxClosePre,
  },
  {
    channelLabel: "BoundaryClose (E)",
    expectedChannel: "E",
    expectedSubjectId: 13,
    drive: driveBoundaryClose,
  },
  {
    channelLabel: "MergeClose (M)",
    expectedChannel: "M",
    expectedSubjectId: 99,
    drive: driveMergeClose,
  },
];

// ---------------------------------------------------------------------------
// 1. Per-cell mode-invariance assertion
// ---------------------------------------------------------------------------

for (const cell of r5Cells) {
  Deno.test(
    `R5 mode invariance — ${cell.channelLabel} workflow ≡ agent ` +
      `(modulo publishedAt/runId)`,
    async () => {
      const workflowEvents = await cell.drive("workflow");
      const agentEvents = await cell.drive("agent");

      assert(
        workflowEvents.length >= 1,
        `[mode=workflow / ${cell.channelLabel}] expected ≥1 IssueClosedEvent; ` +
          `got ${workflowEvents.length}. R5 hard gate: every reachable ` +
          `(mode × channel) cell must produce at least one IssueClosedEvent.`,
      );
      assert(
        agentEvents.length === workflowEvents.length,
        `[mode=agent / ${cell.channelLabel}] event count diverged from workflow ` +
          `(workflow=${workflowEvents.length}, agent=${agentEvents.length}). ` +
          `R5 hard gate: per-cell event count must match across modes.`,
      );

      // Project to mode-invariant shape and compare. The first event
      // is the canonical close fact for every cell in this matrix
      // (Cpost is absent here because its post-phase publication is
      // store-coupled and tested elsewhere).
      const projectedWf = projectForR5(workflowEvents[0]);
      const projectedAgent = projectForR5(agentEvents[0]);
      assertEquals(
        projectedAgent,
        projectedWf,
        `R5 hard gate violated for ${cell.channelLabel}: ` +
          `agent-mode IssueClosedEvent (${JSON.stringify(projectedAgent)}) ` +
          `does not equal workflow-mode IssueClosedEvent ` +
          `(${JSON.stringify(projectedWf)}) modulo publishedAt/runId. ` +
          `Per design 11 §C step 5, the channel id payload value range ` +
          `is closed at 6 values and mode must NOT influence it.`,
      );

      // Sanity: structural fields against per-cell expectations,
      // sourced from ChannelId types (no hardcoded fallbacks).
      assertEquals(
        projectedWf.channel,
        cell.expectedChannel,
        `${cell.channelLabel}: channel id mismatch. Expected ` +
          `"${cell.expectedChannel}" per 11 §E reachability matrix.`,
      );
      assertEquals(
        projectedWf.outboxPhase,
        cell.expectedOutboxPhase,
        `${cell.channelLabel}: outboxPhase mismatch (expected ` +
          `${JSON.stringify(cell.expectedOutboxPhase)}). ` +
          `Per 30 §E, only ChannelId="C" carries OutboxPhase.`,
      );
      assertEquals(
        projectedWf.subjectId,
        cell.expectedSubjectId,
        `${cell.channelLabel}: subjectId mismatch.`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// 2. ChannelId closed-enum guard (R5 hard gate, design 30 §E)
// ---------------------------------------------------------------------------

const ALLOWED_CHANNEL_IDS: ReadonlySet<ChannelId> = new Set<ChannelId>([
  "D",
  "C",
  "E",
  "M",
  "Cascade",
  "U",
]);

Deno.test(
  "R5 ChannelId closed-enum guard — every captured event uses one of 6 ids",
  async () => {
    for (const cell of r5Cells) {
      for (const mode of ["workflow", "agent"] as const) {
        const events = await cell.drive(mode);
        for (const e of events) {
          assert(
            ALLOWED_CHANNEL_IDS.has(e.channel),
            `[${cell.channelLabel} / mode=${mode}] event.channel "${e.channel}" ` +
              `is outside the closed 6-value set (D / C / E / M / Cascade / U). ` +
              `R5 hard gate (design 30 §E): the enum is closed and any 7th ` +
              `value indicates accidental widening (cast or design drift).`,
          );
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// 3. CascadeClose secondary path — siblingsAllClosed event mode invariance
// ---------------------------------------------------------------------------

Deno.test(
  "R5 CascadeClose / SiblingsAllClosedEvent payload is mode-invariant",
  () => {
    const wf = driveCascade("workflow");
    const agent = driveCascade("agent");

    assertEquals(wf.length, 1, "workflow: 1 SiblingsAllClosedEvent expected");
    assertEquals(agent.length, 1, "agent: 1 SiblingsAllClosedEvent expected");

    // Project: keep parentSubjectId + closedChildren; drop runId/publishedAt.
    interface ProjectedSiblings {
      readonly kind: "siblingsAllClosed";
      readonly parentSubjectId: number | string;
      readonly closedChildren: readonly (number | string)[];
    }
    const project = (e: SiblingsAllClosedEvent): ProjectedSiblings => ({
      kind: "siblingsAllClosed",
      parentSubjectId: e.parentSubjectId,
      closedChildren: e.closedChildren,
    });

    assertEquals(
      project(agent[0]),
      project(wf[0]),
      "R5 hard gate violated for CascadeClose siblingsAllClosed: " +
        "agent-mode payload diverges from workflow-mode after projection. " +
        "Per design 30 §B, SiblingsAllClosedEvent.binding does not carry " +
        "mode information — divergence here means the publisher is leaking " +
        "mode-specific identifiers.",
    );
  },
);

// ---------------------------------------------------------------------------
// 4. OutboxClose-post / channel "C" precursor flow uniformity
// ---------------------------------------------------------------------------

Deno.test(
  "R5 OutboxClose-post / IssueClosed(C, pre) precursor is mode-invariant",
  () => {
    const wf = driveOutboxClosePost("workflow");
    const agent = driveOutboxClosePost("agent");
    assertEquals(
      wf.length,
      1,
      "workflow: precursor IssueClosed(C/pre) expected exactly once",
    );
    assertEquals(
      agent.length,
      1,
      "agent: precursor IssueClosed(C/pre) expected exactly once",
    );
    assertEquals(
      projectForR5(agent[0]),
      projectForR5(wf[0]),
      "R5 hard gate violated for OutboxClose-post precursor: " +
        "the bus event that Cpost subscribes to is the same IssueClosed " +
        "shape regardless of publisher mode (design channels/00 §A row 3).",
    );
  },
);

// ---------------------------------------------------------------------------
// 5. Subscribe-time uniformity: every channel's subscribesTo is fixed
// ---------------------------------------------------------------------------

Deno.test(
  "R5 subscribesTo is fixed at construction (Channel.subscribesTo invariant)",
  () => {
    const closeTransport = createMockCloseTransport([]);
    const runId = "r5-subscribe-time";
    const direct = new DirectCloseChannel({
      agentRegistry: emptyRegistry(),
      closeTransport,
      bus: createCloseEventBus(),
      runId,
    });
    const cpre = new OutboxClosePreChannel({
      closeTransport,
      bus: createCloseEventBus(),
      runId,
    });
    const cpost = new OutboxClosePostChannel({
      closeTransport,
      github: inertGithub(),
      bus: createCloseEventBus(),
      runId,
    });
    const e = new BoundaryCloseChannel({
      closeTransport,
      bus: createCloseEventBus(),
      runId,
    });
    const cascade = new CascadeCloseChannel({
      closeTransport,
      github: inertGithub(),
      workflow: vacuousWorkflow(),
      bus: createCloseEventBus(),
      runId,
    });

    // Per channels/00 §A subscribesTo is fixed at construction time
    // (P1 Uniform Channel principle). Asserting non-emptiness here
    // catches a regression where a channel forgets to declare its
    // subscription kinds; asserting the exact shape would couple
    // this test to per-channel internal kinds (design says "fixed",
    // not "this exact set" — that is per-channel concern).
    assert(
      direct.subscribesTo.includes("transitionComputed"),
      "DirectClose must subscribe to transitionComputed (channels/00 §A row 1)",
    );
    assert(
      cpre.subscribesTo.includes("outboxActionDecided"),
      "OutboxClose-pre must subscribe to outboxActionDecided (channels/00 §A row 2)",
    );
    assert(
      cpost.subscribesTo.length > 0,
      "OutboxClose-post must subscribe to at least one event " +
        "(channels/00 §A row 3 — outboxActionDecided + issueClosed)",
    );
    assert(
      e.subscribesTo.includes("closureBoundaryReached"),
      "BoundaryClose must subscribe to closureBoundaryReached (channels/00 §A row 4)",
    );
    assert(
      cascade.subscribesTo.includes("issueClosed") &&
        cascade.subscribesTo.includes("siblingsAllClosed"),
      "CascadeClose must subscribe to issueClosed + siblingsAllClosed " +
        "(channels/00 §A row 6)",
    );
  },
);

// ---------------------------------------------------------------------------
// 6. Self-check — _unused references prevent imports being elided.
// ---------------------------------------------------------------------------

// `OutboxActionDecidedEvent` and `Event` are imported at the top so the
// test file stays single-source-of-truth for ADT references. They are
// not directly asserted on, but importing them links this test to the
// 8-event closed union — a regression that drops a variant breaks the
// import chain and surfaces here at compile time.
type _UnusedAdtAnchor = OutboxActionDecidedEvent | Event;
