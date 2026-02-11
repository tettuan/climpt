/**
 * Compatibility adapter: wraps new PromptResolver with old resolver API.
 *
 * Temporary bridge for Phase B migration. Provides the old PromptResolver API
 * (flat variables, string return) while internally delegating to the new
 * PromptResolver (PromptVariables, PromptResolutionResult).
 *
 * After all consumers are migrated to the new API, this adapter
 * and the old resolver.ts can be deleted.
 */

import { join } from "@std/path";
import {
  createFallbackProvider,
  PromptResolver as NewPromptResolver,
  type PromptVariables,
} from "../common/prompt-resolver.ts";
import {
  createEmptyRegistry,
  loadStepRegistry,
  type StepRegistry,
} from "../common/step-registry.ts";
import { DefaultFallbackProvider } from "./fallback.ts";
import type { PromptLogger } from "../common/prompt-logger.ts";

/**
 * Result of prompt resolution with metadata for logging.
 */
export interface PromptResolutionResult {
  /** Resolved prompt content */
  content: string;
  /** Step ID that was resolved */
  stepId: string;
  /** Source of the prompt: 'file' (from disk), 'climpt' (via CLI), or 'fallback' (embedded) */
  source: "file" | "climpt" | "fallback";
  /** Full file path if resolved from file or climpt (e.g., "iterator/initial/issue/f_default.md") */
  promptPath?: string;
  /** Variables that were substituted (uv-* parameters) */
  substitutedVariables?: Record<string, string>;
  /** Edition used for C3L path (e.g., "default", "empty") */
  edition?: string;
  /** Adaptation variant if used (e.g., "preparation", "preparation_empty") */
  adaptation?: string;
}

export interface PromptResolverOptions {
  agentName: string;
  agentDir: string;
  registryPath: string;
  fallbackDir?: string;
  systemPromptPath?: string;
}

/**
 * PromptResolverAdapter - wraps new resolver with old API.
 *
 * Drop-in replacement for the old PromptResolver class.
 * All handler code continues to call resolve(stepId, Record<string,string>).
 */
export class PromptResolverAdapter {
  private inner: NewPromptResolver;
  private fallbackProvider: DefaultFallbackProvider;
  private promptLogger?: PromptLogger;
  private systemPromptPath?: string;
  private agentDir: string;

  private constructor(
    inner: NewPromptResolver,
    fallbackProvider: DefaultFallbackProvider,
    agentDir: string,
    systemPromptPath?: string,
  ) {
    this.inner = inner;
    this.fallbackProvider = fallbackProvider;
    this.agentDir = agentDir;
    this.systemPromptPath = systemPromptPath;
  }

  /**
   * Factory method matching old PromptResolver.create() signature.
   */
  static async create(
    options: PromptResolverOptions,
  ): Promise<PromptResolverAdapter> {
    // Load step registry for new resolver
    let registry: StepRegistry;
    try {
      registry = await loadStepRegistry(
        options.agentName,
        options.agentDir,
        {
          registryPath: join(options.agentDir, options.registryPath),
          validateIntentEnums: false,
        },
      );
    } catch {
      // Fallback to empty registry
      registry = createEmptyRegistry(options.agentName);
    }

    // Build fallback map from DefaultFallbackProvider templates
    const fallbackProvider = new DefaultFallbackProvider();
    const fallback = createFallbackProvider({});

    const inner = new NewPromptResolver(registry, fallback, {
      workingDir: Deno.cwd(),
      configSuffix: "steps",
    });

    return new PromptResolverAdapter(
      inner,
      fallbackProvider,
      options.agentDir,
      options.systemPromptPath,
    );
  }

  /**
   * Set prompt logger (forwarded to track resolution).
   */
  setPromptLogger(logger: PromptLogger): void {
    this.promptLogger = logger;
  }

  /**
   * Old API: resolve(stepId, flat vars) ->string
   */
  async resolve(
    stepId: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const result = await this.resolveWithMetadata(stepId, variables);
    return result.content;
  }

  /**
   * Old API: resolveWithMetadata(stepId, flat vars) ->PromptResolutionResult
   */
  async resolveWithMetadata(
    stepId: string,
    variables: Record<string, string>,
  ): Promise<PromptResolutionResult> {
    const startTime = performance.now();
    const converted = this.convertVariables(variables);

    // Extract uv-* variables for logging
    const uvVariables: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (key.startsWith("uv-")) {
        uvVariables[key] = value;
      }
    }

