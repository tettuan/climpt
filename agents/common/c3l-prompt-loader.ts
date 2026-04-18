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
 * Result of loading a prompt
 */
export interface PromptLoadResult {
  /** Whether the load was successful */
  ok: boolean;
  /** Loaded prompt content (with variables substituted) */
  content?: string;
  /** Error message if load failed */
  error?: string;
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
      // Dynamic import of breakdown with return mode.
      // Widened typecast: breakdown 1.8.x returns Result<string | undefined,
      // BreakdownError>, where BreakdownError is an object with {kind,
      // message, attempted, ...}. Typecasting error as `string` (as the
      // loader did pre-1.8.5) strips the structured error; widen to
      // `unknown` and JSON.stringify for propagation.
      // Pinned exact (no caret): breakdown 1.8.5 changed the runBreakdown
      // Result shape from Result<string,string> to
      // Result<string|undefined, BreakdownError>. Pinning to 1.8.4 keeps
      // the loader's typecast valid until it is widened to cover both.
      const mod = await import(`jsr:@tettuan/breakdown@${BREAKDOWN_VERSION}`);
      const runBreakdown = mod.runBreakdown as (
        args: string[],
        options?: { returnMode?: boolean },
      ) => Promise<{ ok: boolean; data?: unknown; error?: unknown }>;

      // runBreakdown uses Deno.cwd() to locate config files, so we must
      // chdir to this.workingDir before the call and restore afterwards.
      const originalCwd = Deno.cwd();
      let result: { ok: boolean; data?: unknown; error?: unknown };
      try {
        Deno.chdir(this.workingDir);
        result = await runBreakdown(args, {
          returnMode: true,
        });
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

      // Propagate the breakdown error. If the breakdown result carries no
      // error (either `ok:false` with falsy error, or `ok:true` with
      // undefined data), synthesize a descriptive diagnostic so the caller
      // never sees `{ok:false}` with an empty error — that was the silent
      // collapse that masked the continuation.polling regression.
      const promptPath = this.buildPromptPath(path);
      if (result.error) {
        const errorMsg = typeof result.error === "string"
          ? result.error
          : JSON.stringify(result.error);
        return { ok: false, error: errorMsg };
      }
      const synthesized = this.synthesizeSilentError(result, promptPath, args);
      return { ok: false, error: synthesized };
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
   * Synthesize a descriptive error when breakdown returns no propagable
   * error (either `{ok:false}` with falsy error, or `{ok:true}` with
   * undefined data). Pre-patch these paths silently returned `{ok:false}`,
   * making "breakdown produced no prompt" indistinguishable from
   * "prompt file missing" at the resolver.
   */
  private synthesizeSilentError(
    result: { ok: boolean; data?: unknown; error?: unknown },
    promptPath: string,
    args: string[],
  ): string {
    const marker = result.ok
      ? "BreakdownSilentOkNoData"
      : "BreakdownSilentNoError";
    const snapshot = {
      ok: result.ok,
      dataType: typeof result.data,
      errorType: typeof result.error,
      keys: Object.keys(result ?? {}),
    };
    return JSON.stringify({
      kind: marker,
      message:
        "breakdown returned a result with no propagable error or content",
      configName: this.configName,
      workingDir: this.workingDir,
      breakdownVersion: BREAKDOWN_VERSION,
      promptPath,
      args,
      result: snapshot,
    });
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
