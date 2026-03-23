/**
 * Agent Dispatcher - Dispatch agents and collect outcomes
 *
 * Provides an interface for dispatching agents, with a stub
 * implementation for testing and a real implementation that
 * invokes agents via `deno task agent`.
 */

import type { WorkflowConfig } from "./workflow-types.ts";
import type { RateLimitInfo } from "../src_common/types/runtime.ts";

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

  constructor(
    outcomes?: Record<string, string>,
    rateLimitInfo?: RateLimitInfo,
  ) {
    this.#outcomes = new Map(Object.entries(outcomes ?? {}));
    this.#rateLimitInfo = rateLimitInfo;
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
    });
  }
}

/**
 * Real dispatcher that invokes agents via `deno task agent`.
 *
 * Keeps the orchestrator decoupled from runner internals by
 * shelling out to the CLI entry point.
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

    const args = [
      "task",
      "agent",
      "--agent",
      agentName,
      "--issue",
      String(issueNumber),
    ];

    if (options?.iterateMax !== undefined) {
      args.push("--iterate-max", String(options.iterateMax));
    }
    if (options?.branch) {
      args.push("--branch", options.branch);
    }
    if (options?.verbose) {
      args.push("--verbose");
    }
    if (options?.issueStorePath) {
      args.push("--issue-store-path", options.issueStorePath);
    }
    if (options?.outboxPath) {
      args.push("--outbox-path", options.outboxPath);
    }

    const cmd = new Deno.Command("deno", {
      args,
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();
    const durationMs = performance.now() - startMs;

    const stdout = new TextDecoder().decode(output.stdout);
    const { outcome, rateLimitInfo } = this.#parseResult(
      stdout,
      output.success,
    );
    return { outcome, durationMs, rateLimitInfo };
  }

  /**
   * Parse result from agent stdout.
   *
   * Scans stdout lines from the end looking for a JSON line
   * containing an "outcome" key (e.g. `{"outcome": "approved"}`).
   * Also captures rateLimitInfo if present in the same JSON line.
   * Falls back to "success"/"failed" based on exit code.
   */
  #parseResult(
    stdout: string,
    success: boolean,
  ): { outcome: string; rateLimitInfo?: RateLimitInfo } {
    const lines = stdout.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.length === 0 || line[0] !== "{") continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.outcome === "string") {
          let rateLimitInfo: RateLimitInfo | undefined;
          if (
            parsed.rateLimitInfo !== null &&
            typeof parsed.rateLimitInfo === "object"
          ) {
            const rli = parsed.rateLimitInfo as Record<string, unknown>;
            if (
              typeof rli.utilization === "number" &&
              typeof rli.resetsAt === "number" &&
              typeof rli.rateLimitType === "string"
            ) {
              rateLimitInfo = {
                utilization: rli.utilization,
                resetsAt: rli.resetsAt,
                rateLimitType: rli.rateLimitType,
              };
            }
          }
          return { outcome: parsed.outcome, rateLimitInfo };
        }
      } catch {
        // not valid JSON, continue scanning
      }
    }
    return { outcome: success ? "success" : "failed" };
  }
}
