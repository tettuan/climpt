/**
 * Error Reporter
 *
 * Generates structured error reports with user-friendly output.
 * Provides guidance and suggestions for error resolution.
 */

import type { ClassifiedError } from "./error-classifier.ts";
import { SdkErrorCategory } from "./error-classifier.ts";
import type { EnvironmentInfo } from "./environment-checker.ts";

/**
 * Context for error reporting
 */
export interface ErrorContext {
  /** Agent name */
  agentName: string;
  /** Current iteration */
  iteration: number;
  /** Environment information */
  environment: EnvironmentInfo;
  /** Number of retry attempts made */
  retryAttempts: number;
}

/**
 * Structured error report
 */
export interface ErrorReport {
  /** Timestamp of error */
  timestamp: string;
  /** Error category */
  category: SdkErrorCategory;
  /** Error message */
  message: string;
  /** User guidance */
  guidance: string;
  /** Context information */
  context: {
    agentName: string;
    iteration: number;
    environment: EnvironmentInfo;
  };
  /** Recovery information */
  recovery: {
    attempted: boolean;
    attempts: number;
    succeeded: boolean;
  };
  /** Suggested actions */
  suggestions: string[];
}

/**
 * Generate suggestions based on error category
 */
function generateSuggestions(error: ClassifiedError): string[] {
  const suggestions: string[] = [];

  switch (error.category) {
    case SdkErrorCategory.ENVIRONMENT:
      suggestions.push(
        "1. Run from terminal: deno task agents:run --agent <name> --issue <num>",
        "2. Disable sandbox: use dangerouslyDisableSandbox: true",
        "3. Run in CI: use GitHub Actions",
      );
      break;

    case SdkErrorCategory.NETWORK:
      suggestions.push(
        "1. Check network connection",
        "2. Check VPN or proxy settings",
        "3. Wait and retry",
      );
      break;

    case SdkErrorCategory.API:
      if (error.original.message?.includes("rate")) {
        suggestions.push(
          "1. Wait a few minutes and retry",
          "2. Reduce request frequency",
          "3. Use a different API key",
        );
      } else {
        suggestions.push(
          "1. Verify API key is valid",
          "2. Reconfigure authentication",
          "3. Check Anthropic dashboard",
        );
      }
      break;

    case SdkErrorCategory.INPUT:
      suggestions.push(
        "1. Check prompt length",
        "2. Validate input format",
        "3. Check for special characters",
      );
      break;

    case SdkErrorCategory.INTERNAL:
      suggestions.push(
        "1. Wait and retry",
        "2. Check Anthropic status page",
        "3. Contact support if issue persists",
      );
      break;

    default:
      suggestions.push(
        "1. Check logs for details",
        "2. Reproduce issue to identify cause",
        "3. Contact support if needed",
      );
  }

  return suggestions;
}

/**
 * Generate a structured error report
 */
export function generateErrorReport(
  error: ClassifiedError,
  context: ErrorContext,
): ErrorReport {
  return {
    timestamp: new Date().toISOString(),
    category: error.category,
    message: error.original.message ?? "Unknown error",
    guidance: error.guidance,
    context: {
      agentName: context.agentName,
      iteration: context.iteration,
      environment: context.environment,
    },
    recovery: {
      attempted: context.retryAttempts > 0,
      attempts: context.retryAttempts,
      succeeded: false,
    },
    suggestions: generateSuggestions(error),
  };
}

/**
 * Format error report for user display
 */
export function formatErrorForUser(report: ErrorReport): string {
  const lines: string[] = [
    "",
    "===========================================================",
    "  Error: " + report.message,
    "  Category: " + report.category,
    "===========================================================",
    "",
    "  Guidance:",
    "     " + report.guidance,
    "",
  ];

  if (report.suggestions.length > 0) {
    lines.push("  Suggested Actions:");
    for (const suggestion of report.suggestions) {
      lines.push("     " + suggestion);
    }
    lines.push("");
  }

  if (report.recovery.attempted) {
    lines.push(
      "  Retry: " + report.recovery.attempts + " attempts made",
      "",
    );
  }

  // Add environment info for environment errors
  if (report.category === SdkErrorCategory.ENVIRONMENT) {
    const env = report.context.environment;
    lines.push(
      "  Detected Environment:",
      "     - Inside Claude Code: " + (env.insideClaudeCode ? "yes" : "no"),
      "     - Sandbox: " + (env.sandboxed ? "enabled" : "disabled"),
      "     - Nest level: " + env.nestLevel,
      "",
    );
  }

  return lines.join("\n");
}

/**
 * Format error report as JSON for logging
 */
export function formatErrorAsJson(report: ErrorReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Create a minimal error summary for compact logging
 */
export function formatErrorSummary(report: ErrorReport): string {
  const retryInfo = report.recovery.attempted
    ? " (" + report.recovery.attempts + " retries)"
    : "";
  return "[" + report.category + "] " + report.message + retryInfo;
}

/**
 * Log entry structure for error logging
 */
export interface ErrorLogEntry {
  level: "error";
  timestamp: string;
  message: string;
  data: {
    code: string;
    category: SdkErrorCategory;
    message: string;
    guidance: string;
    recoverable: boolean;
    iteration?: number;
    environment?: EnvironmentInfo;
    stack?: string;
  };
}

/**
 * Create a log entry for structured logging
 */
export function createErrorLogEntry(
  error: ClassifiedError,
  context: ErrorContext,
): ErrorLogEntry {
  return {
    level: "error",
    timestamp: new Date().toISOString(),
    message: error.original.message ?? "Unknown error",
    data: {
      code: "SDK_" + error.category.toUpperCase() + "_ERROR",
      category: error.category,
      message: error.original.message ?? "Unknown error",
      guidance: error.guidance,
      recoverable: error.recoverable,
      iteration: context.iteration,
      environment: context.environment,
      stack: error.original.stack,
    },
  };
}
