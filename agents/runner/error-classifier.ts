/**
 * SDK Error Classifier
 *
 * Classifies SDK errors into categories with recovery guidance.
 * Used to provide appropriate error handling and user feedback.
 */

/**
 * Error categories for SDK errors
 */
export enum SdkErrorCategory {
  /** Environment constraints (double sandbox, permissions) */
  ENVIRONMENT = "environment",
  /** Network issues (timeout, unreachable) */
  NETWORK = "network",
  /** API issues (rate limit, authentication) */
  API = "api",
  /** Input issues (invalid prompt) */
  INPUT = "input",
  /** Internal errors (SDK bugs) */
  INTERNAL = "internal",
  /** Unclassifiable */
  UNKNOWN = "unknown",
}

/**
 * Pattern definition for error classification
 */
interface ErrorPattern {
  patterns: RegExp[];
  category: SdkErrorCategory;
  recoverable: boolean;
  guidance: string;
}

/**
 * Classified error with metadata
 */
export interface ClassifiedError {
  /** Original error */
  original: Error;
  /** Error category */
  category: SdkErrorCategory;
  /** Whether error is recoverable (e.g., can retry) */
  recoverable: boolean;
  /** User guidance for resolution */
  guidance: string;
  /** Pattern that matched (for debugging) */
  matchedPattern: string | null;
}

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  // Double sandbox / process spawn issues
  {
    patterns: [
      /Claude Code process exited with code 1/i,
      /spawn.*claude.*ENOENT/i,
      /cannot spawn process/i,
      /process exited with code/i,
    ],
    category: SdkErrorCategory.ENVIRONMENT,
    recoverable: false,
    guidance:
      "Run agent from terminal directly or use dangerouslyDisableSandbox: true",
  },

  // Permission denied / sandbox violations
  {
    patterns: [
      /permission denied/i,
      /EACCES/i,
      /sandbox.*violation/i,
      /EPERM.*operation not permitted/i,
      /operation not permitted/i,
    ],
    category: SdkErrorCategory.ENVIRONMENT,
    recoverable: false,
    guidance: "Check sandbox settings: see /git-gh-sandbox skill",
  },

  // Network errors (recoverable)
  {
    patterns: [
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /network.*unreachable/i,
      /socket hang up/i,
      /ECONNRESET/i,
    ],
    category: SdkErrorCategory.NETWORK,
    recoverable: true,
    guidance: "Check network connection. Will retry for transient issues",
  },

  // API rate limiting (recoverable)
  {
    patterns: [
      /rate.?limit/i,
      /429/i,
      /too many requests/i,
      /You've hit your limit/i,
      /resets.*\d+am/i, // Claude Code specific rate limit message
      /usage limit/i,
    ],
    category: SdkErrorCategory.API,
    recoverable: true,
    guidance: "API rate limit reached. Please wait and retry",
  },

  // Authentication errors (not recoverable without user action)
  {
    patterns: [
      /unauthorized/i,
      /401/i,
      /authentication.*failed/i,
      /invalid.*api.*key/i,
    ],
    category: SdkErrorCategory.API,
    recoverable: false,
    guidance: "Check API key or authentication credentials",
  },

  // Input validation errors
  {
    patterns: [
      /invalid.*prompt/i,
      /prompt.*too.*long/i,
      /malformed.*request/i,
      /400.*bad request/i,
    ],
    category: SdkErrorCategory.INPUT,
    recoverable: false,
    guidance: "Check input prompt",
  },

  // Internal/SDK errors
  {
    patterns: [
      /internal.*error/i,
      /500.*internal server/i,
      /SDK.*error/i,
      /unexpected.*state/i,
    ],
    category: SdkErrorCategory.INTERNAL,
    recoverable: true,
    guidance: "Internal error occurred. Please retry",
  },
];

/**
 * Classify an SDK error into a category with guidance
 */
export function classifySdkError(error: Error): ClassifiedError {
  const message = error.message ?? "";
  const errorString = String(error);

  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(message) || regex.test(errorString)) {
        return {
          original: error,
          category: pattern.category,
          recoverable: pattern.recoverable,
          guidance: pattern.guidance,
          matchedPattern: regex.source,
        };
      }
    }
  }

  return {
    original: error,
    category: SdkErrorCategory.UNKNOWN,
    recoverable: false,
    guidance: "Unexpected error occurred. Check logs for details",
    matchedPattern: null,
  };
}

/**
 * Check if an error category is environment-related
 */
export function isEnvironmentError(category: SdkErrorCategory): boolean {
  return category === SdkErrorCategory.ENVIRONMENT;
}

/**
 * Check if an error category is network-related
 */
export function isNetworkError(category: SdkErrorCategory): boolean {
  return category === SdkErrorCategory.NETWORK;
}

/**
 * Check if an error category is API-related
 */
export function isApiError(category: SdkErrorCategory): boolean {
  return category === SdkErrorCategory.API;
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: Error | string): boolean {
  const message = typeof error === "string" ? error : error.message ?? "";
  const patterns = [
    /rate.?limit/i,
    /429/i,
    /too many requests/i,
    /You've hit your limit/i,
    /resets.*\d+am/i,
    /usage limit/i,
  ];
  return patterns.some((p) => p.test(message));
}

/**
 * Calculate exponential backoff delay for retries
 *
 * @param attempt - Current attempt number (0-based)
 * @param baseMs - Base delay in milliseconds (default 5000)
 * @param maxMs - Maximum delay in milliseconds (default 60000)
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  baseMs = 5000,
  maxMs = 60000,
): number {
  const delay = baseMs * Math.pow(2, attempt);
  return Math.min(delay, maxMs);
}
