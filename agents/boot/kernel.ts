/**
 * BootKernel — load + validate + freeze the 5 Layer-4 inputs once.
 *
 * Per design 10 §B / §E:
 *  - All 3 invocation modes (`run-workflow`, `run-agent`, `merge-pr`)
 *    share this same Boot path. Boot is the single point at which
 *    Layer 4 is materialised; Run code never re-loads.
 *  - On success, the artifact is deep-frozen so Run-time mutation is
 *    impossible (Layer 4 Run-immutable, design 20 §E).
 *  - On failure, Boot returns `Decision = Reject(ValidationError[])`.
 *    The `BootValidationFailed` exception is thrown only at the entry
 *    point (run-workflow.ts / run-agent.ts), not inside the kernel,
 *    so the kernel stays composable and testable.
 *
 * Phase 2 scope (T2.1):
 *  - Wires the existing loaders (`loadWorkflow`, `loadAgentBundle`,
 *    `loadPolicy`) into a single `boot(opts)`.
 *  - Enforces A1 (AgentBundle id uniqueness) via
 *    {@link createAgentRegistry}; the rest of the 26 boot rules land in
 *    T2.2.
 *  - Schemas map is initialised empty — eager SO schema loading is
 *    T2.2's job.
 *  - Does not modify entry points (run-workflow/run-agent/merge-pr) —
 *    that is T2.4.
 *
 * Design refs:
 *  - `agents/docs/design/realistic/10-system-overview.md` §B (Boot inputs)
 *  - `agents/docs/design/realistic/10-system-overview.md` §E (3 modes share Boot)
 *  - `agents/docs/design/realistic/20-state-hierarchy.md`  §B / §E (Layer 4 frozen)
 *  - `tmp/realistic-migration/phased-plan.md` §P2 (T2.1)
 *
 * @module
 */

import { loadWorkflow } from "../orchestrator/workflow-loader.ts";
import { loadAgentBundle } from "../config/agent-bundle-loader.ts";
import type { AgentBundle } from "../src_common/types/agent-bundle.ts";
import {
  deriveInvocations,
  type WorkflowConfig,
} from "../orchestrator/workflow-types.ts";
import {
  accept,
  combineDecisions,
  type Decision,
  isReject,
  reject,
  validationError,
} from "../shared/validation/mod.ts";

import { createCloseEventBus } from "../events/bus.ts";
import { registerDiagnosticSubscriber } from "../events/diagnostic-subscriber.ts";
import { BoundaryCloseChannel } from "../channels/boundary-close.ts";
import { CascadeCloseChannel } from "../channels/cascade-close.ts";
import { CompensationCommentChannel } from "../channels/compensation-comment.ts";
import { CustomCloseChannel } from "../channels/custom-close.ts";
import { DirectCloseChannel } from "../channels/direct-close.ts";
import { MergeCloseChannel } from "../channels/merge-close.ts";
import { MergeCloseAdapter } from "../channels/merge-close-adapter.ts";
import { OutboxClosePostChannel } from "../channels/outbox-close-post.ts";
import { OutboxClosePreChannel } from "../channels/outbox-close-pre.ts";
import { GhCliClient } from "../orchestrator/github-client.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import {
  type CloseTransport,
  createRealCloseTransport,
} from "../transports/close-transport.ts";
import { deepFreeze } from "./freeze.ts";
import { loadPolicy, writeBootPolicyFile } from "./policy.ts";
import { createAgentRegistry } from "./registry.ts";
import type { AgentRegistry, BootArtifacts } from "./types.ts";
import { validateBootArtifacts } from "./validate.ts";

import type { CloseEventBus } from "../events/bus.ts";

/**
 * Construct + register all 7 close channels (6 fixed + Custom) on `bus`
 * before `bus.freeze()` (Critique F1, T4.3).
 *
 * Each channel's `register(bus)` calls `bus.subscribe`; the bus must be
 * unfrozen at this point. Channels that fail to subscribe (e.g. custom
 * with no contract descriptor — vacuous in P4-1) still register a
 * no-op subscriber so the (mode × channel) coverage matrix is uniform.
 *
 * P4-1 status: every `decide` returns `skip`; channels are observers
 * only. The procedural close paths in
 * `orchestrator.ts:820-899`, `outbox-processor.ts:397`, and
 * `verdict/external-state-adapter.ts:234,361` continue to fire. PR4-2
 * onwards flip the decide logic and delete the procedural paths.
 */
