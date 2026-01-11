// deno-lint-ignore-file require-await prefer-ascii
/**
 * Agent Lifecycle - Agent Lifetime Management
 *
 * ExecutionContract implementation
 *
 * Responsibilities:
 * - Initialize dependent components
 * - Manage lifecycle state
 * - Delegate loop execution
 * - Cleanup
 */

import type { AgentDefinition } from "../src_common/types.ts";
import type {
  AgentResultV2,
  ExecutionContract,
  StartOptions,
} from "../src_common/contracts.ts";
import {
  AgentStateMachine,
  type AgentStatus,
  InvalidTransitionError,
} from "./state-machine.ts";

export interface LifecycleOptions {
  /** Factory for creating completion handler */
  completionHandlerFactory?: unknown;
  /** Factory for creating prompt resolver */
  promptResolverFactory?: unknown;
  /** Factory for creating logger */
  loggerFactory?: unknown;
  /** Factory for creating action system */
  actionSystemFactory?: unknown;
}

export interface LifecycleContext {
  cwd: string;
  args: Record<string, unknown>;
  plugins: string[];
  logger?: unknown;
  completionHandler?: unknown;
  promptResolver?: unknown;
  actionDetector?: unknown;
  actionExecutor?: unknown;
}

/**
 * Agent Lifecycle Manager
 *
 * Manages the lifecycle of an agent from creation to completion.
 * Implements ExecutionContract.
 */
export class AgentLifecycle implements ExecutionContract {
  private readonly stateMachine: AgentStateMachine;
  private context?: LifecycleContext;
  private result?: AgentResultV2;

  constructor(
    private readonly definition: Readonly<AgentDefinition>,
    private readonly _options: LifecycleOptions = {},
  ) {
    this.stateMachine = new AgentStateMachine();
  }

  /**
   * Get current status.
   */
  get status(): AgentStatus {
    return this.stateMachine.status;
  }

  /**
   * Get the agent definition.
   */
  get agentDefinition(): Readonly<AgentDefinition> {
    return this.definition;
  }

  /**
   * Initialize the agent with dependencies.
   *
   * @pre status === "created"
   * @post status === "ready"
   * @throws InvalidTransitionError if not in "created" state
   */
  async initialize(options: StartOptions): Promise<void> {
    this.stateMachine.transition("initialize");

    try {
      // Build context with initialized components
      this.context = {
        cwd: options.cwd,
        args: options.args,
        plugins: options.plugins ?? [],
      };

      // Initialize components using factories (placeholder for now)
      // These will be properly initialized when we integrate with other layers

      this.stateMachine.transition("start"); // initializing → ready
      await Promise.resolve(); // Ensure async behavior
    } catch (error) {
      this.stateMachine.transition("fail");
      throw error;
    }
  }

  /**
   * Start the agent execution.
   *
   * @pre status === "ready"
   * @post status === "running"
   * @throws InvalidTransitionError if not in "ready" state
   */
  async start(_options: StartOptions): Promise<void> {
    this.stateMachine.transition("start"); // ready → running
    await Promise.resolve(); // Ensure async behavior
  }

  /**
   * Run the agent loop until completion.
   *
   * @pre status === "running"
   * @post status === "completed" or "failed"
   */
  async run(): Promise<AgentResultV2> {
    if (!this.stateMachine.isRunnable()) {
      throw new InvalidTransitionError(this.status, "complete");
    }

    try {
      // Run the loop (will be implemented in Phase 4)
      // For now, just mark as completed

      this.result = {
        success: true,
        reason: "Completed successfully",
        iterations: 0,
      };

      this.stateMachine.transition("complete");
      return this.result;
    } catch (error) {
      this.stateMachine.transition("fail");
      this.result = {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
        iterations: 0,
      };
      return this.result;
    }
  }

  /**
   * Stop the agent and return results.
   *
   * @post status is terminal
   */
  async stop(): Promise<AgentResultV2> {
    if (this.stateMachine.isTerminal()) {
      return (
        this.result ?? {
          success: false,
          reason: "Agent was stopped before completion",
          iterations: 0,
        }
      );
    }

    // Force completion
    if (this.stateMachine.canTransition("complete")) {
      this.stateMachine.transition("complete");
    } else if (this.stateMachine.canTransition("fail")) {
      this.stateMachine.transition("fail");
    }

    await Promise.resolve(); // Ensure async behavior
    return (
      this.result ?? {
        success: false,
        reason: "Agent was stopped",
        iterations: 0,
      }
    );
  }

  /**
   * Get the runtime context.
   * @throws Error if not initialized
   */
  getContext(): LifecycleContext {
    if (!this.context) {
      throw new Error("Agent not initialized");
    }
    return this.context;
  }
}
