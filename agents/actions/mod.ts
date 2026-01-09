/**
 * Actions module exports
 */

export type {
  ActionConfig,
  ActionContext,
  ActionHandler,
  ActionResult,
  DetectedAction,
  GitHubContext,
} from "./types.ts";
export { BaseActionHandler } from "./types.ts";

export { ActionDetector } from "./detector.ts";
export { ActionExecutor, type ExecutorOptions } from "./executor.ts";

// Built-in handlers
export { LogActionHandler } from "./handlers/log.ts";
export {
  GitHubCommentHandler,
  GitHubIssueHandler,
} from "./handlers/github_issue.ts";
export { FileActionHandler } from "./handlers/file.ts";
