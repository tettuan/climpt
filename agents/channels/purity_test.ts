/**
 * `Channel.decide` purity contract tests (T4.1b, Critique F5).
 *
 * Source of truth:
 *  - `types.ts` `Channel.decide` JSDoc: "PURE function: snapshotted ctx
 *    → deterministic ChannelDecision".
 *  - `channels/00-realistic-binding.md` §C: "Channel.decide が pure
 *    function (副作用禁止、To-Be P1) として定義されているため、mode /
 *    WorkflowConfig / AgentBundle のいずれが変わっても同 ctx で同
 *    Decision が返る (referential transparency)".
 *
 * What "purity" means here, mechanically:
 *  1. Same `ChannelContext` ⇒ same `ChannelDecision` (deep equality).
 *     Repeated calls with the same input must produce equal output.
 *  2. `ChannelContext` constructed via `createChannelContext` is
 *     `Object.isFrozen` true. Attempting to mutate a frozen object via
 *     property assignment throws in strict mode (Deno modules are strict
 *     by default), so the test asserts both `isFrozen` and that a
 *     mutation attempt throws.
 *  3. The skeleton `decide` returns `{ kind: "skip", reason: ... }` for
 *     each of the 6 fixed channels + Custom in P4-1. The deterministic
 *     property is what guards future PR4-2/3/4 from accidentally
 *     introducing live-state reads.
 *
 * @see agents/channels/types.ts (Channel + ChannelContext)
 * @see tmp/realistic-migration/critique.md F5 (decide purity)
 */

import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "jsr:@std/assert@1";

import { BoundaryCloseChannel } from "./boundary-close.ts";
import { CascadeCloseChannel } from "./cascade-close.ts";
import { CustomCloseChannel } from "./custom-close.ts";
import { DirectCloseChannel } from "./direct-close.ts";
import { MergeCloseChannel } from "./merge-close.ts";
import { OutboxClosePostChannel } from "./outbox-close-post.ts";
import { OutboxClosePreChannel } from "./outbox-close-pre.ts";
import {
  type Channel,
  type ChannelContext,
  type ChannelDecision,
  createChannelContext,
} from "./types.ts";

import type {
  ClosureBoundaryReachedEvent,
  Event,
  IssueClosedEvent,
  OutboxActionDecidedEvent,
  SiblingsAllClosedEvent,
  TransitionComputedEvent,
} from "../events/types.ts";
import { createAgentRegistry } from "../boot/registry.ts";
import { createCloseEventBus } from "../events/bus.ts";
import { isAccept } from "../shared/validation/mod.ts";
import type { AgentRegistry } from "../boot/types.ts";
import type { CloseBinding } from "../src_common/types/agent-bundle.ts";
import {
  type CloseTransport,
  createMockCloseTransport,
} from "../transports/close-transport.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A trivial empty registry — channels read it only at decide-time in PR4-2+. */
const emptyRegistry = (): AgentRegistry => {
  const decision = createAgentRegistry([]);
  // `createAgentRegistry([])` always succeeds (no duplicates possible).
  // Narrow with a defensive assertion so this helper's return type stays
  // `AgentRegistry` rather than `Decision<AgentRegistry>`.
  if (!isAccept(decision)) {
    throw new Error("unreachable: empty registry must be Accept");
  }
  return decision.value;
};

/**
 * Mock close transport for purity tests. The decide path is pure so it
 * never invokes the transport; we still pass a real reference because
 * the constructor surface (PR4-2a) requires `closeTransport`.
 */
const stubTransport = (): CloseTransport => createMockCloseTransport([]);

/**
 * Stub bus for purity tests. `decide` does not publish (pure function);
 * the constructor surface (PR4-2b — DirectClose holds bus/runId for
 * `execute`) requires the field even when unused. The bus is left
 * unfrozen because purity tests don't drive subscribe/publish flows.
 */
const stubBus = (): import("../events/bus.ts").CloseEventBus =>
  createCloseEventBus();

/**
 * Stub GitHubClient for purity tests. `decide` is pure so the channel
 * never invokes the client at decide-time; the PR4-3 constructor
 * surface (OutboxClose-post + Cascade) requires the field even when
 * unused. Every method throws so an accidental decide-time read
 * surfaces in tests.
 */
