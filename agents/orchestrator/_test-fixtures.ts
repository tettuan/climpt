/**
 * Internal test fixtures for orchestrator unit tests.
 *
 * Single source of truth for the default {@link IssueSource} variant
 * embedded in `WorkflowConfig` literals across the orchestrator test
 * suite. Every test that synthesises a `WorkflowConfig` must spread or
 * include this constant to satisfy the (now required) `issueSource`
 * field — see realistic-design phase 1 ToDo T1.1 in
 * `agents/docs/design/realistic/12-workflow-config.md` §C.
 *
 * Tests that deliberately exercise a specific variant (e.g.
 * `kind: "ghProject"`) override this default with a literal of their
 * own. Production code MUST NOT import from this module — it is an
 * internal test helper, deliberately not exported via `mod.ts`.
 */

import type { IssueSource, WorkflowConfig } from "./workflow-types.ts";
import type { AgentBundle } from "../src_common/types/agent-bundle.ts";
import type { AgentRegistry, BootArtifacts } from "../boot/types.ts";
import type { Policy, TransportPolicy } from "../boot/policy.ts";
import { createAgentRegistry } from "../boot/registry.ts";
import { createCloseEventBus } from "../events/bus.ts";
import type { GitHubClient } from "./github-client.ts";
import {
  type CloseTransport,
  createMockCloseTransport,
  createRealCloseTransport,
} from "../transports/close-transport.ts";
import { BoundaryCloseChannel } from "../channels/boundary-close.ts";
import { CascadeCloseChannel } from "../channels/cascade-close.ts";
import { CompensationCommentChannel } from "../channels/compensation-comment.ts";
import { DirectCloseChannel } from "../channels/direct-close.ts";
import { MergeCloseAdapter } from "../channels/merge-close-adapter.ts";
import { OutboxClosePostChannel } from "../channels/outbox-close-post.ts";
import { OutboxClosePreChannel } from "../channels/outbox-close-pre.ts";
import { FileGitHubClient } from "./file-github-client.ts";
import { Orchestrator } from "./orchestrator.ts";
import { SubjectStore } from "./subject-store.ts";

/**
 * Default `IssueSource` used in `WorkflowConfig` test literals.
 *
 * Mirrors the legacy "no CLI args" behavior in `run-workflow.ts`:
 * `ghRepoIssues` with `projectMembership: "unbound"` (the global queue
 * complement of any project-scoped run).
 */
export const TEST_DEFAULT_ISSUE_SOURCE: IssueSource = {
  kind: "ghRepoIssues",
  projectMembership: "unbound",
};

/**
 * Build a frozen {@link AgentRegistry} from a list of {@link AgentBundle}s.
 *
 * Test helper used by orchestrator / dispatcher integration tests that
 * construct an {@link Orchestrator} or {@link RunnerDispatcher} with
 * BootArtifacts but don't want to drive the full `BootKernel.boot`
 * pipeline (no disk reads, no `gh` discovery, no policy load).
 *
 * Throws when `createAgentRegistry` rejects (duplicate ids — Boot rule
 * A1) so test setup failures are visible. The thrown message includes
 * every offending id so the cause is obvious without a debugger.
 */
export function buildTestAgentRegistry(
  bundles: readonly AgentBundle[],
): AgentRegistry {
  const decision = createAgentRegistry(bundles);
  if (decision.kind === "reject") {
    const summary = decision.errors.map((e) => `${e.code}: ${e.message}`)
      .join("\n  ");
    throw new Error(`buildTestAgentRegistry: ${summary}`);
  }
  return decision.value;
}

/**
 * Default {@link Policy} for test {@link BootArtifacts}.
 *
 * Mirrors `loadPolicy(_, undefined)` defaults. Tests that need a non-default
 * shape (e.g. `transports.close === "file"` for a sandboxed dry-run) override
 * via {@link buildTestBootArtifacts} `policy` option.
 */
export const TEST_DEFAULT_POLICY: Policy = {
  storeWired: true,
  ghBinary: "gh",
  applyToSubprocess: true,
  transports: { issueQuery: "real", close: "real" },
};