    try {
      const newResult = await this.inner.resolve(stepId, converted);
      const result: PromptResolutionResult = {
        content: newResult.content,
        stepId: newResult.stepId,
        source: newResult.source === "user" ? "file" : "fallback",
        promptPath: newResult.promptPath,
        substitutedVariables: uvVariables,
      };

      await this.logResolution(result, performance.now() - startTime);
      return result;
    } catch {
      // Fall back to old DefaultFallbackProvider for known step IDs
      try {
        const content = this.fallbackProvider.get(stepId, variables);
        const result: PromptResolutionResult = {
          content,
          stepId,
          source: "fallback",
          substitutedVariables: uvVariables,
        };
        await this.logResolution(result, performance.now() - startTime);
        return result;
      } catch {
        throw new Error(`Unknown step: ${stepId}`);
      }
    }
  }

  /**
   * Old API: resolveSystemPrompt(vars) ->string
   */
  async resolveSystemPrompt(
    variables: Record<string, string>,
  ): Promise<string> {
    const result = await this.resolveSystemPromptWithMetadata(variables);
    return result.content;
  }

  /**
   * Old API: resolveSystemPromptWithMetadata(vars) ->PromptResolutionResult
   */
  async resolveSystemPromptWithMetadata(
    variables: Record<string, string>,
  ): Promise<PromptResolutionResult> {
    const startTime = performance.now();

    // Extract uv-* variables for logging
    const uvVariables: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (key.startsWith("uv-")) {
        uvVariables[key] = value;
      }
    }

    // Try systemPromptPath first (from agent.json behavior.systemPromptPath)
    if (this.systemPromptPath) {
      try {
        const fullPath = join(this.agentDir, this.systemPromptPath);
        const content = await Deno.readTextFile(fullPath);
        // Variable substitution: {uv-xxx} single-brace only
        const resolved = content
          .replace(/\{uv-([a-zA-Z0-9_-]+)\}/g, (match, varName) => {
            const value = variables[`uv-${varName}`] ?? variables[varName];
            return value ?? match;
          });

        const result: PromptResolutionResult = {
          content: resolved,
          stepId: "system",
          source: "file",
          promptPath: this.systemPromptPath,
          substitutedVariables: uvVariables,
        };
        await this.logResolution(result, performance.now() - startTime);
        return result;
      } catch {
        // Fall through to fallback
      }
    }

    // Fall back to DefaultFallbackProvider system prompt
    const content = this.fallbackProvider.getSystemPrompt(variables);
    const result: PromptResolutionResult = {
      content,
      stepId: "system",
      source: "fallback",
      substitutedVariables: uvVariables,
    };
    await this.logResolution(result, performance.now() - startTime);
    return result;
  }

  /**
   * Old API: getStepDefinition
   */
  getStepDefinition(
    _stepId: string,
  ): {
    name: string;
    path?: string;
    c1?: string;
    c2?: string;
    c3?: string;
    edition?: string;
    variables?: string[];
    useStdin?: boolean;
  } | undefined {
    // Delegate to inner registry if available
    return undefined;
  }

  /**
   * Old API: listSteps
   */
  listSteps(): string[] {
    return [];
  }

  /**
   * Convert flat Record<string, string> with "uv-" prefix to PromptVariables.
   */
  private convertVariables(vars: Record<string, string>): PromptVariables {
    const uv: Record<string, string> = {};
    const custom: Record<string, string> = {};

    for (const [key, value] of Object.entries(vars)) {
      if (key.startsWith("uv-")) {
        uv[key.slice(3)] = value;
      } else if (key === "input_text") {
        // Will be set as inputText
      } else {
        custom[key] = value;
      }
    }

    return {
      uv: Object.keys(uv).length > 0 ? uv : undefined,
      inputText: vars.input_text,
      custom: Object.keys(custom).length > 0 ? custom : undefined,
    };
  }

  /**
   * Log prompt resolution if logger is set.
   */
  private async logResolution(
    result: PromptResolutionResult,
    timeMs: number,
  ): Promise<void> {
    if (!this.promptLogger) return;
    await this.promptLogger.logResolution(result, timeMs);
  }
}