const stubGithub =
  (): import("../orchestrator/github-client.ts").GitHubClient =>
    ({
      closeIssue: () => Promise.reject(new Error("purity stub: closeIssue")),
      addIssueComment: () =>
        Promise.reject(new Error("purity stub: addIssueComment")),
      createIssue: () => Promise.reject(new Error("purity stub: createIssue")),
      updateIssueLabels: () =>
        Promise.reject(new Error("purity stub: updateIssueLabels")),
      getIssueLabels: () =>
        Promise.reject(new Error("purity stub: getIssueLabels")),
      getRecentComments: () =>
        Promise.reject(new Error("purity stub: getRecentComments")),
      getIssueDetail: () =>
        Promise.reject(new Error("purity stub: getIssueDetail")),
      listIssues: () => Promise.reject(new Error("purity stub: listIssues")),
      reopenIssue: () => Promise.reject(new Error("purity stub: reopenIssue")),
      listLabels: () => Promise.reject(new Error("purity stub: listLabels")),
      listLabelsDetailed: () =>
        Promise.reject(new Error("purity stub: listLabelsDetailed")),
      createLabel: () => Promise.reject(new Error("purity stub: createLabel")),
      updateLabel: () => Promise.reject(new Error("purity stub: updateLabel")),
      addIssueToProject: () =>
        Promise.reject(new Error("purity stub: addIssueToProject")),
      updateProjectItemField: () =>
        Promise.reject(new Error("purity stub: updateProjectItemField")),
      closeProject: () =>
        Promise.reject(new Error("purity stub: closeProject")),
      getProjectItemIdForIssue: () =>
        Promise.reject(new Error("purity stub: getProjectItemIdForIssue")),
      listProjectItems: () =>
        Promise.reject(new Error("purity stub: listProjectItems")),
      createProjectFieldOption: () =>
        Promise.reject(new Error("purity stub: createProjectFieldOption")),
      getIssueProjects: () =>
        Promise.reject(new Error("purity stub: getIssueProjects")),
      listUserProjects: () =>
        Promise.reject(new Error("purity stub: listUserProjects")),
      getProject: () => Promise.reject(new Error("purity stub: getProject")),
      getProjectFields: () =>
        Promise.reject(new Error("purity stub: getProjectFields")),
      removeProjectItem: () =>
        Promise.reject(new Error("purity stub: removeProjectItem")),
    }) as unknown as import("../orchestrator/github-client.ts").GitHubClient;

/**
 * Stub WorkflowConfig for purity tests. CascadeClose's constructor
 * captures it; `decide` does not consult it (purity invariant).
 */
const stubWorkflow =
  (): import("../orchestrator/workflow-types.ts").WorkflowConfig => ({
    version: "1.0.0",
    issueSource: { kind: "ghRepoIssues", projectMembership: "unbound" },
    phases: {},
    labelMapping: {},
    agents: {},
    invocations: [],
    rules: { maxCycles: 1, cycleDelayMs: 0 },
  });

const RUN_ID = "purity-test-run";

const transitionComputed = (): TransitionComputedEvent => ({
  kind: "transitionComputed",
  publishedAt: 1,
  runId: RUN_ID,
  fromPhase: "ready",
  toPhase: "done",
  outcome: "success",
});

const outboxActionDecidedPre = (): OutboxActionDecidedEvent => ({
  kind: "outboxActionDecided",
  publishedAt: 2,
  runId: RUN_ID,
  outboxPhase: "pre",
  action: { action: "comment", body: "preflight" },
});

const outboxActionDecidedPost = (): OutboxActionDecidedEvent => ({
  kind: "outboxActionDecided",
  publishedAt: 3,
  runId: RUN_ID,
  outboxPhase: "post",
  action: { action: "comment", body: "postflight" },
});

const issueClosed = (): IssueClosedEvent => ({
  kind: "issueClosed",
  publishedAt: 4,
  runId: RUN_ID,
  channel: "D",
  subjectId: 42,
});

const closureBoundaryReached = (): ClosureBoundaryReachedEvent => ({
  kind: "closureBoundaryReached",
  publishedAt: 5,
  runId: RUN_ID,
  agentId: "iterator",
  stepId: "closure-step-1",
});

const siblingsAllClosed = (): SiblingsAllClosedEvent => ({
  kind: "siblingsAllClosed",
  publishedAt: 6,
  runId: RUN_ID,
  parentSubjectId: 100,
  closedChildren: [1, 2, 3],
});

const directBinding: CloseBinding = {
  primary: { kind: "direct" },
  cascade: false,
};

// ---------------------------------------------------------------------------
// 1. ChannelContext is frozen at construction time
// ---------------------------------------------------------------------------

Deno.test(
  "createChannelContext freezes the wrapper (Object.isFrozen)",
  () => {
    const ctx = createChannelContext({
      event: transitionComputed(),
      closeBinding: directBinding,
    });
    assert(
      Object.isFrozen(ctx),
      "ChannelContext returned by createChannelContext must be frozen",
    );
  },
);

Deno.test(
  "createChannelContext: assigning a new field throws in strict mode",
  () => {
    const ctx = createChannelContext({
      event: transitionComputed(),
      closeBinding: directBinding,
    });
    assertThrows(
      () => {
        // deno-lint-ignore no-explicit-any
        (ctx as any).injected = "hostile";
      },
      TypeError,
      undefined,
      "Mutating a frozen ChannelContext must throw in strict mode " +
        "(modules are strict by default)",
    );
  },
);

Deno.test(
  "createChannelContext: overwriting an existing field throws in strict mode",
  () => {
    const ctx = createChannelContext({
      event: transitionComputed(),
      closeBinding: directBinding,
      outcomeMatch: true,
    });
    assertThrows(
      () => {
        // deno-lint-ignore no-explicit-any
        (ctx as any).outcomeMatch = false;
      },
      TypeError,
    );
  },
);

// ---------------------------------------------------------------------------
// 2. Channel.decide is deterministic for every channel
// ---------------------------------------------------------------------------