/**
 * Build a synthetic {@link BootArtifacts} for orchestrator / dispatcher
 * integration tests that need the frozen artifact shape but cannot drive
 * the full `BootKernel.boot` pipeline (no disk reads, no `gh` discovery,
 * no policy load).
 *
 * The returned artifact is **not** deepFrozen — production deepFreeze
 * happens inside `BootKernel.boot` and the synthetic artifact must remain
 * mutable for tests that pre-seed `schemas` or extend `agentRegistry`.
 * Tests that need the freeze invariant should call `BootKernel.boot`
 * directly against a real fixture workspace (see `kernel_test.ts`).
 *
 * Boot rule A1 is enforced by the underlying `buildTestAgentRegistry`
 * (duplicate ids throw at construction). The other 25 rules are NOT run —
 * tests must construct internally consistent fixtures or call
 * `validateBootArtifacts` explicitly when rule coverage is part of the
 * test contract.
 *
 * @param opts.workflow Required `WorkflowConfig`. Tests typically synthesize
 *   one via the file's `createValidWorkflowJson()` helpers.
 * @param opts.bundles  AgentBundle list (defaults to empty — tests that
 *   only exercise workflow / dispatcher routing don't need bundles).
 * @param opts.policy   Override the {@link TEST_DEFAULT_POLICY} (e.g. for
 *   sandboxed transport pairs).
 * @param opts.schemas  Pre-seed the schema map; defaults to an empty Map.
 * @param opts.bootedAt Override the boot timestamp (deterministic for
 *   golden-output tests).
 */
export function buildTestBootArtifacts(opts: {
  readonly workflow: WorkflowConfig;
  readonly bundles?: readonly AgentBundle[];
  readonly policy?: Policy;
  readonly schemas?: ReadonlyMap<string, unknown>;
  readonly bootedAt?: number;
  /**
   * Override the synthetic `runId`. Defaults to a fixed string so
   * golden-output tests don't see a fresh UUID per run.
   */
  readonly runId?: string;
  /**
   * Override the synthetic `githubClient`. Defaults to a
   * {@link FileGitHubClient} backed by an in-memory `SubjectStore` —
   * the seam exists but every operation throws when the store is empty,
   * which is the right behaviour for tests that don't drive GitHub I/O.
   * Tests that need a recording stub or a different impl pass it here.
   */
  readonly githubClient?: GitHubClient;
  /**
   * Override the synthetic `closeTransport`. Defaults to
   * {@link createMockCloseTransport}([]) so tests can assert that the
   * production code under test does NOT issue a close (PR4-2a is
   * plumbing-only — channels still skip).
   */
  readonly closeTransport?: CloseTransport;
}): BootArtifacts {
  const bundles = opts.bundles ?? [];
  const runId = opts.runId ?? "test-run-id";
  // Synthetic githubClient — `FileGitHubClient` over an in-memory
  // SubjectStore. Tests that exercise the seam shape (existence,
  // typing, plumbing) get a usable reference; tests that drive
  // close/comment ops should override via `opts.githubClient`.
  const githubClient: GitHubClient = opts.githubClient ??
    new FileGitHubClient(new SubjectStore("/dev/null/test-fixture"));
  // Default closeTransport records to a discarded array — tests that
  // need to assert close requests must pass their own
  // `createMockCloseTransport(arr)` so they own the array reference.
  const closeTransport: CloseTransport = opts.closeTransport ??
    createMockCloseTransport([]);
  const agentRegistry = buildTestAgentRegistry(bundles);
  // Synthetic bus: register DirectClose + CompensationComment subscribers
  // before freezing so the test fixture matches the production shape
  // (sealed subscriber set after Boot). Diagnostic JSONL writer is NOT
  // registered — tests must not touch the filesystem implicitly.
  const bus = createCloseEventBus();
  const directClose = new DirectCloseChannel({
    agentRegistry,
    closeTransport,
    bus,
    runId,
  });
  directClose.register(bus);
  const outboxClosePre = new OutboxClosePreChannel({
    closeTransport,
    bus,
    runId,
  });
  outboxClosePre.register(bus);
  const outboxClosePost = new OutboxClosePostChannel({
    closeTransport,
    github: githubClient,
    bus,
    runId,
  });
  outboxClosePost.register(bus);
  const boundaryClose = new BoundaryCloseChannel({
    closeTransport,
    bus,
    runId,
  });
  boundaryClose.register(bus);
  const cascadeClose = new CascadeCloseChannel({
    closeTransport,
    github: githubClient,
    workflow: opts.workflow,
    bus,
    runId,
  });
  cascadeClose.register(bus);
  const compensationComment = new CompensationCommentChannel({
    github: githubClient,
    runId,
  });
  compensationComment.register(bus);
  bus.freeze();
  // PR4-4 T4.5: synthetic MergeCloseAdapter wired against an
  // unreachable fact path. Tests that drive merge-close-fact IPC pass
  // their own adapter; tests that don't care get a no-op drain target.
  const mergeCloseAdapter = new MergeCloseAdapter({
    bus,
    runId,
    cwd: "/dev/null/test-fixture",
  });
  return {
    workflow: opts.workflow,
    agentRegistry,
    schemas: opts.schemas ?? new Map<string, unknown>(),
    policy: opts.policy ?? TEST_DEFAULT_POLICY,
    bus,
    runId,
    bootedAt: opts.bootedAt ?? Date.now(),
    githubClient,
    closeTransport,
    directClose,
    outboxClosePre,
    outboxClosePost,
    boundaryClose,
    mergeCloseAdapter,
  };
}

