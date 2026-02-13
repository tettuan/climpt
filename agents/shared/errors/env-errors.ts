/**
 * Environment Errors - Errors related to execution environment and rate limits
 *
 * These errors indicate problems with the execution context:
 * - Environment constraints (double sandbox, permissions)
 * - API rate limiting
 * - Configuration loading failures
 * - Prompt not found
 */

import { ClimptError } from "./base.ts";

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

  constructor(
    message: string,
    options: {
      retryAfterMs?: number;
      attempts?: number;
      cause?: Error;
      iteration?: number;
    } = {},
  ) {
    super(message, { cause: options.cause, iteration: options.iteration });
    this.retryAfterMs = options.retryAfterMs ?? 0;
    this.attempts = options.attempts ?? 0;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      retryAfterMs: this.retryAfterMs,
      attempts: this.attempts,
    };
  }
}

/**
 * Error thrown when configuration loading fails.
 */
export class ConfigurationLoadError extends ClimptError {
  readonly code = "CONFIGURATION_LOAD_ERROR";
  readonly recoverable = false;
  readonly path: string;
  readonly originalCause?: Error;

  constructor(
    path: string,
    message: string,
    cause?: Error,
  ) {
    super(`Configuration load failed at ${path}: ${message}`, { cause });
    this.path = path;
    this.originalCause = cause;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      path: this.path,
    };
  }
}

/**
 * Error thrown when a prompt is not found.
 */
export class PromptNotFoundError extends ClimptError {
  readonly code = "PROMPT_NOT_FOUND";
  readonly recoverable = false;
  readonly path: string;

  constructor(path: string) {
    super(`Prompt not found: ${path}`);
    this.path = path;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      path: this.path,
    };
  }
}
