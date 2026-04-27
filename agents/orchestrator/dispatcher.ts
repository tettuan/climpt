/**
 * Agent Dispatcher - Dispatch agents and collect outcomes
 *
 * Provides an interface for dispatching agents, with a stub
 * implementation for testing and a real implementation that
 * invokes AgentRunner in-process.
 */

import type {
  AgentDefinition,
  SubjectPayload,
  WorkflowConfig,
} from "./workflow-types.ts";
import type {
  AgentResult,
  RateLimitInfo,
} from "../src_common/types/runtime.ts";
import { AgentRunner } from "../runner/runner.ts";
import { agentBundleToResolvedDefinition } from "../config/mod.ts";
import type { AgentRegistry } from "../boot/types.ts";
import type { CloseEventBus } from "../events/bus.ts";
import { getValueAtPath } from "../runner/step-gate-interpreter.ts";

/**
 * Resolve a DispatchOutcome.outcome string from an AgentResult, honoring the
 * agent's declared role.
 *
 * - `transformer` (without `fallbackPhases`): outcome is binary.
 *   `success=true` → "success", `success=false` → "failed". Any `verdict`
 *   on the result is ignored.
 * - `transformer` (with `fallbackPhases`): outcome uses `verdict` when
 *   available, enabling outcome-specific fallback routing.
 *   `success=true` → "success", `success=false` → `verdict ?? "failed"`.
 * - `validator`: outcome is the result's `verdict`. Absence of `verdict` is a
 *   programmer/config error — validators must always emit one — so we throw
 *   rather than fall back to a binary outcome.
 */
export function resolveOutcome(
  agent: AgentDefinition,
  result: AgentResult,
): string {
  switch (agent.role) {
    case "transformer":
      if (agent.fallbackPhases) {
        return result.verdict ?? (result.success ? "success" : "failed");
      }
      return result.success ? "success" : "failed";
    case "validator":
      if (!result.verdict) {
        throw new Error(
          `Validator agent "${
            agent.directory ?? "(unknown)"
          }" must return a verdict`,
        );
      }
      return result.verdict;
    default: {
      const _exhaust: never = agent;
      throw new Error(`Unknown agent role: ${JSON.stringify(_exhaust)}`);
    }
  }
}

/**
 * Extract handoff data from the last closure step's structured output.
 *
 * Uses the closure step's handoffFields to select which fields to include.
 * Values are stringified (non-strings via JSON.stringify).
 * Returns undefined when no handoffFields are configured or no structured output exists.
 */
