/**
 * C3L Prompt Loader - Load prompts using @tettuan/breakdown with return mode
 *
 * Uses the breakdown library to:
 * - Resolve prompt files in C3L format ({c1}/{c2}/{c3}/f_{edition}.md)
 * - Substitute UV variables ({uv-xxx})
 * - Handle STDIN for {input_text}
 *
 * This replaces the PromptResolver implementation with the actual breakdown library.
 */

import { BREAKDOWN_VERSION } from "../../src/version.ts";

/**
 * C3L path components
 */
export interface C3LPath {
  /** Command level 1 (e.g., "dev", "steps") */
  c1: string;
  /** Command level 2 (e.g., "start", "review", "initial", "continuation") */
  c2: string;
  /** Command level 3 (e.g., "issue", "project", "iterate") */
  c3: string;
  /** Edition (e.g., "default", "processing", "preparation") */
  edition?: string;
  /** Adaptation (e.g., "empty", "done") - for variant prompts */
  adaptation?: string;
}

/**
 * Variables for prompt substitution
 */
export interface PromptVariables {
  /** UV variables (key without "uv-" prefix, value is the substitution) */
  uv?: Record<string, string>;
  /** Input text for {input_text} placeholder (passed via STDIN to breakdown) */
  inputText?: string;
}

/**
 * Discriminated error kinds returned by breakdown 1.8.6+ via runBreakdown.
 *
 * Mirrors the (un-exported) `BreakdownError` union in
 * jsr:@tettuan/breakdown@{@link BREAKDOWN_VERSION}/cli/breakdown.ts. When the
 * upstream union grows, also widen this list and the discriminated handling
 * in {@link PromptResolver}.
 *
 * @see https://github.com/tettuan/breakdown/issues/104
 */
export type BreakdownErrorKind =
  | "ConfigProfileError"
  | "ConfigLoadError"
  | "ParameterParsingError"
  | "PromptGenerationError"
  | "TwoParamsHandlerError"
  | "OneParamsHandlerError"
  | "ZeroParamsHandlerError"
  | "UnknownResultType"
  // Nested PromptError kinds surfaced when the outer kind is
  // "PromptGenerationError" — the loader unwraps these so callers see the
  // underlying cause directly.
  | "TemplateNotFound"
  | "InvalidVariables"
  | "SchemaError"
  | "InvalidPath"
  | "TemplateParseError"
  | "ConfigurationError";

/**
 * Result of loading a prompt
 */
export interface PromptLoadResult {
  /** Whether the load was successful */
  ok: boolean;
  /** Loaded prompt content (with variables substituted) */
  content?: string;
  /** Error message if load failed (formatted from breakdown's structured error). */
  error?: string;
  /**
   * Discriminated error kind from breakdown 1.8.6+. Present iff `ok === false`
   * and breakdown returned a structured error. Callers should branch on this
   * (not on substring matches against `error`).
   */
  errorKind?: BreakdownErrorKind;
  /** Full path to the resolved prompt file */
  promptPath?: string;
}

/**
 * Options for C3LPromptLoader
 */
export interface C3LPromptLoaderOptions {
  /** Agent ID (e.g., "iterator", "reviewer") */
  agentId: string;
  /** Config name suffix (e.g., "dev" results in config="iterator-dev") */
  configSuffix?: string;
  /** Working directory (defaults to project root derived from module location) */
  workingDir?: string;
}

/**
 * C3LPromptLoader - Load prompts using @tettuan/breakdown
 *
 * Usage:
 * ```typescript
 * const loader = new C3LPromptLoader({ agentId: "iterator", configSuffix: "dev" });
 * const result = await loader.load(
 *   { c1: "dev", c2: "start", c3: "issue" },
 *   { uv: { agent_name: "climpt" }, inputText: "completion criteria" }
 * );
 * if (result.ok) {
 *   console.log(result.content);
 * }
 * ```
 */
/** Project root derived from module location — immune to Deno.cwd() corruption */
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

