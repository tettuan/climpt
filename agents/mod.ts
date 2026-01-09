/**
 * Agents Module
 *
 * Autonomous agents for development tasks using Claude Agent SDK.
 */

// Common types and utilities (existing)
export * from "./common/mod.ts";

// New agent framework exports (excluding conflicting names)
// Use src_mod.ts for direct imports of the new framework
export {
  // Actions
  type ActionContext,
  ActionDetector,
  ActionExecutor,
  type ActionHandler,
  agentExists,
  // Runner
  AgentRunner,
  BaseActionHandler,
  BaseCompletionHandler,
  // Completion
  type CompletionCriteria,
  type CompletionHandler,
  type CompletionHandlerOptions,
  createCompletionHandler,
  createCompletionHandlerFromOptions,
  type ExecutorOptions,
  FileActionHandler,
  generateAgentHelp,
  getAgentDir,
  getRegisteredHandler,
  GitHubCommentHandler,
  type GitHubContext,
  GitHubIssueHandler,
  // Init and CLI
  initAgent,
  IssueCompletionHandler,
  IterateCompletionHandler,
  listAgents,
  loadAgentDefinition,
  LogActionHandler,
  ManualCompletionHandler,
  parseCliArgs,
  type ParsedCliArgs,
  ProjectCompletionHandler,
  registerCompletionHandler,
  run,
  type RunnerOptions,
  validateAgentDefinition,
} from "./src_mod.ts";

// To run agents, use the unified runner:
//   deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123
//   deno run -A agents/scripts/run-agent.ts --agent reviewer --project 5
//
// Or programmatically:
//   const definition = await loadAgentDefinition("iterator", Deno.cwd());
//   const runner = new AgentRunner(definition);
//   await runner.run({ args: { issue: 123 }, plugins: [] });