/**
 * One row of the channel × representative context coverage matrix.
 * Each row asserts: `decide(ctx)` called twice ⇒ deep-equal results
 * AND the result is `{ kind: "skip" }` (the P4-1 skeleton invariant).
 */
type DetCase = {
  readonly name: string;
  readonly buildChannel: () => Channel;
  readonly buildCtx: () => ChannelContext;
};

const detCases: readonly DetCase[] = [
  {
    name: "DirectClose / TransitionComputed",
    buildChannel: () =>
      new DirectCloseChannel({
        agentRegistry: emptyRegistry(),
        closeTransport: stubTransport(),
        bus: stubBus(),
        runId: "purity-test-run",
      }),
    buildCtx: () =>
      createChannelContext({
        event: transitionComputed(),
        closeBinding: directBinding,
      }),
  },
  {
    name: "OutboxClose-pre / OutboxActionDecided(pre)",
    buildChannel: () =>
      new OutboxClosePreChannel({
        closeTransport: stubTransport(),
        bus: stubBus(),
        runId: RUN_ID,
      }),
    buildCtx: () =>
      createChannelContext({
        event: outboxActionDecidedPre(),
        closeBinding: { primary: { kind: "outboxPre" }, cascade: false },
      }),
  },
  {
    name: "OutboxClose-post / OutboxActionDecided(post)",
    buildChannel: () =>
      new OutboxClosePostChannel({
        closeTransport: stubTransport(),
        github: stubGithub(),
        bus: stubBus(),
        runId: RUN_ID,
      }),
    buildCtx: () =>
      createChannelContext({
        event: outboxActionDecidedPost(),
        closeBinding: { primary: { kind: "none" }, cascade: false },
      }),
  },
  {
    name: "OutboxClose-post / IssueClosed",
    buildChannel: () =>
      new OutboxClosePostChannel({
        closeTransport: stubTransport(),
        github: stubGithub(),
        bus: stubBus(),
        runId: RUN_ID,
      }),
    buildCtx: () =>
      createChannelContext({
        event: issueClosed(),
        closeBinding: { primary: { kind: "none" }, cascade: false },
      }),
  },
  {
    name: "BoundaryClose / ClosureBoundaryReached",
    buildChannel: () =>
      new BoundaryCloseChannel({
        closeTransport: stubTransport(),
        bus: stubBus(),
        runId: RUN_ID,
      }),
    buildCtx: () =>
      createChannelContext({
        event: closureBoundaryReached(),
        closeBinding: { primary: { kind: "boundary" }, cascade: false },
      }),
  },
  {
    name: "MergeClose / IssueClosed (publish-only channel)",
    buildChannel: () =>
      new MergeCloseChannel({
        agentRegistry: emptyRegistry(),
        closeTransport: stubTransport(),
      }),
    buildCtx: () =>
      createChannelContext<Event>({
        event: issueClosed(),
        closeBinding: { primary: { kind: "none" }, cascade: false },
      }),
  },
  {
    name: "CascadeClose / SiblingsAllClosed",
    buildChannel: () =>
      new CascadeCloseChannel({
        closeTransport: stubTransport(),
        github: stubGithub(),
        workflow: stubWorkflow(),
        bus: stubBus(),
        runId: RUN_ID,
      }),
    buildCtx: () =>
      createChannelContext({
        event: siblingsAllClosed(),
        closeBinding: { primary: { kind: "none" }, cascade: true },
        siblingsAllResolved: true,
      }),
  },
  {
    name: "CustomClose / ClosureBoundaryReached",
    buildChannel: () =>
      new CustomCloseChannel({
        agentRegistry: emptyRegistry(),
        closeTransport: stubTransport(),
      }),
    buildCtx: () =>
      createChannelContext({
        event: closureBoundaryReached(),
        closeBinding: {
          primary: {
            kind: "custom",
            channel: { channelId: "user-channel-1" },
          },
          cascade: false,
        },
      }),
  },
];

for (const tc of detCases) {
  Deno.test(
    `Channel.decide is deterministic — ${tc.name}`,
    () => {
      const channel = tc.buildChannel();
      const ctx = tc.buildCtx();

      // deno-lint-ignore no-explicit-any
      const first: ChannelDecision = (channel.decide as any)(ctx);
      // deno-lint-ignore no-explicit-any
      const second: ChannelDecision = (channel.decide as any)(ctx);

      assertEquals(
        first,
        second,
        `decide(ctx) must return deep-equal decisions on repeated invocation ` +
          `(channel: ${tc.name})`,
      );
    },
  );

  Deno.test(
    `Channel.decide returns skip in P4-1 skeleton — ${tc.name}`,
    () => {
      const channel = tc.buildChannel();
      const ctx = tc.buildCtx();
      // deno-lint-ignore no-explicit-any
      const decision: ChannelDecision = (channel.decide as any)(ctx);
      assertStrictEquals(
        decision.kind,
        "skip",
        `P4-1 skeleton must skip until decide logic lands ` +
          `(channel: ${tc.name})`,
      );
    },
  );
}
