/**
 * Subprocess Runner for closure steps (Phase 0-c).
 *
 * When a closure step declares a `runner` spec (command/args/timeout),
 * the AgentRunner delegates execution here instead of calling the LLM.
 * This provides a deterministic side-effect boundary — e.g., merge-pr.ts —
 * that escapes the LLM non-determinism while still participating in the
 * closure lifecycle (boundary hooks, structured output).
 *
 * Responsibilities:
 * - Template substitution: `${context.<key>}` → context values
 * - Subprocess spawn with AbortSignal.timeout
 * - stdout JSON parse (fallback to `{ raw }` when not JSON)
 * - stderr forwarding to agent logger
 *
 * @see docs/internal/pr-merger-design/ Phase 0-b/0-c
 */

import type { StepSubprocessRunner } from "../common/step-registry/types.ts";

/** Default subprocess timeout when runner.timeout is not set. */
export const DEFAULT_SUBPROCESS_TIMEOUT_MS = 30_000;

/** Pattern used to detect `${context.<key>}` templates. */
const CONTEXT_TEMPLATE_RE = /\$\{context\.([^}]+)\}/g;

export interface SubprocessRunnerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface SubprocessRunResult {
  /** Exit code (0 = success) */
  exitCode: number;
  /** Raw stdout string (decoded utf-8) */
  stdout: string;
  /** Raw stderr string (decoded utf-8) */
  stderr: string;
  /** Parsed stdout: JSON object if parse succeeded, else `{ raw: stdout }` */
  structuredOutput: Record<string, unknown>;
  /** Whether the timeout fired (process aborted) */
  timedOut: boolean;
}

/**
 * Command runner abstraction — allows tests to inject a stub without
 * spawning real subprocesses.
 */
export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options: { signal: AbortSignal },
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
}

/** Default CommandRunner backed by Deno.Command. */
export const defaultCommandRunner: CommandRunner = {
  async run(
    command: string,
    args: string[],
    { signal }: { signal: AbortSignal },
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
    const cmd = new Deno.Command(command, {
      args,
      stdout: "piped",
      stderr: "piped",
      signal,
    });
    const output = await cmd.output();
    return { code: output.code, stdout: output.stdout, stderr: output.stderr };
  },
};

/**
 * Substitute `${context.<key>}` placeholders in args using the given context.
 *
 * - Resolves the whole placeholder to String(context[key]).
 * - Throws when a referenced key is absent from context (fail-fast:
 *   unresolved templates indicate a design bug, not a user input issue).
 * - Values of null/undefined are treated as unresolved even if the key
 *   exists (全域性: refuse ambiguous resolution).
 */
export function substituteContextTemplates(
  args: readonly string[],
  context: Readonly<Record<string, unknown>>,
): string[] {
  return args.map((arg) => {
    return arg.replace(CONTEXT_TEMPLATE_RE, (_match, rawKey: string) => {
      const key = rawKey.trim();
      if (!(key in context)) {
        throw new Error(`Unresolved template: \${context.${key}}`);
      }
      const value = context[key];
      if (value === null || value === undefined) {
        throw new Error(`Unresolved template: \${context.${key}}`);
      }
      return String(value);
    });
  });
}

/**
 * Parse stdout as JSON. When parse fails, wrap as `{ raw: stdout }` so
 * downstream consumers (VerdictHandler.onBoundaryHook) always receive an
 * object shape.
 */
export function parseStructuredStdout(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { raw: stdout };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    // Preserve non-object JSON (arrays, primitives) under a field
    return { raw: stdout, parsed };
  } catch {
    return { raw: stdout };
  }
}

/**
 * Execute a closure step subprocess runner.
 *
 * Performs template substitution, spawns the subprocess with a timeout,
 * forwards stderr to the logger, and returns a structured result.
 *
 * @throws Error if template substitution fails (unresolved placeholder).
 */
export async function runSubprocessRunner(
  spec: StepSubprocessRunner,
  context: Readonly<Record<string, unknown>>,
  logger: SubprocessRunnerLogger,
  options: { commandRunner?: CommandRunner } = {},
): Promise<SubprocessRunResult> {
  const substitutedArgs = substituteContextTemplates(spec.args, context);
  const timeoutMs = spec.timeout ?? DEFAULT_SUBPROCESS_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const runner = options.commandRunner ?? defaultCommandRunner;

  logger.info("[SubprocessRunner] Spawn", {
    command: spec.command,
    args: substitutedArgs,
    timeoutMs,
  });

  const decoder = new TextDecoder();
  let timedOut = false;
  let code: number;
  let stdoutBytes: Uint8Array;
  let stderrBytes: Uint8Array;

  try {
    const result = await runner.run(spec.command, substitutedArgs, { signal });
    code = result.code;
    stdoutBytes = result.stdout;
    stderrBytes = result.stderr;
  } catch (err) {
    // AbortSignal.timeout produces a DOMException with name "TimeoutError".
    // Any abort-triggered failure is treated as timeout.
    if (signal.aborted) {
      timedOut = true;
      logger.warn("[SubprocessRunner] Timeout", {
        command: spec.command,
        timeoutMs,
      });
    }
    throw err instanceof Error && timedOut
      ? new Error(
        `Subprocess timed out after ${timeoutMs}ms: ${spec.command}`,
        { cause: err },
      )
      : err;
  }

  const stdout = decoder.decode(stdoutBytes);
  const stderr = decoder.decode(stderrBytes);

  if (stderr.length > 0) {
    logger.warn("[SubprocessRunner] stderr", {
      command: spec.command,
      stderr,
    });
  }

  if (code !== 0) {
    logger.error("[SubprocessRunner] Non-zero exit", {
      command: spec.command,
      exitCode: code,
    });
  } else {
    logger.info("[SubprocessRunner] Exit 0", { command: spec.command });
  }

  const structuredOutput = parseStructuredStdout(stdout);

  return {
    exitCode: code,
    stdout,
    stderr,
    structuredOutput,
    timedOut,
  };
}
