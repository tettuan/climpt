/**
 * Completion handlers module exports
 */

export type { CompletionCriteria, CompletionHandler } from "./types.ts";
export { BaseCompletionHandler } from "./types.ts";

export {
  createCompletionHandler,
  getRegisteredHandler,
  registerCompletionHandler,
} from "./factory.ts";

export { IssueCompletionHandler, type IssueHandlerOptions } from "./issue.ts";

export {
  ProjectCompletionHandler,
  type ProjectHandlerOptions,
} from "./project.ts";

export {
  IterateCompletionHandler,
  type IterateHandlerOptions,
} from "./iterate.ts";

export {
  ManualCompletionHandler,
  type ManualHandlerOptions,
} from "./manual.ts";
