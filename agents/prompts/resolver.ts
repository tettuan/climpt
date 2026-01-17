/**
 * Prompt resolver with Climpt integration
 *
 * @refactored Using adapter pattern for prompt loading (v2)
 */

import { join } from "@std/path";
import { DefaultFallbackProvider } from "./fallback.ts";
import type { Variables } from "../src_common/contracts.ts";
import {
  FilePromptAdapter,
  PromptAdapter,
  PromptNotFoundError,
} from "./adapter.ts";
import { substituteVariables } from "./variable-substitutor.ts";

export interface PromptResolverOptions {
  agentName: string;
  agentDir: string;
  registryPath: string;
  fallbackDir?: string;
}

export interface StepRegistry {
  version: string;
  basePath: string;
  steps: Record<string, StepDefinition>;
  editions?: Record<string, string>;
}

export interface StepDefinition {
  name: string;
  path?: string;
  c1?: string;
  c2?: string;
  c3?: string;
  edition?: string;
  variables?: string[];
  useStdin?: boolean;
}

export class PromptResolver {
  private agentDir: string;
  private registry: StepRegistry;
  private fallbackProvider: DefaultFallbackProvider;

  private constructor(agentDir: string, registry: StepRegistry) {
    this.agentDir = agentDir;
    this.registry = registry;
    this.fallbackProvider = new DefaultFallbackProvider();
  }

  static async create(options: PromptResolverOptions): Promise<PromptResolver> {
    const registryPath = join(options.agentDir, options.registryPath);

    let registry: StepRegistry;
    try {
      const content = await Deno.readTextFile(registryPath);
      registry = JSON.parse(content) as StepRegistry;
    } catch {
      // Use minimal default registry if not found
      registry = {
        version: "1.0.0",
        basePath: "prompts",
        steps: {},
      };
    }

    return new PromptResolver(options.agentDir, registry);
  }

  async resolve(
    stepId: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const step = this.registry.steps[stepId];

    if (!step) {
      // Try fallback provider for known steps
      try {
        return this.fallbackProvider.get(stepId, variables);
      } catch {
        throw new Error(`Unknown step: ${stepId}`);
      }
    }

    // Build path
    const promptPath = step.path ?? this.buildC3LPath(step);
    const fullPath = join(this.agentDir, this.registry.basePath, promptPath);

    // Try Climpt first, then fallback to direct file read
    try {
      return await this.renderWithClimpt(fullPath, variables, step.useStdin);
    } catch {
      try {
        return await this.renderFallback(fullPath, variables);
      } catch {
        // Final fallback to built-in templates
        return this.fallbackProvider.get(stepId, variables);
      }
    }
  }

  async resolveSystemPrompt(
    variables: Record<string, string>,
  ): Promise<string> {
    try {
      return await this.resolve("system", variables);
    } catch {
      // Return a default system prompt
      return this.fallbackProvider.getSystemPrompt(variables);
    }
  }

  private buildC3LPath(step: StepDefinition): string {
    if (!step.c1 || !step.c2 || !step.c3) {
      throw new Error(`Step requires c1, c2, c3 or path`);
    }

    const edition = step.edition ?? "default";
    return join(step.c1, step.c2, step.c3, `f_${edition}.md`);
  }

  private async renderWithClimpt(
    path: string,
    variables: Record<string, string>,
    useStdin?: boolean,
  ): Promise<string> {
    // Build Climpt CLI arguments
    const args = ["--return", path];

    for (const [key, value] of Object.entries(variables)) {
      if (key.startsWith("uv-")) {
        args.push(`--${key}`, value);
      }
    }

    const command = new Deno.Command("climpt", {
      args,
      stdin: useStdin ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    if (useStdin && variables.input_text) {
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(variables.input_text));
      await writer.close();
    }

    const output = await process.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Climpt rendering failed: ${stderr}`);
    }

    return new TextDecoder().decode(output.stdout);
  }

  private async renderFallback(
    path: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const content = await Deno.readTextFile(path);

    // Simple template substitution: {{variable}} and {variable}
    return content
      .replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const varKey = key.trim();
        return variables[varKey] ?? variables[`uv-${varKey}`] ?? `{{${key}}}`;
      })
      .replace(/\{([^}]+)\}/g, (_, key) => {
        const varKey = key.trim();
        if (varKey.startsWith("uv-")) {
          return variables[varKey] ?? `{${key}}`;
        }
        return variables[`uv-${varKey}`] ?? variables[varKey] ?? `{${key}}`;
      });
  }

  getStepDefinition(stepId: string): StepDefinition | undefined {
    return this.registry.steps[stepId];
  }

  listSteps(): string[] {
    return Object.keys(this.registry.steps);
  }
}

// ============================================================================
// V2 Types and Implementation
// ============================================================================

/**
 * Options for PromptResolverV2.
 */
export interface ResolverOptions {
  agentName: string;
  agentDir: string;
  registryPath?: string;
  fallbackDir?: string;
  adapter?: PromptAdapter;
  fallbackAdapter?: PromptAdapter;
}

/**
 * Prompt reference for V2 resolver.
 * Supports both file paths and C3L references.
 */
export interface PromptReferenceV2 {
  path?: string;
  c1?: string;
  c2?: string;
  c3?: string;
  edition?: string;
}

/**
 * Prompt Resolver (v2)
 *
 * Resolves prompts from files or external sources using the adapter pattern.
 * This version provides cleaner separation of concerns:
 * - Adapter: handles file/CLI access
 * - Substitutor: handles variable replacement
 * - Resolver: orchestrates the process
 */
export class PromptResolverV2 {
  private readonly adapter: PromptAdapter;
  private readonly fallbackAdapter?: PromptAdapter;
  private readonly agentDir: string;
  private readonly systemPromptPath: string;

  constructor(private readonly options: ResolverOptions) {
    this.adapter = options.adapter ?? new FilePromptAdapter();
    this.fallbackAdapter = options.fallbackAdapter;
    this.agentDir = options.agentDir;
    this.systemPromptPath = join(options.agentDir, "prompts", "system.md");
  }

  /**
   * Resolve a prompt by reference.
   *
   * @param ref - Prompt reference (path or C3L)
   * @param variables - Variables for substitution
   * @returns Resolved prompt content
   */
  async resolve(
    ref: PromptReferenceV2,
    variables: Variables = {},
  ): Promise<string> {
    const path = this.buildPath(ref);

    let content: string;
    try {
      content = await this.adapter.load(path);
    } catch (error) {
      if (error instanceof PromptNotFoundError && this.fallbackAdapter) {
        content = await this.fallbackAdapter.load(path);
      } else {
        throw error;
      }
    }

    return substituteVariables(content, variables);
  }

  /**
   * Resolve the system prompt.
   *
   * @param variables - Variables for substitution
   * @returns Resolved system prompt content
   */
  async resolveSystemPrompt(variables: Variables = {}): Promise<string> {
    const content = await this.adapter.load(this.systemPromptPath);
    return substituteVariables(content, variables);
  }

  /**
   * Build file path from reference.
   */
  private buildPath(ref: PromptReferenceV2): string {
    if (ref.path) {
      // Relative paths are resolved from agent directory
      if (!ref.path.startsWith("/")) {
        return join(this.agentDir, ref.path);
      }
      return ref.path;
    }

    // C3L reference - return as is for Climpt adapter
    if (ref.c1 && ref.c2 && ref.c3) {
      const path = `${ref.c1}/${ref.c2}/${ref.c3}`;
      return ref.edition ? `${path}:${ref.edition}` : path;
    }

    throw new Error("Invalid prompt reference: must have path or c1/c2/c3");
  }
}
