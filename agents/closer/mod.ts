/**
 * Closer Module
 *
 * Completion judgment subsystem using AI structured outputs.
 *
 * ## Usage
 *
 * ```typescript
 * import { createCloser } from "./agents/closer/mod.ts";
 *
 * const closer = createCloser({
 *   workingDir: Deno.cwd(),
 *   agentId: "iterator",
 * });
 *
 * const result = await closer.check(
 *   {
 *     structuredOutput: aiResponse.structured_output,
 *     stepId: "complete.issue",
 *     c3l: { c2: "complete", c3: "issue" },
 *   },
 *   queryFn
 * );
 *
 * if (result.complete) {
 *   // All done
 * } else {
 *   // Check result.output.pendingActions
 * }
 * ```
 *
 * ## API
 *
 * ### Input
 * - `structuredOutput`: AI's structured output from previous step
 * - `stepId`: Step identifier for context
 * - `c3l`: C3L path components for prompt resolution
 *
 * ### Output
 * - `complete`: Whether completion is achieved
 * - `output.checklist`: Task list with completion status
 * - `output.pendingActions`: Required actions if not complete
 *
 * ## Design
 *
 * All completion judgment is done by AI via structured output.
 * System does NOT parse runtime-specific output (test runners, etc.).
 */

export { Closer, createCloser } from "./closer.ts";
export type {
  ChecklistItem,
  CloserInput,
  CloserLogger,
  CloserOptions,
  CloserQueryFn,
  CloserResult,
  CloserStructuredOutput,
} from "./types.ts";
export { CLOSER_OUTPUT_SCHEMA } from "./types.ts";
