/**
 * Agent Dispatcher - Dispatch agents and collect outcomes
 *
 * Provides an interface for dispatching agents, with a stub
 * implementation for testing and a real implementation that
 * invokes AgentRunner in-process.
 */

import type {
  AgentDefinition,
  IssuePayload,
  WorkflowConfig,
} from "./workflow-types.ts";
import type {
  AgentResult,
  RateLimitInfo,
} from "../src_common/types/runtime.ts";
import { AgentRunner } from "../runner/runner.ts";
import { loadConfiguration } from "../config/mod.ts";
import { getValueAtPath } from "../runner/step-gate-interpreter.ts";

/**
 * Resolve a DispatchOutcome.outcome string from an AgentResult, honoring the
 * agent's declared role.
 *
 * - `transformer`: outcome is binary. `success=true` → "success",
 *   `success=false` → "failed". Any `verdict` on the result is ignored because
 *   transformers do not contribute to verdict-based routing.
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
  issueNumber: number,
  options?: DispatchOptions,
): Record<string, unknown> {
  const runnerArgs: Record<string, unknown> = {
    ...(options?.payload ?? {}),
    issue: issueNumber,
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
  readonly payload?: IssuePayload;
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
    issueNumber: number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome>;
}

/** Recorded call made against {@link StubDispatcher}. */
export interface StubDispatcherCall {
  readonly agentId: string;
  readonly issueNumber: number;
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
    issueNumber: number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome> {
    this.#callCount++;
    this.#calls.push({ agentId, issueNumber, options });
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
 * Loads agent configuration and calls AgentRunner.run() directly,
 * avoiding subprocess overhead and piped stdout parsing.
 */
export class RunnerDispatcher implements AgentDispatcher {
  #config: WorkflowConfig;
  #cwd: string;

  constructor(config: WorkflowConfig, cwd: string) {
    this.#config = config;
    this.#cwd = cwd;
  }

  async dispatch(
    agentId: string,
    issueNumber: number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome> {
    const startMs = performance.now();

    const agent = this.#config.agents[agentId];
    if (!agent) {
      throw new Error(
        `Unknown agent id "${agentId}": not declared in workflow.agents`,
      );
    }
    const agentName = agent.directory ?? agentId;

    const definition = await loadConfiguration(agentName, this.#cwd);

    // Payload is spread as the base layer; fixed orchestration keys
    // always win on collision, and unknown payload keys are forwarded
    // verbatim (the runner ignores keys not declared by the agent).
    const runnerArgs = composeRunnerArgs(issueNumber, options);

    const runner = new AgentRunner(definition);
    const result = await runner.run({
      cwd: this.#cwd,
      args: runnerArgs,
      plugins: [],
      verbose: options?.verbose,
      issuePayload: options?.payload,
    });

    const durationMs = performance.now() - startMs;

    // deno-lint-ignore no-explicit-any
    const registry = (definition as any).__stepsRegistry as
      | {
        steps: Record<
          string,
          { stepKind?: string; structuredGate?: { handoffFields?: string[] } }
        >;
      }
      | undefined;
    const handoffData = extractHandoffData(
      result,
      registry ? Object.values(registry.steps) : [],
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