/**
 * Test helper — construct a `DirectCloseChannel` wired against an
 * unfrozen bus and a `real` close transport that delegates to the
 * supplied `GitHubClient.closeIssue`.
 *
 * Use this when an orchestrator-level test needs a working close path
 * but does not want to drive the full `BootKernel.boot` pipeline. The
 * returned channel publishes `IssueClosedEvent` / `IssueCloseFailedEvent`
 * on the supplied bus, so test collectors should be installed before
 * calling.
 *
 * The bus is NOT frozen by this helper — the caller decides when to
 * seal subscribers (typical pattern: subscribe collectors → call
 * helper → use channel). Tests that need to exercise post-freeze
 * invariants call `bus.freeze()` after.
 */
export function buildTestDirectClose(opts: {
  readonly bus: import("../events/bus.ts").CloseEventBus;
  readonly github: GitHubClient;
  readonly agentRegistry?: AgentRegistry;
  readonly runId?: string;
  /**
   * Frozen workflow used by `CascadeCloseChannel`. When a test exercises
   * the sentinel-cascade path (e.g. emission_test.ts T6.eval), pass the
   * same `WorkflowConfig` the test orchestrator runs against so the
   * channel's `projectBinding` lookup matches. Defaults to a vacuous
   * workflow with no `projectBinding` so cascade evaluation is a
   * no-op for tests that don't care.
   */
  readonly workflow?: WorkflowConfig;
}): {
  readonly directClose: DirectCloseChannel;
  readonly outboxClosePre: OutboxClosePreChannel;
  readonly outboxClosePost: OutboxClosePostChannel;
  readonly boundaryClose: BoundaryCloseChannel;
  readonly cascadeClose: CascadeCloseChannel;
  readonly compensationComment: CompensationCommentChannel;
} {
  const runId = opts.runId ?? "test-run-id";
  const closeTransport = createRealCloseTransport(opts.github);
  const agentRegistry = opts.agentRegistry ?? buildTestAgentRegistry([]);
  const workflow: WorkflowConfig = opts.workflow ?? {
    version: "1.0.0",
    issueSource: TEST_DEFAULT_ISSUE_SOURCE,
    phases: {},
    labelMapping: {},
    agents: {},
    invocations: [],
    rules: { maxCycles: 1, cycleDelayMs: 0 },
  };
  const directClose = new DirectCloseChannel({
    agentRegistry,
    closeTransport,
    bus: opts.bus,
    runId,
  });
  directClose.register(opts.bus);
  const outboxClosePre = new OutboxClosePreChannel({
    closeTransport,
    bus: opts.bus,
    runId,
  });
  outboxClosePre.register(opts.bus);
  const outboxClosePost = new OutboxClosePostChannel({
    closeTransport,
    github: opts.github,
    bus: opts.bus,
    runId,
  });
  outboxClosePost.register(opts.bus);
  const boundaryClose = new BoundaryCloseChannel({
    closeTransport,
    bus: opts.bus,
    runId,
  });
  boundaryClose.register(opts.bus);
  const cascadeClose = new CascadeCloseChannel({
    closeTransport,
    github: opts.github,
    workflow,
    bus: opts.bus,
    runId,
  });
  cascadeClose.register(opts.bus);
  const compensationComment = new CompensationCommentChannel({
    github: opts.github,
    runId,
  });
  compensationComment.register(opts.bus);
  return {
    directClose,
    outboxClosePre,
    outboxClosePost,
    boundaryClose,
    cascadeClose,
    compensationComment,
  };
}

