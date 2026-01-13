/**
 * Agent State Machine - State Transition Management
 *
 * @experimental This module is experimental and subject to change.
 *
 * State transitions: Created -> Initializing -> Ready -> Running -> Completed/Failed
 * Only forward transitions allowed (no reuse)
 */

export type AgentStatus =
  | "created"
  | "initializing"
  | "ready"
  | "running"
  | "completed"
  | "failed";

export type LifecycleAction =
  | "initialize"
  | "start"
  | "complete"
  | "fail";

/**
 * Valid state transitions
 */
const TRANSITIONS: Record<
  AgentStatus,
  Partial<Record<LifecycleAction, AgentStatus>>
> = {
  created: { initialize: "initializing" },
  initializing: { start: "ready", fail: "failed" },
  ready: { start: "running" },
  running: { complete: "completed", fail: "failed" },
  completed: {},
  failed: {},
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly currentStatus: AgentStatus,
    public readonly action: LifecycleAction,
  ) {
    super(`Invalid transition: cannot ${action} from ${currentStatus}`);
    this.name = "InvalidTransitionError";
  }
}

export class AgentStateMachine {
  private _status: AgentStatus = "created";

  get status(): AgentStatus {
    return this._status;
  }

  /**
   * Check if a transition is valid without performing it.
   */
  canTransition(action: LifecycleAction): boolean {
    return TRANSITIONS[this._status][action] !== undefined;
  }

  /**
   * Perform a state transition.
   * @throws InvalidTransitionError if transition is not allowed
   */
  transition(action: LifecycleAction): AgentStatus {
    const nextStatus = TRANSITIONS[this._status][action];

    if (!nextStatus) {
      throw new InvalidTransitionError(this._status, action);
    }

    this._status = nextStatus;
    return this._status;
  }

  /**
   * Check if agent is in a terminal state.
   */
  isTerminal(): boolean {
    return this._status === "completed" || this._status === "failed";
  }

  /**
   * Check if agent can accept new work.
   */
  isRunnable(): boolean {
    return this._status === "running";
  }
}
