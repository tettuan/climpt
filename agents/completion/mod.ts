/**
 * Completion handlers module exports
 */

export type { CompletionCriteria, CompletionHandler } from "./types.ts";
export { BaseCompletionHandler, formatIterationSummary } from "./types.ts";
export type { CompletionType, IterationSummary } from "./types.ts";

export {
  type CompletionHandlerOptions,
  createCompletionHandler,
  createCompletionHandlerFromOptions,
  getRegisteredHandler,
  registerCompletionHandler,
} from "./factory.ts";

export { IssueCompletionHandler, type ProjectContext } from "./issue.ts";

export {
  ProjectCompletionHandler,
  type ProjectIssueInfo,
  type ProjectPhase,
  type ProjectPlan,
  type ReviewResult,
} from "./project.ts";

export { IterateCompletionHandler } from "./iterate.ts";

export { ManualCompletionHandler } from "./manual.ts";
