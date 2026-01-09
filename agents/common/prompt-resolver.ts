/**
 * Prompt Resolver - External Prompt Resolution System
 *
 * Resolves prompts via breakdown (C3L) with fallback support.
 * Key features:
 * - Uses C3LPromptLoader to call runBreakdown
 * - Falls back to embedded prompts when breakdown fails or returns empty
 * - Variable substitution for {uv-xxx} and {input_text}
 * - Frontmatter removal for clean prompt content
 */

import { join } from "@std/path";
import type { StepDefinition, StepRegistry } from "./step-registry.ts";
import { type C3LPath, C3LPromptLoader } from "./c3l-prompt-loader.ts";

/**
 * Result of prompt resolution
 */
export interface PromptResolutionResult {
  /** Resolved prompt content (variables substituted, frontmatter removed) */
  content: string;

  /** Source of the prompt */
  source: "user" | "fallback";

  /** Actual file path if resolved from user file */
  promptPath?: string;

  /** Step ID that was resolved */
  stepId: string;

  /** Variables that were substituted */
  substitutedVariables?: Record<string, string>;
}

/**
 * Variable values for substitution
 */
export interface PromptVariables {
  /** User variables (UV) - keys without "uv-" prefix */
  uv?: Record<string, string>;

  /** STDIN input text */
  inputText?: string;

  /** Additional custom variables */
  custom?: Record<string, string>;
}

/**
 * Fallback prompt provider interface
 *
 * Implement this to provide embedded/default prompts
 */
export interface FallbackPromptProvider {
  /**
   * Get fallback prompt by key
   *
   * @param key - Fallback key from step definition
   * @returns Prompt content or undefined if not found
   */
  getPrompt(key: string): string | undefined;

  /**
   * Check if fallback exists
   *
   * @param key - Fallback key to check
   * @returns true if fallback exists
   */
  hasPrompt(key: string): boolean;
}

/**
 * Options for PromptResolver
 */
export interface PromptResolverOptions {
  /** Working directory for relative path resolution */
  workingDir?: string;

  /** Custom user prompts base path (overrides registry setting) */
  userPromptsBase?: string;

  /** Whether to strip frontmatter from prompts (default: true) */
  stripFrontmatter?: boolean;

  /** Whether to allow missing variables (default: false - throws error) */
  allowMissingVariables?: boolean;

  /** Config suffix for C3LPromptLoader (e.g., "dev" results in config="iterator-dev") */
  configSuffix?: string;
}

/**
 * PromptResolver - Resolves prompts via breakdown (C3L) with fallback
 *
 * Usage:
 * ```typescript
 * const resolver = new PromptResolver(registry, fallbackProvider, { configSuffix: "steps" });
 * const result = await resolver.resolve("initial.issue", {
 *   uv: { issue_number: "123", repository: "owner/repo" }
 * });
 * console.log(result.content);
 * ```
 */
export class PromptResolver {
  private workingDir: string;
  private userPromptsBase: string;
  private stripFrontmatter: boolean;
  private allowMissingVariables: boolean;
  private c3lLoader: C3LPromptLoader;

  /**
   * Create a new PromptResolver
   *
   * @param registry - Step registry containing step definitions
   * @param fallbackProvider - Provider for fallback prompts
   * @param options - Resolver options
   */
  constructor(
    private readonly registry: StepRegistry,
    private readonly fallbackProvider: FallbackPromptProvider,
    options: PromptResolverOptions = {},
  ) {
    this.workingDir = options.workingDir ?? Deno.cwd();
    this.userPromptsBase = options.userPromptsBase ??
      registry.userPromptsBase ??
      `.agent/${registry.agentId}/prompts`;
    this.stripFrontmatter = options.stripFrontmatter ?? true;
    this.allowMissingVariables = options.allowMissingVariables ?? false;

    // Create C3LPromptLoader for breakdown integration
    this.c3lLoader = new C3LPromptLoader({
      agentId: registry.agentId,
      configSuffix: options.configSuffix ?? registry.c1,
      workingDir: this.workingDir,
    });
  }