/**
 * Construct + register every close-path subscriber on `bus` before
 * `bus.freeze()` (Critique F1, T4.3).
 *
 * Returns the constructed `DirectCloseChannel` so the orchestrator can
 * synchronously drive `decide → execute` from the
 * `TransitionComputed` publish site (PR4-2b — preserves the synchronous
 * post-close + sentinel-cascade order until PR4-3 migrates them too).
 *
 * Dependency shape per channel (PR4-2b):
 *  - 7 pure close channels (D / Cpre / Cpost / E / M / Cascade / U)
 *    take `{ agentRegistry, closeTransport }`.
 *  - DirectClose additionally takes `{ bus, runId }` because its
 *    `execute` publishes `IssueClosedEvent` / `IssueCloseFailedEvent`
 *    on success / failure (To-Be 41 §A end states).
 *  - `CompensationCommentChannel` takes `{ github, runId }` and
 *    subscribes to `IssueCloseFailedEvent` to honour the W13 contract
 *    (comment-only compensation; no label rollback).
 */
function registerCloseChannels(
  bus: CloseEventBus,
  agentRegistry: AgentRegistry,
  closeTransport: CloseTransport,
  github: GitHubClient,
  workflow: WorkflowConfig,
  runId: string,
): {
  readonly directClose: DirectCloseChannel;
  readonly outboxClosePre: OutboxClosePreChannel;
  readonly outboxClosePost: OutboxClosePostChannel;
  readonly boundaryClose: BoundaryCloseChannel;
} {
  const baseDeps = { agentRegistry, closeTransport } as const;
  const directClose = new DirectCloseChannel({
    ...baseDeps,
    bus,
    runId,
  });
  // PR4-3: Cpre / Cpost / E need bus + runId for IssueClosed publish;
  // Cpost + Cascade additionally need github (post-close OutboxActions
  // and project-eval queries). Cascade needs the frozen workflow for
  // projectBinding + label resolution.
  const outboxClosePre = new OutboxClosePreChannel({
    closeTransport,
    bus,
    runId,
  });
  const outboxClosePost = new OutboxClosePostChannel({
    closeTransport,
    github,
    bus,
    runId,
  });
  const boundaryClose = new BoundaryCloseChannel({
    closeTransport,
    bus,
    runId,
  });
  const cascadeClose = new CascadeCloseChannel({
    closeTransport,
    github,
    workflow,
    bus,
    runId,
  });
  const channels = [
    directClose,
    outboxClosePre,
    outboxClosePost,
    boundaryClose,
    new MergeCloseChannel(baseDeps),
    cascadeClose,
    new CustomCloseChannel(baseDeps),
  ];
  for (const channel of channels) {
    channel.register(bus);
  }
  // CompensationCommentChannel is a framework subscriber (no
  // ChannelId — does not publish IssueClosedEvent). It listens for the
  // shared IssueCloseFailedEvent stream regardless of which channel
  // raised the failure.
  const compensationComment = new CompensationCommentChannel({
    github,
    runId,
  });
  compensationComment.register(bus);
  return { directClose, outboxClosePre, outboxClosePost, boundaryClose };
}

/**
 * Options accepted by {@link BootKernel.boot}.
 *
 * `cwd` is required (every loader uses it). The rest are optional and
 * default to the design's documented values.
 */
export interface BootOpts {
  readonly cwd: string;
  /**
   * Path to the `gh` binary; forwarded to {@link loadPolicy}.
   * Defaults to `"gh"` (PATH discovery).
   */
  readonly ghBinary?: string;
  /**
   * Workflow config path relative to `cwd`. Defaults to
   * `.agent/workflow.json` (the loader's own default).
   */
  readonly workflowFile?: string;
  /**
   * When `true`, the diagnostic JSONL subscriber is **not** registered
   * on the boot bus. Used by unit tests that exercise BootArtifacts
   * shape without paying the cost of `tmp/logs` writes (or that run on
   * a read-only sandbox where `Deno.mkdirSync` is denied).
   *
   * Default `false`: production boots emit JSONL diagnostics.
   */
  readonly disableDiagnostic?: boolean;
  /**
   * Inject a `GitHubClient` instead of constructing the default
   * `GhCliClient(cwd)`. Used by:
   *   - `--local` fixture mode (entry-point passes a `FileGitHubClient`).
   *   - Integration tests that supply a recording stub.
   * When omitted, BootKernel constructs `new GhCliClient(opts.cwd)`.
   */
  readonly githubClient?: GitHubClient;
  /**
   * Inject a `CloseTransport` instead of deriving one from
   * `githubClient` via {@link createRealCloseTransport}. Tests pass
   * `createMockCloseTransport([])` to inspect close requests without
   * touching the upstream API. When omitted, BootKernel derives a
   * `real` transport that delegates back to `githubClient.closeIssue`.
   */
  readonly closeTransport?: CloseTransport;
}