/**
 * Structural mirror of breakdown 1.8.6+ `Result<string | undefined, BreakdownError>`.
 *
 * BreakdownError and PromptError are NOT exported from
 * jsr:@tettuan/breakdown (only `runBreakdown` is exported via mod.ts), so we
 * inline the shape here. Keep in sync with
 * jsr:@tettuan/breakdown@{@link BREAKDOWN_VERSION}/cli/breakdown.ts and
 * jsr:@tettuan/breakdown@{@link BREAKDOWN_VERSION}/lib/types/prompt_types.ts.
 */
type PromptErrorShape =
  | {
    kind: "TemplateNotFound";
    path: string;
    workingDir?: string;
    attemptedPaths?: string[];
  }
  | { kind: "InvalidVariables"; details: string[] }
  | { kind: "SchemaError"; schema: string; error: string }
  | { kind: "InvalidPath"; message: string }
  | { kind: "TemplateParseError"; template: string; error: string }
  | { kind: "ConfigurationError"; message: string };

type BreakdownErrorShape =
  | { kind: "ConfigProfileError"; message: string; cause: unknown }
  | { kind: "ConfigLoadError"; message: string }
  | { kind: "ParameterParsingError"; message: string }
  | { kind: "PromptGenerationError"; cause: PromptErrorShape | string }
  | { kind: "TwoParamsHandlerError"; cause: unknown }
  | { kind: "OneParamsHandlerError"; cause: unknown }
  | { kind: "ZeroParamsHandlerError"; cause: unknown }
  | { kind: "UnknownResultType"; type: string };

type RunBreakdownResult =
  | { ok: true; data: string | undefined }
  | { ok: false; error: BreakdownErrorShape };

/**
 * Format a PromptError into a single-line human-readable message.
 *
 * Mirrors `formatPromptError` in
 * jsr:@tettuan/breakdown/lib/types/prompt_types.ts so the loader does not
 * have to import an un-exported helper.
 */
function formatPromptError(err: PromptErrorShape): string {
  switch (err.kind) {
    case "TemplateNotFound": {
      let m = `${err.kind}: Template not found: ${err.path}`;
      if (err.workingDir) m += ` (working_dir: ${err.workingDir})`;
      if (err.attemptedPaths?.length) {
        m += `\nAttempted paths: ${err.attemptedPaths.join(", ")}`;
      }
      return m;
    }
    case "InvalidVariables":
      return `${err.kind}: Invalid variables: ${err.details.join(", ")}`;
    case "SchemaError":
      return `${err.kind}: Schema error in ${err.schema}: ${err.error}`;
    case "InvalidPath":
      return `${err.kind}: Invalid path: ${err.message}`;
    case "TemplateParseError":
      return `${err.kind}: Failed to parse template ${err.template}: ${err.error}`;
    case "ConfigurationError":
      return `${err.kind}: Configuration error: ${err.message}`;
  }
}

/**
 * Unwrap a BreakdownError into a `{kind, message}` pair.
 *
 * - For `PromptGenerationError` whose `cause` is a structured PromptError,
 *   surface the inner kind so callers can branch on `TemplateNotFound`
 *   directly (this is the common case for missing prompt files).
 * - For all other kinds, return the outer kind plus a best-effort message.
 */
function unwrapBreakdownError(
  err: BreakdownErrorShape,
): { kind: BreakdownErrorKind; message: string } {
  switch (err.kind) {
    case "PromptGenerationError": {
      if (typeof err.cause === "string") {
        return { kind: "PromptGenerationError", message: err.cause };
      }
      return {
        kind: err.cause.kind,
        message: formatPromptError(err.cause),
      };
    }
    case "ConfigProfileError":
    case "ConfigLoadError":
    case "ParameterParsingError":
      return { kind: err.kind, message: `${err.kind}: ${err.message}` };
    case "UnknownResultType":
      return {
        kind: err.kind,
        message: `${err.kind}: ${err.type}`,
      };
    case "TwoParamsHandlerError":
    case "OneParamsHandlerError":
    case "ZeroParamsHandlerError": {
      const causeMsg = err.cause instanceof Error
        ? err.cause.message
        : typeof err.cause === "string"
        ? err.cause
        : JSON.stringify(err.cause);
      return { kind: err.kind, message: `${err.kind}: ${causeMsg}` };
    }
  }
}