  /**
   * Resolve a prompt by step ID
   *
   * Resolution order:
   * 1. Try breakdown via C3LPromptLoader
   * 2. Fall back to embedded prompt via fallbackProvider
   *
   * @param stepId - Step identifier to resolve
   * @param variables - Variables for substitution
   * @returns Resolution result with content and metadata
   */
  async resolve(
    stepId: string,
    variables: PromptVariables = {},
  ): Promise<PromptResolutionResult> {
    const step = this.registry.steps[stepId];
    if (!step) {
      throw new Error(`Unknown step ID: "${stepId}"`);
    }

    // Try breakdown first
    const breakdownResult = await this.tryBreakdown(step, variables);
    if (breakdownResult) {
      return breakdownResult;
    }

    // Fall back to embedded prompt
    return this.useFallback(step, variables);
  }

  /**
   * Build C3L path from step definition
   */
  private buildC3LPath(step: StepDefinition): C3LPath {
    return {
      c1: this.registry.c1,
      c2: step.c2,
      c3: step.c3,
      edition: step.edition,
      adaptation: step.adaptation,
    };
  }

  /**
   * Try to resolve via breakdown (C3LPromptLoader)
   *
   * @param step - Step definition
   * @param variables - Variables for substitution
   * @returns Resolution result or null if breakdown fails or returns empty
   */
  private async tryBreakdown(
    step: StepDefinition,
    variables: PromptVariables,
  ): Promise<PromptResolutionResult | null> {
    const c3lPath = this.buildC3LPath(step);

    const result = await this.c3lLoader.load(c3lPath, {
      uv: variables.uv,
      inputText: variables.inputText,
    });

    // Check if breakdown succeeded and returned content
    if (!result.ok || !result.content) {
      return null;
    }

    // Process content (strip frontmatter if needed, substitute custom variables)
    const content = this.processContent(result.content, step, variables);

    return {
      content,
      source: "user",
      promptPath: result.promptPath,
      stepId: step.stepId,
      substitutedVariables: this.getSubstitutedVariables(variables),
    };
  }

  /**
   * Use fallback prompt
   *
   * @param step - Step definition
   * @param variables - Variables for substitution
   * @returns Resolution result
   */
  private useFallback(
    step: StepDefinition,
    variables: PromptVariables,
  ): PromptResolutionResult {
    const rawContent = this.fallbackProvider.getPrompt(step.fallbackKey);
    if (!rawContent) {
      throw new Error(
        `No fallback prompt found for key: "${step.fallbackKey}" (step: ${step.stepId})`,
      );
    }

    const content = this.processContent(rawContent, step, variables);

    return {
      content,
      source: "fallback",
      stepId: step.stepId,
      substitutedVariables: this.getSubstitutedVariables(variables),
    };
  }

  /**
   * Process prompt content (frontmatter removal + variable substitution)
   *
   * @param rawContent - Raw prompt content
   * @param step - Step definition
   * @param variables - Variables for substitution
   * @returns Processed content
   */
  private processContent(
    rawContent: string,
    step: StepDefinition,
    variables: PromptVariables,
  ): string {
    // Strip frontmatter if enabled
    let content = this.stripFrontmatter
      ? removeFrontmatter(rawContent)
      : rawContent;

    // Substitute variables
    content = this.substituteVariables(content, step, variables);

    return content.trim();
  }

  /**
   * Substitute variables in content
   *
   * Handles:
   * - {uv-xxx} -> variables.uv[xxx]
   * - {input_text} -> variables.inputText
   * - {custom_key} -> variables.custom[custom_key]
   *
   * @param content - Content with variable placeholders
   * @param step - Step definition for required variable validation
   * @param variables - Variable values
   * @returns Content with variables substituted
   */
  private substituteVariables(
    content: string,
    step: StepDefinition,
    variables: PromptVariables,
  ): string {
    // Validate required UV variables
    if (!this.allowMissingVariables && step.uvVariables.length > 0) {
      for (const uvName of step.uvVariables) {
        if (!variables.uv?.[uvName]) {
          throw new Error(
            `Missing required UV variable "${uvName}" for step "${step.stepId}"`,
          );
        }
      }
    }

    // Validate input_text if required
    if (
      !this.allowMissingVariables && step.usesStdin && !variables.inputText
    ) {
      throw new Error(
        `Step "${step.stepId}" requires input_text but none provided`,
      );
    }

    // Substitute UV variables {uv-xxx}
    let result = content.replace(/\{uv-(\w+)\}/g, (_match, name) => {
      const value = variables.uv?.[name];
      if (value === undefined && !this.allowMissingVariables) {
        throw new Error(
          `UV variable "${name}" not provided for step "${step.stepId}"`,
        );
      }
      return value ?? "";
    });

    // Substitute {input_text}
    result = result.replace(/\{input_text\}/g, variables.inputText ?? "");

    // Substitute custom variables {xxx}
    if (variables.custom) {
      for (const [key, value] of Object.entries(variables.custom)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
      }
    }

    return result;
  }

