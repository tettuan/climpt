/**
 * Agent Dispatcher - Dispatch agents and collect outcomes
 *
 * Provides an interface for dispatching agents, with a stub
 * implementation for testing and a real implementation that
 * invokes AgentRunner in-process.
 */

import type { WorkflowConfig } from "./workflow-types.ts";
import type { RateLimitInfo } from "../src_common/types/runtime.ts";
import { AgentRunner } from "../runner/runner.ts";
import { loadConfiguration } from "../config/mod.ts";
import { getValueAtPath } from "../runner/step-gate-interpreter.ts";

/** Map AgentResult to DispatchOutcome.outcome string. Prefers verdict over binary. */
export function mapResultToOutcome(
  result: { success: boolean; verdict?: string },
): string {
  return result.verdict ?? (result.success ? "success" : "failed");
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

/** Options passed to agent dispatch. */
export interface DispatchOptions {
  iterateMax?: number;
  branch?: string;
  verbose?: boolean;
  issueStorePath?: string;
  outboxPath?: string;
}

/** Result of a single agent dispatch. */
export interface DispatchOutcome {
  outcome: string;
  durationMs: number;
  rateLimitInfo?: RateLimitInfo;
  /** Closure step structured output fields selected by handoffFields. */
  handoffData?: Record<string, string>;
}

/** Abstract interface for dispatching agents. */
export interface AgentDispatcher {
  dispatch(
    agentId: string,
    issueNumber: number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome>;
}

/** Stub dispatcher for testing - returns preconfigured outcomes. */
export class StubDispatcher implements AgentDispatcher {
  #outcomes: Map<string, string>;
  #callCount = 0;
  #rateLimitInfo?: RateLimitInfo;
  #handoffData?: Record<string, string>;

  constructor(
    outcomes?: Record<string, string>,
    rateLimitInfo?: RateLimitInfo,
    handoffData?: Record<string, string>,
  ) {
    this.#outcomes = new Map(Object.entries(outcomes ?? {}));
    this.#rateLimitInfo = rateLimitInfo;
    this.#handoffData = handoffData;
  }

  get callCount(): number {
    return this.#callCount;
  }

  dispatch(
    agentId: string,
    _issueNumber: number,
    _options?: DispatchOptions,
  ): Promise<DispatchOutcome> {
    this.#callCount++;
    const outcome = this.#outcomes.get(agentId) ?? "success";
    return Promise.resolve({
      outcome,
      durationMs: 0,
      rateLimitInfo: this.#rateLimitInfo,
      handoffData: this.#handoffData,
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
    const agentName = agent?.directory ?? agentId;

    const definition = await loadConfiguration(agentName, this.#cwd);

    const runnerArgs: Record<string, unknown> = {
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

    const runner = new AgentRunner(definition);
    const result = await runner.run({
      cwd: this.#cwd,
      args: runnerArgs,
      plugins: [],
      verbose: options?.verbose,
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

    return {
      outcome: mapResultToOutcome(result),
      durationMs,
      rateLimitInfo: result.rateLimitInfo,
      handoffData,
    };
  }
}
