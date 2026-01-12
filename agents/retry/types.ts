/**
 * RetryHandler Types
 *
 * Type definitions for retry prompt generation.
 */

import type { Logger } from "../src_common/logger.ts";

// Re-export common types
export type {
  CompletionPattern,
  CompletionStepConfig,
  ExtendedStepsRegistry,
  ValidatorResult,
} from "../common/completion-types.ts";

/**
 * RetryHandler context
 */
export interface RetryHandlerContext {
  /** Working directory */
  workingDir: string;
  /** Logger */
  logger: Logger;
  /** Agent ID */
  agentId: string;
}

/**
 * C3L path resolution options
 */
export interface C3LResolveOptions {
  /** C3L c1 component */
  c1: string;
  /** C3L c2 component */
  c2: string;
  /** C3L c3 component */
  c3: string;
  /** C3L edition component */
  edition: string;
  /** C3L adaptation component (optional) */
  adaptation?: string;
}

/**
 * Retry prompt generation result
 */
export interface RetryPromptResult {
  /** Generated prompt */
  prompt: string;
  /** Used pattern */
  pattern: string;
  /** Injected parameters */
  params: Record<string, unknown>;
}