// `TransportPolicy` is re-exported as a type so call sites that override
// the policy can type their override without importing from `boot/policy.ts`.
export type { Policy, TransportPolicy };

/**
 * Construct an `Orchestrator` together with a wired DirectClose channel
 * + bus + CompensationCommentChannel.
 *
 * Test helper for the closeBinding contract — orchestrator unit
 * tests want to drive the close path without booting the full kernel.
 * Returns the orchestrator and the captured bus/channel handles so the
 * test can install collectors before running.
 *
 * The bus is frozen by this helper before the orchestrator is
 * constructed (production parity: subscribers register pre-freeze).
 * Tests that need to subscribe additional collectors should attach a
 * collector against the returned bus *before* the first publish — but
 * since `createCloseEventBus` allows pre-freeze subscribe and the bus
 * here is already sealed, tests that need a collector should call
 * `buildOrchestratorWithChannels` with an explicit `setup` callback
 * (see overload below).
 */
export function buildOrchestratorWithChannels(opts: {
  readonly config: WorkflowConfig;
  readonly github: GitHubClient;
  readonly dispatcher: import("./dispatcher.ts").AgentDispatcher;
  readonly cwd?: string;
  readonly artifactEmitter?: import("./artifact-emitter.ts").ArtifactEmitter;
  readonly agentRegistry?: AgentRegistry;
  readonly runId?: string;
  /**
   * Optional callback invoked with the (unfrozen) bus before the
   * channels register and the bus freezes. Use this to install test
   * collectors that observe channel-emitted events.
   */
  readonly subscribe?: (
    bus: import("../events/bus.ts").CloseEventBus,
  ) => void;
}): {
  readonly orchestrator: import("./orchestrator.ts").Orchestrator;
  readonly bus: import("../events/bus.ts").CloseEventBus;
  readonly directClose: DirectCloseChannel;
} {
  const runId = opts.runId ?? "test-run-id";
  const bus = createCloseEventBus();
  if (opts.subscribe !== undefined) opts.subscribe(bus);
  const closeTransport = createRealCloseTransport(opts.github);
  const agentRegistry = opts.agentRegistry ?? buildTestAgentRegistry([]);
  const directClose = new DirectCloseChannel({
    agentRegistry,
    closeTransport,
    bus,
    runId,
  });
  directClose.register(bus);
  const outboxClosePre = new OutboxClosePreChannel({
    closeTransport,
    bus,
    runId,
  });
  outboxClosePre.register(bus);
  const outboxClosePost = new OutboxClosePostChannel({
    closeTransport,
    github: opts.github,
    bus,
    runId,
  });
  outboxClosePost.register(bus);
  const boundaryClose = new BoundaryCloseChannel({
    closeTransport,
    bus,
    runId,
  });
  boundaryClose.register(bus);
  const cascadeClose = new CascadeCloseChannel({
    closeTransport,
    github: opts.github,
    workflow: opts.config,
    bus,
    runId,
  });
  cascadeClose.register(bus);
  const compensationComment = new CompensationCommentChannel({
    github: opts.github,
    runId,
  });
  compensationComment.register(bus);
  bus.freeze();
  const orchestrator = new Orchestrator(
    opts.config,
    opts.github,
    opts.dispatcher,
    opts.cwd,
    opts.artifactEmitter,
    agentRegistry,
    bus,
    runId,
    directClose,
    outboxClosePre,
    outboxClosePost,
  );
  return { orchestrator, bus, directClose };
}
