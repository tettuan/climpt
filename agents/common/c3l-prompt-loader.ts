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
  /** Working directory (defaults to Deno.cwd()) */
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
export class C3LPromptLoader {
  private readonly configName: string;
  private readonly workingDir: string;

  constructor(private readonly options: C3LPromptLoaderOptions) {
    // Build config name: {agentId}-{configSuffix} or just {agentId}
    this.configName = options.configSuffix
      ? `${options.agentId}-${options.configSuffix}`
      : options.agentId;
    this.workingDir = options.workingDir ?? Deno.cwd();
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
      // Dynamic import of breakdown with return mode
      const mod = await import(`jsr:@tettuan/breakdown@^${BREAKDOWN_VERSION}`);
      const runBreakdown = mod.runBreakdown as (
        args: string[],
        options?: { returnMode?: boolean; stdin?: string },
      ) => Promise<{ ok: boolean; data?: string; error?: string }>;

      // Call runBreakdown with returnMode: true
      const result = await runBreakdown(args, {
        returnMode: true,
        stdin: variables.inputText,
      });

      if (result.ok && result.data) {
        return {
          ok: true,
          content: result.data,
          promptPath: this.buildPromptPath(path),
        };
      }

      const errorMsg = result.error
        ? (typeof result.error === "string"
          ? result.error
          : JSON.stringify(result.error))
        : "runBreakdown returned no data";
      return {
        ok: false,
        error: errorMsg,
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

    // UV variables
    if (variables.uv) {
      for (const [key, value] of Object.entries(variables.uv)) {
        args.push(`--uv-${key}=${value}`);
      }
    }

    return args;
  }

  /**
   * Build the expected prompt file path (for logging)
   */
  private buildPromptPath(path: C3LPath): string {
    const edition = path.edition ?? "default";
    const filename = path.adaptation
      ? `f_${edition}_${path.adaptation}.md`
      : `f_${edition}.md`;
    return `.agent/${this.options.agentId}/prompts/${path.c1}/${path.c2}/${path.c3}/${filename}`;
  }

  /**
   * Get the config name being used
   */
  getConfigName(): string {
    return this.configName;
  }
}

/**
 * Create a C3LPromptLoader for the iterator agent
 */
export function createIteratorPromptLoader(
  workingDir?: string,
): C3LPromptLoader {
  return new C3LPromptLoader({
    agentId: "iterator",
    configSuffix: "dev",
    workingDir,
  });
}

/**
 * Create a C3LPromptLoader for the reviewer agent
 */
export function createReviewerPromptLoader(
  workingDir?: string,
): C3LPromptLoader {
  return new C3LPromptLoader({
    agentId: "reviewer",
    configSuffix: "dev",
    workingDir,
  });
}
