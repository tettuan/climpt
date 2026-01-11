/**
 * Runner module exports
 */

export { AgentRunner, type RunnerOptions } from "./runner.ts";
export {
  AgentActionError,
  AgentCompletionError,
  AgentError,
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentTimeoutError,
  isAgentError,
  normalizeToAgentError,
} from "./errors.ts";
export {
  type AgentEvent,
  AgentEventEmitter,
  type AgentEventHandler,
  type AgentEventPayloads,
} from "./events.ts";
export {
  agentExists,
  getAgentDir,
  listAgents,
  loadAgentDefinition,
  validateAgentDefinition,
} from "./loader.ts";
export { generateAgentHelp, parseCliArgs, type ParsedCliArgs } from "./cli.ts";

// Builder pattern exports for dependency injection
export {
  type ActionSystemFactory,
  type AgentDependencies,
  AgentRunnerBuilder,
  type CompletionHandlerFactory,
  createDefaultDependencies,
  DefaultActionSystemFactory,
  DefaultCompletionHandlerFactory,
  DefaultLoggerFactory,
  DefaultPromptResolverFactory,
  type LoggerFactory,
  type LoggerFactoryOptions,
  type PromptResolverFactory,
  type PromptResolverFactoryOptions,
} from "./builder.ts";