export function extractHandoffData(
  result: {
    summaries: ReadonlyArray<{ structuredOutput?: Record<string, unknown> }>;
  },
  stepsRegistry: ReadonlyArray<
    { stepKind?: string; structuredGate?: { handoffFields?: string[] } }
  >,
): Record<string, string> | undefined {
  // Find closure step with handoffFields
  const closureStep = stepsRegistry.find(
    (s) => s.stepKind === "closure" && s.structuredGate?.handoffFields?.length,
  );
  if (!closureStep?.structuredGate?.handoffFields?.length) return undefined;

  // Get last iteration's structured output
  const lastSummary = result.summaries[result.summaries.length - 1];
  if (!lastSummary?.structuredOutput) return undefined;

  const data: Record<string, string> = {};
  for (const fieldPath of closureStep.structuredGate.handoffFields) {
    const value = getValueAtPath(lastSummary.structuredOutput, fieldPath);
    if (value !== undefined) {
      const key = fieldPath.split(".").pop() ?? fieldPath;
      data[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }

  return Object.keys(data).length > 0 ? data : undefined;
}

/**
 * Compose the flat argument bag handed to {@link AgentRunner.run}.
 *
 * Precedence (later entries win on key collision):
 *   1. `options.payload`  — opaque workflow-level values
 *   2. fixed orchestration keys (`issue`, `iterateMax`, ...)
 *
 * The runner separately receives `options.payload` as `issuePayload` so
 * the subprocess closure context can observe payload values even when
 * the agent does not declare them as CLI parameters.
 *
 * Extracted for direct unit-testability; {@link RunnerDispatcher.dispatch}
 * uses the same composition.
 */
export function composeRunnerArgs(
  subjectId: string | number,
  options?: DispatchOptions,
): Record<string, unknown> {
  const runnerArgs: Record<string, unknown> = {
    ...(options?.payload ?? {}),
    issue: subjectId,
  };
  if (options?.iterateMax !== undefined) {
    runnerArgs.iterateMax = options.iterateMax;
  }
  if (options?.branch) {
    runnerArgs.branch = options.branch;
  }
  if (options?.issueStorePath) {
    runnerArgs.issueStorePath = options.issueStorePath;
  }
  if (options?.outboxPath) {
    runnerArgs.outboxPath = options.outboxPath;
  }
  return runnerArgs;
}

/** Options passed to agent dispatch. */
export interface DispatchOptions {
  iterateMax?: number;
  branch?: string;
  verbose?: boolean;
  issueStorePath?: string;
  outboxPath?: string;
  /**
   * Opaque per-workflow payload produced by a prior handoff emission.
   * Keys are merged into `runnerArgs` before the fixed keys (`issue`,
   * `iterateMax`, ...) so the fixed keys always win on collision, and
   * the same payload is forwarded to the runner as `issuePayload` so
   * the subprocess closure context can observe the workflow-level
   * values independently of the agent's declared parameters.
   */
  readonly payload?: SubjectPayload;
}

/** Result of a single agent dispatch. */
export interface DispatchOutcome {
  outcome: string;
  durationMs: number;
  rateLimitInfo?: RateLimitInfo;
  /** Closure step structured output fields selected by handoffFields. */
  handoffData?: Record<string, string>;
  /**
   * Last iteration's raw `structuredOutput`; source for ArtifactEmitter
   * `$.agent.result.*` resolution. Opaque to the dispatcher; the emitter
   * walks paths against it.
   */
  readonly structuredOutput?: Record<string, unknown>;
}

/** Abstract interface for dispatching agents. */
export interface AgentDispatcher {
  dispatch(
    agentId: string,
    subjectId: string | number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome>;
}

/** Recorded call made against {@link StubDispatcher}. */
export interface StubDispatcherCall {
  readonly agentId: string;
  readonly subjectId: string | number;
  readonly options?: DispatchOptions;
}

/** Stub dispatcher for testing - returns preconfigured outcomes. */
export class StubDispatcher implements AgentDispatcher {
  #outcomes: Map<string, string>;
  #callCount = 0;
  #rateLimitInfo?: RateLimitInfo;
  #handoffData?: Record<string, string>;
  #structuredOutput?: Record<string, unknown>;
  #calls: StubDispatcherCall[] = [];

  constructor(
    outcomes?: Record<string, string>,
    rateLimitInfo?: RateLimitInfo,
    handoffData?: Record<string, string>,
    structuredOutput?: Record<string, unknown>,
  ) {
    this.#outcomes = new Map(Object.entries(outcomes ?? {}));
    this.#rateLimitInfo = rateLimitInfo;
    this.#handoffData = handoffData;
    this.#structuredOutput = structuredOutput;
  }

  get callCount(): number {
    return this.#callCount;
  }

  /** Invocation history for assertions in tests. */
  get calls(): ReadonlyArray<StubDispatcherCall> {
    return this.#calls;
  }

  dispatch(
    agentId: string,
    subjectId: string | number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome> {
    this.#callCount++;
    this.#calls.push({ agentId, subjectId, options });
    const outcome = this.#outcomes.get(agentId) ?? "success";
    return Promise.resolve({
      outcome,
      durationMs: 0,
      rateLimitInfo: this.#rateLimitInfo,
      handoffData: this.#handoffData,
      structuredOutput: this.#structuredOutput,
    });
  }
}

/**
 * Real dispatcher that invokes AgentRunner in-process.
 *
 * Resolves the agent's bundle via the frozen
 * {@link AgentRegistry.lookup} (populated once by `BootKernel.boot`,
 * design 10 §B input 2) — no per-dispatch disk reload — and projects
 * to the legacy {@link ResolvedAgentDefinition} runtime shape so
 * `AgentRunner` stays unchanged (Option A; runner-side migration is
 * T1.4's concern).
 */
export class RunnerDispatcher implements AgentDispatcher {
  #config: WorkflowConfig;
  #agentRegistry: AgentRegistry;
  #cwd: string;
  #bus: CloseEventBus | undefined;
  #runId: string | undefined;
  /**
   * `BoundaryCloseChannel` reference from
   * `BootArtifacts.boundaryClose` (PR4-3). Forwarded to AgentRunner
   * via `RunnerOptions.boundaryClose` so the closure-step verdict
   * adapter can delegate close-writes to the channel instead of
   * shelling out `gh issue close` itself (T4.4c cutover).
   */
  #boundaryClose:
    | import("../channels/boundary-close.ts").BoundaryCloseChannel
    | undefined;

  /**
   * Construct a `RunnerDispatcher`.
   *
   * @param config        Frozen WorkflowConfig (design 12 §B). The
   *                      dispatcher reads `agents[agentId]` to discover
   *                      `role` / `outputPhases` for outcome resolution
   *                      and to validate that the requested agentId is
   *                      declared in the workflow.
   * @param agentRegistry Frozen `AgentRegistry` from
   *                      `BootArtifacts.agentRegistry`. The single
   *                      source of truth for AgentBundle lookup (T2.3).
   * @param cwd           Working directory forwarded to `AgentRunner`.
   * @param bus           T3.3 (shadow mode): frozen `CloseEventBus` from
   *                      `BootArtifacts.bus`. Forwarded to
   *                      {@link AgentRunner.run} so closure-step
   *                      boundary hooks can publish
   *                      `closureBoundaryReached`. Optional — legacy
   *                      callers / StubDispatcher tests omit it.
   * @param runId         Stable boot correlation id; paired with
   *                      {@link bus}. Becomes `BaseEvent.runId` for
   *                      every event the runner publishes.
   */
  constructor(
    config: WorkflowConfig,
    agentRegistry: AgentRegistry,
    cwd: string,
    bus?: CloseEventBus,
    runId?: string,
    boundaryClose?:
      import("../channels/boundary-close.ts").BoundaryCloseChannel,
  ) {
    this.#config = config;
    this.#agentRegistry = agentRegistry;
    this.#cwd = cwd;
    this.#bus = bus;
    this.#runId = runId;
    this.#boundaryClose = boundaryClose;
  }

  async dispatch(
    agentId: string,
    subjectId: string | number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome> {
    const startMs = performance.now();

    const agent = this.#config.agents[agentId];
    if (!agent) {
      throw new Error(
        `Unknown agent id "${agentId}": not declared in workflow.agents`,
      );
    }

    // The registry is exhaustive by Boot rule A1 + W11 — every workflow
    // agent has a corresponding bundle. A miss here indicates Boot
    // failed to validate before reaching dispatch (defensive guard).
    const bundle = this.#agentRegistry.lookup(agentId);
    if (!bundle) {
      throw new Error(
        `RunnerDispatcher: agentId "${agentId}" not present in frozen ` +
          `AgentRegistry. The Boot kernel should have rejected this ` +
          `workflow before dispatch (rule A1 / W11).`,
      );
    }

    // Project bundle → ResolvedAgentDefinition for AgentRunner. Pure
    // type-only translation, no disk I/O — the bundle is already frozen.
    const definition = agentBundleToResolvedDefinition(bundle);

    // Payload is spread as the base layer; fixed orchestration keys
    // always win on collision, and unknown payload keys are forwarded
    // verbatim (the runner ignores keys not declared by the agent).
    const runnerArgs = composeRunnerArgs(subjectId, options);

    const runner = new AgentRunner(definition);
    const result = await runner.run({
      cwd: this.#cwd,
      args: runnerArgs,
      plugins: [],
      verbose: options?.verbose,
      issuePayload: options?.payload,
      // T3.3: forward the boot bus + runId so the runner's BoundaryHooks
      // publishes `closureBoundaryReached` against the correct boot
      // correlation id. When the dispatcher was constructed without a
      // bus (legacy / tests), both fields are `undefined` and the
      // runner publishes nothing.
      bus: this.#bus,
      runId: this.#runId,
      // PR4-3 (T4.4c): forward the BoundaryCloseChannel so the
      // closure-step verdict adapter can delegate close-writes to the
      // channel instead of shelling out `gh issue close` itself.
      boundaryClose: this.#boundaryClose,
    });

    const durationMs = performance.now() - startMs;

    // Use the typed Step list directly for handoff extraction. The legacy
    // `__stepsRegistry` side-channel is still synthesized by
    // `agentBundleToResolvedDefinition` for any legacy reader, but we
    // bypass it here and walk the typed bundle.steps so the dispatcher
    // does not depend on the projection's internal shape.
    // TODO[T1.4]: collapse extractHandoffData onto Step / AgentBundle
    // so the legacy `{stepKind, structuredGate}` shape is no longer
    // needed at this site.
    const handoffData = extractHandoffData(
      result,
      bundle.steps.map((s) => ({
        stepKind: s.kind,
        structuredGate: s.structuredGate,
      })),
    );

    const lastSummary = result.summaries[result.summaries.length - 1];
    const structuredOutput = lastSummary?.structuredOutput;

    return {
      outcome: resolveOutcome(agent, result),
      durationMs,
      rateLimitInfo: result.rateLimitInfo,
      handoffData,
      structuredOutput,
    };
  }
}
