/**
 * Environment Checker
 *
 * Detects runtime environment to identify potential issues
 * like double sandbox before SDK query execution.
 */

/**
 * Runtime environment information
 */
export interface EnvironmentInfo {
  /** Running inside Claude Code session */
  insideClaudeCode: boolean;
  /** Sandbox is enabled in current environment */
  sandboxed: boolean;
  /** Nesting level (0 = direct execution, 1+ = nested) */
  nestLevel: number;
  /** Warning messages */
  warnings: string[];
  /** Raw environment variables for debugging */
  rawEnv?: Record<string, string | undefined>;
}

/**
 * Environment check result with actionable guidance
 */
export interface EnvironmentCheckResult {
  /** Whether execution can proceed */
  canProceed: boolean;
  /** Environment information */
  environment: EnvironmentInfo;
  /** Error message if cannot proceed */
  error?: string;
  /** Guidance for resolution */
  guidance?: string;
}

/**
 * Detect the current runtime environment
 */
export function detectEnvironment(): EnvironmentInfo {
  const warnings: string[] = [];

  // Detect Claude Code session
  const insideClaudeCode = Deno.env.get("CLAUDE_CODE") === "1" ||
    Deno.env.get("ANTHROPIC_CLI") === "1" ||
    !!Deno.env.get("CLAUDE_SESSION_ID");

  // Detect sandbox environment
  const sandboxed = Deno.env.get("SANDBOX_ENABLED") === "true" ||
    !!Deno.env.get("SANDBOX_ID") ||
    !!Deno.env.get("SANDBOX_ALLOWED_PATHS");

  // Get nesting level
  const nestLevel = parseInt(Deno.env.get("CLAUDE_NEST_LEVEL") ?? "0", 10);

  // Generate warnings
  if (insideClaudeCode && sandboxed) {
    warnings.push(
      "Running in double sandbox environment. SDK query() may fail.",
    );
  }

  if (nestLevel > 0) {
    warnings.push(
      "Running in nested Claude Code session (level " + nestLevel + ").",
    );
  }

  return {
    insideClaudeCode,
    sandboxed,
    nestLevel,
    warnings,
  };
}

/**
 * Detect environment with debug info (includes raw env vars)
 */
export function detectEnvironmentDebug(): EnvironmentInfo {
  const env = detectEnvironment();

  return {
    ...env,
    rawEnv: {
      CLAUDE_CODE: Deno.env.get("CLAUDE_CODE"),
      ANTHROPIC_CLI: Deno.env.get("ANTHROPIC_CLI"),
      CLAUDE_SESSION_ID: Deno.env.get("CLAUDE_SESSION_ID"),
      SANDBOX_ENABLED: Deno.env.get("SANDBOX_ENABLED"),
      SANDBOX_ID: Deno.env.get("SANDBOX_ID"),
      CLAUDE_NEST_LEVEL: Deno.env.get("CLAUDE_NEST_LEVEL"),
    },
  };
}

/**
 * Check if environment allows SDK execution
 */
export function checkEnvironmentForSdk(): EnvironmentCheckResult {
  const environment = detectEnvironment();

  // Double sandbox is a blocking issue
  if (environment.insideClaudeCode && environment.sandboxed) {
    return {
      canProceed: false,
      environment,
      error: "Cannot execute SDK query() in double sandbox environment",
      guidance:
        "Run from terminal directly or use dangerouslyDisableSandbox: true",
    };
  }

  // Deep nesting may cause issues but we can try
  if (environment.nestLevel > 1) {
    return {
      canProceed: true,
      environment,
      guidance:
        "Running at deep nesting level. Try direct execution if issues occur",
    };
  }

  return {
    canProceed: true,
    environment,
  };
}

/**
 * Format environment info for logging
 */
export function formatEnvironmentInfo(env: EnvironmentInfo): string {
  const lines = [
    "Inside Claude Code: " + (env.insideClaudeCode ? "yes" : "no"),
    "Sandbox: " + (env.sandboxed ? "enabled" : "disabled"),
    "Nest level: " + env.nestLevel,
  ];

  if (env.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of env.warnings) {
      lines.push("  - " + warning);
    }
  }

  return lines.join("\n");
}