  /**
   * Get map of substituted variables for logging
   */
  private getSubstitutedVariables(
    variables: PromptVariables,
  ): Record<string, string> {
    const result: Record<string, string> = {};

    if (variables.uv) {
      for (const [key, value] of Object.entries(variables.uv)) {
        result[`uv-${key}`] = value;
      }
    }

    if (variables.inputText !== undefined) {
      result["input_text"] = `[${variables.inputText.length} chars]`;
    }

    if (variables.custom) {
      for (const [key, value] of Object.entries(variables.custom)) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Build prompt file path from step definition
   */
  private buildPromptPath(step: StepDefinition): string {
    const edition = step.edition ?? "default";
    const filename = step.adaptation
      ? `f_${edition}_${step.adaptation}.md`
      : `f_${edition}.md`;
    return `${this.registry.c1}/${step.c2}/${step.c3}/${filename}`;
  }

  /**
   * Check if a step can be resolved (has user file or fallback)
   *
   * @param stepId - Step ID to check
   * @returns true if step can be resolved
   */
  async canResolve(stepId: string): Promise<boolean> {
    const step = this.registry.steps[stepId];
    if (!step) {
      return false;
    }

    // Check user file
    const promptPath = this.buildPromptPath(step);
    const userPath = join(this.workingDir, this.userPromptsBase, promptPath);
    try {
      await Deno.stat(userPath);
      return true;
    } catch {
      // Check fallback
      return this.fallbackProvider.hasPrompt(step.fallbackKey);
    }
  }

  /**
   * Get the user file path for a step (even if it doesn't exist)
   *
   * @param stepId - Step ID
   * @returns User file path or undefined if step not found
   */
  getUserFilePath(stepId: string): string | undefined {
    const step = this.registry.steps[stepId];
    if (!step) {
      return undefined;
    }
    const promptPath = this.buildPromptPath(step);
    return join(this.workingDir, this.userPromptsBase, promptPath);
  }
}

/**
 * Remove YAML frontmatter from markdown content
 *
 * Frontmatter is delimited by "---" at the start and end.
 * Example:
 * ```
 * ---
 * title: My Prompt
 * version: 1.0
 * ---
 * Actual content here
 * ```
 *
 * @param content - Content that may contain frontmatter
 * @returns Content with frontmatter removed
 */
export function removeFrontmatter(content: string): string {
  // Check if content starts with frontmatter delimiter
  if (!content.startsWith("---")) {
    return content;
  }

  // Find the closing delimiter
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    // No closing delimiter, return as-is
    return content;
  }

  // Return content after the closing delimiter
  return content.slice(endIndex + 4).trimStart();
}

/**
 * Parse YAML frontmatter from content
 *
 * @param content - Content with frontmatter
 * @returns Parsed frontmatter as Record or null if no frontmatter
 */
export function parseFrontmatter(
  content: string,
): Record<string, unknown> | null {
  if (!content.startsWith("---")) {
    return null;
  }

  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterText = content.slice(4, endIndex);

  // Simple YAML parsing (key: value pairs)
  const result: Record<string, unknown> = {};
  for (const line of frontmatterText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    // Parse value type
    if (value === "true") {
      result[key] = true;
    } else if (value === "false") {
      result[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    } else if (/^-?\d+\.\d+$/.test(value)) {
      result[key] = parseFloat(value);
    } else if (value.startsWith("[") && value.endsWith("]")) {
      // Simple array parsing
      result[key] = value.slice(1, -1).split(",").map((s) => s.trim());
    } else if (value.startsWith('"') && value.endsWith('"')) {
      result[key] = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      result[key] = value.slice(1, -1);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Create a simple in-memory fallback provider
 *
 * @param prompts - Map of fallback key to prompt content
 * @returns FallbackPromptProvider instance
 */
export function createFallbackProvider(
  prompts: Record<string, string>,
): FallbackPromptProvider {
  return {
    getPrompt(key: string): string | undefined {
      return prompts[key];
    },
    hasPrompt(key: string): boolean {
      return key in prompts;
    },
  };
}
