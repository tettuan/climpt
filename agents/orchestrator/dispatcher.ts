/**
 * Agent Dispatcher - Dispatch agents and collect outcomes
 *
 * Provides an interface for dispatching agents, with a stub
 * implementation for testing and a real implementation that
 * invokes agents via `deno task agent`.
 */

import type { WorkflowConfig } from "./workflow-types.ts";

/** Options passed to agent dispatch. */
export interface DispatchOptions {
  iterateMax?: number;
  branch?: string;
  verbose?: boolean;
}

/** Result of a single agent dispatch. */
export interface DispatchOutcome {
  outcome: string;
  durationMs: number;
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

  constructor(outcomes?: Record<string, string>) {
    this.#outcomes = new Map(Object.entries(outcomes ?? {}));
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
    return Promise.resolve({ outcome, durationMs: 0 });
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

    const cmd = new Deno.Command("deno", {
      args,
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();
    const durationMs = performance.now() - startMs;

    const stdout = new TextDecoder().decode(output.stdout);
    const outcome = this.#parseOutcome(stdout, output.success);
    return { outcome, durationMs };
  }

  /**
   * Parse outcome from agent stdout.
   *
   * Scans stdout lines from the end looking for a JSON line
   * containing an "outcome" key (e.g. `{"outcome": "approved"}`).
   * Falls back to "success"/"failed" based on exit code.
   */
  #parseOutcome(stdout: string, success: boolean): string {
    const lines = stdout.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.length === 0 || line[0] !== "{") continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.outcome === "string") {
          return parsed.outcome;
        }
      } catch {
        // not valid JSON, continue scanning
      }
    }
    return success ? "success" : "failed";
  }
}
