/**
 * Lifecycle Module - Entry Point
 *
 * @experimental This module is experimental and subject to change.
 * The lifecycle layer is planned for v2 architecture but not yet integrated
 * into the main AgentRunner. Do not depend on this API in production code.
 */

export { AgentStateMachine, InvalidTransitionError } from "./state-machine.ts";
export type { AgentStatus, LifecycleAction } from "./state-machine.ts";

export { AgentLifecycle } from "./agent-lifecycle.ts";
export type { LifecycleContext, LifecycleOptions } from "./agent-lifecycle.ts";
