/**
 * Environment Errors - Errors related to execution environment and rate limits
 *
 * These errors indicate problems with the execution context:
 * - Environment constraints (double sandbox, permissions)
 * - API rate limiting
 */

import { ClimptError } from "./base.ts";
import type { RateLimitInfo } from "../../src_common/types/runtime.ts";

/**
 * Environment information
 */
export interface EnvironmentInfoType {
  insideClaudeCode: boolean;
  sandboxed: boolean;
  nestLevel: number;
  warnings: string[];
}

/**
 * SDK Error Category type
 */
export type SdkErrorCategoryType =
  | "environment"
  | "network"
  | "api"
  | "input"
  | "internal"
  | "unknown";

/**
 * Environment constraint error (e.g., double sandbox)
 *
 * This error indicates the execution environment does not support
 * SDK operations. It is not recoverable without changing the
 * execution context.
 */
export class AgentEnvironmentError extends ClimptError {
  readonly code = "AGENT_ENVIRONMENT_ERROR";
  readonly recoverable = false;
  readonly category: SdkErrorCategoryType;
  readonly guidance: string;
  readonly environment: EnvironmentInfoType;

  constructor(
    message: string,
    options: {
      category: SdkErrorCategoryType;
      guidance: string;
      environment: EnvironmentInfoType;
      cause?: Error;
      iteration?: number;
    },
  ) {
    super(message, { cause: options.cause, iteration: options.iteration });
    this.category = options.category;
    this.guidance = options.guidance;
    this.environment = options.environment;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      category: this.category,
      guidance: this.guidance,
      environment: this.environment,
    };
  }
}

/**
 * Rate limit error
 *
 * This error indicates the API rate limit has been reached.
 * The agent should wait before retrying.
 */
export class AgentRateLimitError extends ClimptError {
  readonly code = "AGENT_RATE_LIMIT";
  readonly recoverable = true;
  readonly retryAfterMs: number;
  readonly attempts: number;
  /**
   * Rate-limit reset signal carried with the error so the orchestrator's
   * Step 7c throttle hook can wait until the next reset even when no SDK
   * `rate_limit_event` was streamed before the actual 429.
   */
  readonly rateLimitInfo?: RateLimitInfo;

  constructor(
    message: string,
    options: {
      retryAfterMs?: number;
      attempts?: number;
      rateLimitInfo?: RateLimitInfo;
      cause?: Error;
      iteration?: number;
    } = {},
  ) {
    super(message, { cause: options.cause, iteration: options.iteration });
    this.retryAfterMs = options.retryAfterMs ?? 0;
    this.attempts = options.attempts ?? 0;
    this.rateLimitInfo = options.rateLimitInfo;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      retryAfterMs: this.retryAfterMs,
      attempts: this.attempts,
      ...(this.rateLimitInfo && { rateLimitInfo: this.rateLimitInfo }),
    };
  }
}
