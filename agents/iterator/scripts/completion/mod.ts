/**
 * Completion Handler - Module Entry Point
 *
 * Factory function and re-exports for completion handlers.
 */

import type { AgentOptions } from "../types.ts";
import type { CompletionHandler } from "./types.ts";
import { IssueCompletionHandler } from "./issue.ts";
import { ProjectCompletionHandler } from "./project.ts";
import { IterateCompletionHandler } from "./iterate.ts";

/**
 * Create appropriate completion handler based on agent options
 *
 * Factory function that determines which handler to create based on
 * the CLI options provided.
 *
 * Priority:
 * 1. Issue (if --issue specified)
 * 2. Project (if --project specified)
 * 3. Iterate (default, uses --iterate-max)
 *
 * @param options - Agent options from CLI
 * @returns Appropriate CompletionHandler instance
 *
 * @example
 * ```typescript
 * const options: AgentOptions = { issue: 123, iterateMax: Infinity, ... };
 * const handler = createCompletionHandler(options);
 * // Returns IssueCompletionHandler
 * ```
 */
export function createCompletionHandler(
  options: AgentOptions,
): CompletionHandler {
  if (options.issue !== undefined) {
    return new IssueCompletionHandler(options.issue);
  }
  if (options.project !== undefined) {
    return new ProjectCompletionHandler(
      options.project,
      options.label,
      options.includeCompleted ?? false,
      options.projectOwner,
    );
  }
  return new IterateCompletionHandler(options.iterateMax);
}

// Re-export types
export type { CompletionCriteria, CompletionHandler } from "./types.ts";
export { formatIterationSummary } from "./types.ts";
export type { CompletionType } from "./types.ts";

// Re-export handlers for direct use if needed
export { IssueCompletionHandler } from "./issue.ts";
export type { ProjectContext } from "./issue.ts";
export { ProjectCompletionHandler } from "./project.ts";
export { IterateCompletionHandler } from "./iterate.ts";