export class C3LPromptLoader {
  private readonly configName: string;
  private readonly workingDir: string;

  constructor(private readonly options: C3LPromptLoaderOptions) {
    // Build config name: {agentId}-{configSuffix} or just {agentId}
    this.configName = options.configSuffix
      ? `${options.agentId}-${options.configSuffix}`
      : options.agentId;
    this.workingDir = options.workingDir ?? PROJECT_ROOT;
  }

  /**
   * Load a prompt using breakdown with return mode
   *
   * @param path - C3L path components
   * @param variables - Variables for substitution
   * @returns Load result with content or error
   */
  async load(
    path: C3LPath,
    variables: PromptVariables = {},
  ): Promise<PromptLoadResult> {
    // Build runBreakdown arguments
    const args = this.buildArgs(path, variables);

    try {
      // Dynamic import of breakdown. As of 1.8.6+ (upstream issue #104),
      // runBreakdown returns Result<string | undefined, BreakdownError>
      // with a discriminated error union. The TemplateNotFound case is
      // wrapped inside `PromptGenerationError.cause` (a PromptError union).
      const mod = await import(`jsr:@tettuan/breakdown@${BREAKDOWN_VERSION}`);
      const runBreakdown = mod.runBreakdown as (
        args: string[],
        options?: { returnMode?: boolean },
      ) => Promise<RunBreakdownResult>;

      // runBreakdown uses Deno.cwd() to locate config files, so we must
      // chdir to this.workingDir before the call and restore afterwards.
      const originalCwd = Deno.cwd();
      let result: RunBreakdownResult;
      try {
        Deno.chdir(this.workingDir);
        result = await runBreakdown(args, { returnMode: true });
      } finally {
        Deno.chdir(originalCwd);
      }

      if (result.ok && typeof result.data === "string" && result.data) {
        return {
          ok: true,
          content: result.data,
          promptPath: this.buildPromptPath(path),
        };
      }

      // Failure path. Per #104, breakdown 1.8.6+ always populates `error`
      // with a structured BreakdownError when ok:false. The loader
      // unwraps PromptGenerationError.cause so the resolver sees the
      // underlying PromptError kind (e.g. TemplateNotFound) directly.
      if (!result.ok) {
        const { kind, message } = unwrapBreakdownError(result.error);
        return {
          ok: false,
          error: message,
          errorKind: kind,
          promptPath: this.buildPromptPath(path),
        };
      }

      // ok:true but data is empty/undefined — should not happen in 1.8.6+
      // since returnMode is set, but guard explicitly to avoid silent
      // collapse if the upstream contract regresses.
      return {
        ok: false,
        error:
          `breakdown returned ok:true with empty data (returnMode=true, args=${
            args.join(" ")
          })`,
        promptPath: this.buildPromptPath(path),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build runBreakdown arguments
   */
  private buildArgs(path: C3LPath, variables: PromptVariables): string[] {
    const args: string[] = [];

    // Config argument
    args.push(`--config=${this.configName}`);

    // C2 and C3 (breakdown uses positional args for these)
    args.push(path.c2);
    args.push(path.c3);

    // Edition (if not default)
    if (path.edition && path.edition !== "default") {
      args.push(`--edition=${path.edition}`);
    }

    // Adaptation (for variant prompts)
    if (path.adaptation) {
      args.push(`--adaptation=${path.adaptation}`);
    }

    // UV variables (skip empty values -- breakdown rejects them)
    if (variables.uv) {
      for (const [key, value] of Object.entries(variables.uv)) {
        if (value !== undefined && value !== "") {
          args.push(`--uv-${key}=${value}`);
        }
      }
    }

    return args;
  }

  /**
   * Build C3L coordinate string for logging.
   * Runner does not resolve physical paths — that is breakdown's concern.
   */
  private buildPromptPath(path: C3LPath): string {
    const edition = path.edition ?? "default";
    const filename = path.adaptation
      ? `f_${edition}_${path.adaptation}.md`
      : `f_${edition}.md`;
    return `${path.c1}/${path.c2}/${path.c3}/${filename}`;
  }

  /**
   * Get the config name being used
   */
  getConfigName(): string {
    return this.configName;
  }
}