/**
 * Static Boot façade. The kernel itself has no instance state — every
 * call to `boot` returns a fresh `BootArtifacts`. Holding it as a
 * class (rather than a plain function) keeps room for T2.2's validate
 * step, T3.4's bus / subscriber registration, and T6.4's policy
 * inheritance plumbing without changing the call shape.
 */
export class BootKernel {
  /**
   * Load + validate + freeze the 5 Layer-4 inputs.
   *
   * Steps:
   *  1. `loadWorkflow(cwd, workflowFile)` → WorkflowConfig.
   *  2. For each `agentId` in `workflow.agents`, `loadAgentBundle`.
   *     The per-bundle loader is called sequentially because it does a
   *     few synchronous file reads internally; the cost is bounded by
   *     `Object.keys(workflow.agents).length`.
   *  3. `createAgentRegistry(bundles)` enforces A1 (unique ids) — the
   *     only validation rule wired in T2.1. T2.2 expands the Decision
   *     chain with the remaining 25 rules.
   *  4. `loadPolicy(cwd, opts)` — Layer 4 environment policy.
   *  5. Build the BootArtifacts aggregate, then `deepFreeze` it once
   *     so the entire tree is Run-immutable (design 20 §E +
   *     Critique F1 single-freeze invariant).
   *
   * Errors from steps 1 / 2 still throw today (the loaders are
   * legacy throw-based per T1.4 partial migration); they are caught
   * and projected into `Reject(ValidationError[])` so the Decision
   * shape is uniform across rules and load failures. T2.2 will wire
   * the Decision-shaped sibling loaders directly.
   *
   * @param opts Boot options; only `cwd` is required.
   * @returns `Accept(artifacts)` on success;
   *          `Reject(errors)` when validation fails.
   */
  static async boot(opts: BootOpts): Promise<Decision<BootArtifacts>> {
    // 1. WorkflowConfig
    let workflow: WorkflowConfig;
    try {
      workflow = await loadWorkflow(opts.cwd, opts.workflowFile);
    } catch (cause) {
      return reject([
        validationError(
          "W1",
          cause instanceof Error ? cause.message : String(cause),
          { source: opts.workflowFile ?? ".agent/workflow.json" },
        ),
      ]);
    }

    // 2. AgentBundle list (one per workflow.agents entry)
    const bundleResults: Decision<AgentBundle>[] = [];
    for (const [agentId, workflowAgent] of Object.entries(workflow.agents)) {
      try {
        const bundle = await loadAgentBundle(agentId, opts.cwd, {
          workflowAgent,
        });
        bundleResults.push(accept(bundle));
      } catch (cause) {
        bundleResults.push(reject([
          validationError(
            "A2",
            `Failed to load AgentBundle "${agentId}": ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            {
              source: `.agent/${agentId}/agent.json`,
              context: { agentId },
            },
          ),
        ]));
      }
    }
    const bundlesDecision = combineDecisions(bundleResults);
    if (isReject(bundlesDecision)) {
      return bundlesDecision;
    }

    // 3. AgentRegistry (rule A1 — unique ids)
    const registryDecision = createAgentRegistry(bundlesDecision.value);
    if (isReject(registryDecision)) {
      return registryDecision;
    }

    // 4. Policy (Layer 4 environment)
    const policy = loadPolicy(opts.cwd, { ghBinary: opts.ghBinary });

    // 5. CloseEventBus + diagnostic subscriber (T3.4).
    //    Per Critique F1, the bus is constructed *inside* Boot and the
    //    subscriber set is sealed via `bus.freeze()` before the artifact
    //    is returned. Re-deploys (re-call to `boot`) get a fresh bus.
    //    Per Critique F7, the diagnostic logger is fire-and-forget; its
    //    registration cannot fail in a way that aborts boot.
    const runId = crypto.randomUUID();
    const bus = createCloseEventBus();
    registerDiagnosticSubscriber(bus, {
      runId,
      logDir: `${opts.cwd}/tmp/logs`,
      enabled: opts.disableDiagnostic !== true,
    });

    // 5b. GitHubClient + CloseTransport (PR4-2a).
    //     Construct the client once at boot so every Run-time consumer
    //     (Orchestrator, channels' close transport, outbox processor)
    //     reads the same reference. `--local` and integration tests
    //     inject a fixture client via `opts.githubClient`; production
    //     defaults to `GhCliClient(cwd)` (the upstream gh-CLI seam).
    //     `closeTransport` is the channel-side write seam — `real` for
    //     production, mock/file for tests.
    const githubClient: GitHubClient = opts.githubClient ??
      new GhCliClient(opts.cwd);
    const closeTransport: CloseTransport = opts.closeTransport ??
      createRealCloseTransport(githubClient);

    // 5c. Register the 6 close channels + Custom skeleton (T4.3).
    //     Subscriptions must register BEFORE `bus.freeze()` below.
    //     P4-1: every channel.decide returns `skip` so the bus carries
    //     no close decisions yet — channels observe events only. PR4-2+
    //     flips decide logic and deletes the procedural close path.
    const { directClose, outboxClosePre, outboxClosePost, boundaryClose } =
      registerCloseChannels(
        bus,
        registryDecision.value,
        closeTransport,
        githubClient,
        workflow,
        runId,
      );

    // 5d. MergeCloseAdapter (PR4-4 T4.5). The adapter holds a bus
    //     reference and reads `tmp/merge-close-facts/<runId>.jsonl`
    //     on `drain()`. It is NOT a Channel — MergeClose's
    //     subscribesTo is empty by design — but it is the publisher
    //     for `IssueClosedEvent({ channel: "M" })` so the close
    //     surface uniformity (R5 hard gate) extends to merge-pr.
    const mergeCloseAdapter = new MergeCloseAdapter({
      bus,
      runId,
      cwd: opts.cwd,
    });

    // 6. Assemble (pre-freeze)
    const artifacts: BootArtifacts = {
      workflow,
      agentRegistry: registryDecision.value,
      // T2.2: schemas remain empty; eager SO schema loading is downstream.
      // The 26 boot rules in `validateBootArtifacts` operate on the
      // assembled BootArtifacts and surface every rule violation in one
      // pass (combine-then-throw at the entry-point boundary).
      schemas: new Map<string, unknown>(),
      policy,
      bus,
      runId,
      bootedAt: Date.now(),
      githubClient,
      closeTransport,
      directClose,
      outboxClosePre,
      outboxClosePost,
      boundaryClose,
      mergeCloseAdapter,
    };

    // 7. Run all 26 Boot validation rules (W1..W10 / A1..A8 / S1..S8).
    //    Reject path skips deepFreeze — freezing a rejected artifact
    //    would publish a Layer-4 reference to an invalid configuration.
    //    The bus is intentionally NOT frozen on reject either: the
    //    artifact is discarded by the caller, so subscriber-set state
    //    is moot.
    const validation = validateBootArtifacts(artifacts);
    if (isReject(validation)) {
      return validation;
    }

    // 8. Seal the bus before deepFreeze. After this point any attempt
    //    to call `bus.subscribe` throws SubscribeAfterBootError — Layer
    //    4 immutability extends to the subscriber set.
    bus.freeze();

    // 9. Freeze (single deepFreeze pass per Critique F1).
    //    The bus object's own methods (publish/subscribe/freeze/isFrozen)
    //    survive deepFreeze because they are bound closures captured on
    //    the returned object literal, not data properties.
    const frozen = deepFreeze(artifacts);

    // 10. T6.4 — Layer-4 inheritance via file-based IPC (design 20 §E).
    //     When the policy opts in to subprocess inheritance, persist it
    //     to `tmp/boot-policy-<runId>.json` so a subsequently-spawned
    //     `merge-pr` subprocess can deserialise + freeze the *same*
    //     Layer-4 environment instead of constructing fresh defaults.
    //     A failure here aborts the boot — Critique F15 demands the
    //     inheritance contract be loud, not silent.
    if (frozen.policy.applyToSubprocess) {
      try {
        await writeBootPolicyFile(frozen.policy, frozen.runId, opts.cwd);
      } catch (cause) {
        return reject([
          validationError(
            "W1",
            `Layer-4 inheritance broken: failed to write boot-policy file ` +
              `for runId=${frozen.runId}: ${
                cause instanceof Error ? cause.message : String(cause)
              }. policy.applyToSubprocess=true requires the parent process ` +
              `to write tmp/boot-policy-<runId>.json before spawning merge-pr ` +
              `(design 20 §E).`,
            { source: `tmp/boot-policy-${frozen.runId}.json` },
          ),
        ]);
      }
    }

    return accept(frozen);
  }

  /**
   * Standalone-agent Boot: load + validate + freeze for the
   * `deno task agent --agent <name>` invocation mode where the user is
   * exercising one agent in isolation, not running the orchestrator
   * loop.
   *
   * Per Critique F12 (no lite-boot bifurcation), this routine does NOT
   * skip the kernel — it synthesises an in-memory `WorkflowConfig`
   * containing just the requested agent and re-enters the same boot
   * pipeline, so every Layer-4 invariant (deepFreeze, AgentRegistry,
   * Policy, the 26 rules to the extent they're decidable on a 1-agent
   * workflow) still runs.
   *
   * Why a synthesised workflow rather than re-using the on-disk one:
   * the standalone mode must work even when the agent is not declared
   * in `.agent/workflow.json` (e.g. the user is iterating on a brand-
   * new agent). The on-disk workflow may also reference *other* agents
   * whose bundles we don't need — loading them would be wasteful and
   * could surface unrelated A2 rejections.
   *
   * @param opts Standalone boot options.
   * @returns `Accept(artifacts)` on success; `Reject(errors)` on
   *          validation failure (single-agent surface only).
   */
  static async bootStandalone(opts: {
    readonly cwd: string;
    readonly agentName: string;
    readonly ghBinary?: string;
    /**
     * See {@link BootOpts.disableDiagnostic}. Default `false`.
     * Standalone-agent integration tests pass `true` to keep the test
     * tree free of `tmp/logs` artefacts.
     */
    readonly disableDiagnostic?: boolean;
    /** See {@link BootOpts.githubClient}. */
    readonly githubClient?: GitHubClient;
    /** See {@link BootOpts.closeTransport}. */
    readonly closeTransport?: CloseTransport;
  }): Promise<Decision<BootArtifacts>> {
    // 1. AgentBundle for the requested agent (no workflowAgent override —
    //    we have no workflow.json declaration to inherit from).
    let bundle: AgentBundle;
    try {
      bundle = await loadAgentBundle(opts.agentName, opts.cwd);
    } catch (cause) {
      return reject([
        validationError(
          "A2",
          `Failed to load AgentBundle "${opts.agentName}": ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          {
            source: `.agent/${opts.agentName}/agent.json`,
            context: { agentId: opts.agentName },
          },
        ),
      ]);
    }

    // 2. AgentRegistry (A1 trivially holds for a 1-bundle list).
    const registryDecision = createAgentRegistry([bundle]);
    if (isReject(registryDecision)) {
      return registryDecision;
    }

    // 3. Synthesise a minimal WorkflowConfig that satisfies the W rules.
    //    This is *NOT* a lite-boot escape — the same `validateBootArtifacts`
    //    pass runs over the synthesised artifact.
    //
    //    Shape rationale:
    //      - one actionable phase ("standalone") whose agent is the
    //        bundle's id — satisfies W1, W2, W3.
    //      - one terminal phase ("done") for outputPhase resolution —
    //        satisfies W4 (when the bundle exposes outputPhase).
    //      - labelMapping has a single entry pointing to "standalone" —
    //        satisfies W5.
    //      - no projectBinding / handoff / prioritizer — those rules are
    //        vacuous when absent.
    const synthesizedPhases: WorkflowConfig["phases"] = {
      standalone: {
        type: "actionable",
        priority: 1,
        agent: opts.agentName,
      },
      done: { type: "terminal" },
    };
    const synthesizedAgents: WorkflowConfig["agents"] = {
      [opts.agentName]: {
        role: "transformer",
        directory: opts.agentName,
        outputPhase: "done",
      },
    };
    const synthesizedWorkflow: WorkflowConfig = {
      version: "1.0.0",
      issueSource: { kind: "ghRepoIssues", projectMembership: "unbound" },
      phases: synthesizedPhases,
      labelMapping: { "standalone": "standalone" },
      // Synthesise an `agents` entry so W3 / W4 cross-refs resolve.
      // The role hint defaults to "transformer" with outputPhase=done;
      // a validator-shaped bundle is still loaded — only its workflow-
      // side close hints are missing, which the standalone runner does
      // not consult (the runner reads bundle.flow / bundle.completion
      // directly).
      agents: synthesizedAgents,
      invocations: deriveInvocations(synthesizedPhases, synthesizedAgents),
      rules: { maxCycles: 1, cycleDelayMs: 0 },
    };

    // 4. Policy (same loader as full boot).
    const policy = loadPolicy(opts.cwd, { ghBinary: opts.ghBinary });

    // 5. CloseEventBus + diagnostic subscriber (T3.4) — same sequence as
    //    `boot()`. Standalone mode re-enters the full pipeline so the
    //    bus + subscriber set are constructed identically; this matters
    //    because a standalone agent run still publishes events
    //    (DispatchPlanned, DispatchCompleted) and a future P4
    //    standalone close path will publish IssueClosedEvent.
    const runId = crypto.randomUUID();
    const bus = createCloseEventBus();
    registerDiagnosticSubscriber(bus, {
      runId,
      logDir: `${opts.cwd}/tmp/logs`,
      enabled: opts.disableDiagnostic !== true,
    });

    // 5b. GitHubClient + CloseTransport (PR4-2a). Same construction rule
    //     as `boot()` — standalone mode does not bypass the seam.
    const githubClient: GitHubClient = opts.githubClient ??
      new GhCliClient(opts.cwd);
    const closeTransport: CloseTransport = opts.closeTransport ??
      createRealCloseTransport(githubClient);

    // 5c. Register the 6 close channels + Custom skeleton (T4.3).
    //     Standalone mode re-enters the same pipeline as `boot()` so the
    //     subscriber set is identical. P4-1 channels are observe-only.
    const { directClose, outboxClosePre, outboxClosePost, boundaryClose } =
      registerCloseChannels(
        bus,
        registryDecision.value,
        closeTransport,
        githubClient,
        synthesizedWorkflow,
        runId,
      );

    // 5d. MergeCloseAdapter (PR4-4 T4.5). Standalone mode constructs
    //     the same adapter so (mode × channel) reachability stays
    //     uniform (11 §E). A standalone agent run will not normally
    //     trigger merge-pr, but the adapter is harmless when the
    //     fact file is absent (`drain()` returns zero published).
    const mergeCloseAdapter = new MergeCloseAdapter({
      bus,
      runId,
      cwd: opts.cwd,
    });

    // 6. Assemble + validate + freeze (re-enter the full pipeline).
    const artifacts: BootArtifacts = {
      workflow: synthesizedWorkflow,
      agentRegistry: registryDecision.value,
      schemas: new Map<string, unknown>(),
      policy,
      bus,
      runId,
      bootedAt: Date.now(),
      githubClient,
      closeTransport,
      directClose,
      outboxClosePre,
      outboxClosePost,
      boundaryClose,
      mergeCloseAdapter,
    };

    const validation = validateBootArtifacts(artifacts);
    if (isReject(validation)) {
      return validation;
    }

    bus.freeze();
    const frozen = deepFreeze(artifacts);

    // T6.4 — Layer-4 inheritance (same contract as `boot()`). Standalone
    // mode rarely spawns merge-pr but the file is still written when the
    // policy opts in, so any subprocess that the agent triggers inherits
    // the parent's environment uniformly across modes (R5 mode invariance,
    // design 20 §E).
    if (frozen.policy.applyToSubprocess) {
      try {
        await writeBootPolicyFile(frozen.policy, frozen.runId, opts.cwd);
      } catch (cause) {
        return reject([
          validationError(
            "W1",
            `Layer-4 inheritance broken (standalone): failed to write ` +
              `boot-policy file for runId=${frozen.runId}: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            { source: `tmp/boot-policy-${frozen.runId}.json` },
          ),
        ]);
      }
    }

    return accept(frozen);
  }
}
