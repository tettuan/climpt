/**
 * Prompt Resolver - External Prompt Resolution System
 *
 * Resolves prompts via breakdown (C3L) with conditional fallback.
 * Key features:
 * - Uses C3LPromptLoader to call runBreakdown
 * - Falls back to embedded prompts only when file not found AND allowFallback=true
 * - Throws PR-C3L-002 on non-file-not-found C3L errors (UV, frontmatter, YAML)
 * - Throws PR-FALLBACK-003 when fallback reached but not allowed
 * - Variable substitution for {uv-xxx} and {input_text}
 * - Frontmatter removal for clean prompt content
 */

import { join } from "@std/path";
import { PATHS } from "../shared/paths.ts";
import type { PromptStepDefinition, StepRegistry } from "./step-registry.ts";
import { type C3LPath, C3LPromptLoader } from "./c3l-prompt-loader.ts";
import {
  prC3lBreakdownFailed,
  prFallbackNotAllowed,
  prFallbackNotFound,
  prResolveMissingInputText,
  prResolveMissingRequiredUv,
  prResolveUnknownStepId,
  prResolveUvNotProvided,
} from "../shared/errors/config-errors.ts";

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
 *   uv: { issue: "123", repository: "owner/repo" }
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
      `${PATHS.AGENT_DIR_PREFIX}/${registry.agentId}/${PATHS.PROMPTS_DIR}`;
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
   * 2. Fall back to embedded prompt via fallbackProvider (if allowed)
   *
   * @param stepId - Step identifier to resolve
   * @param variables - Variables for substitution
   * @param overrides - Optional overrides (adaptation, allowFallback)
   * @returns Resolution result with content and metadata
   */
  async resolve(
    stepId: string,
    variables?: PromptVariables,
    overrides?: { adaptation?: string; allowFallback?: boolean },
  ): Promise<PromptResolutionResult> {
    // Default variables if not provided
    variables = variables ?? {};
    const allowFallback = overrides?.allowFallback ?? true;
    const step = this.registry.steps[stepId];
    if (!step) {
      throw prResolveUnknownStepId(stepId);
    }

    // Apply adaptation override if provided
    const effectiveStep = overrides?.adaptation
      ? { ...step, adaptation: overrides.adaptation }
      : step;

    // Try breakdown first
    const breakdownResult = await this.tryBreakdown(effectiveStep, variables);
    if (breakdownResult) {
      return breakdownResult;
    }

    // Breakdown returned null (file not found) — fallback or throw
    if (!allowFallback) {
      throw prFallbackNotAllowed(effectiveStep.stepId);
    }

    const c3lPath = this.buildC3LPath(effectiveStep);
    const c3lPathStr = this.formatC3LPath(c3lPath);
    // deno-lint-ignore no-console
    console.warn(
      `[Prompt] Fallback: User file not found for "${effectiveStep.stepId}" (tried: ${c3lPathStr}), using fallback prompt (key: "${effectiveStep.fallbackKey}")`,
    );

    // Fall back to embedded prompt
    return this.useFallback(effectiveStep, variables);
  }

  /**
   * Build C3L path from step definition
   */
  private buildC3LPath(step: PromptStepDefinition): C3LPath {
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
   * @returns Resolution result or null if prompt file not found
   * @throws ConfigError (PR-C3L-002) if breakdown fails with non-file-not-found error
   */
  private async tryBreakdown(
    step: PromptStepDefinition,
    variables: PromptVariables,
  ): Promise<PromptResolutionResult | null> {
    const c3lPath = this.buildC3LPath(step);

    const result = await this.c3lLoader.load(c3lPath, {
      uv: variables.uv,
      inputText: variables.inputText,
    });

    // Breakdown failed — distinguish file-not-found from other errors
    if (!result.ok || !result.content) {
      if (result.error && !this.isParameterParsingError(result.error)) {
        // Non-file-not-found error: UV undefined, frontmatter broken, YAML parse failure, etc.
        // These require user correction — do not silently fall back.
        throw prC3lBreakdownFailed(step.stepId, result.error);
      }
      // No error detail OR ParameterParsingError (breakdown doesn't recognize
      // the directive type / parameters) = prompt cannot be resolved via C3L.
      // Return null to allow fallback decision by caller.
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
   * Check if a C3L loader error is a ParameterParsingError.
   *
   * ParameterParsingError means breakdown doesn't recognize the directive
   * type or other CLI parameters. This is NOT a user-correctable C3L
   * template issue — it means the step simply can't be resolved via
   * breakdown (e.g., the c2 value is not a valid breakdown directive type).
   * Treat this the same as "file not found" to allow fallback.
   */
  private isParameterParsingError(error: string): boolean {
    return error.includes("ParameterParsingError");
  }

  /**
   * Use fallback prompt
   *
   * @param step - Step definition
   * @param variables - Variables for substitution
   * @returns Resolution result
   */
  private useFallback(
    step: PromptStepDefinition,
    variables: PromptVariables,
  ): PromptResolutionResult {
    const rawContent = this.fallbackProvider.getPrompt(step.fallbackKey);
    if (!rawContent) {
      throw prFallbackNotFound(step.fallbackKey, step.stepId);
    }

    // deno-lint-ignore no-console
    console.warn(
      `[Prompt] Fallback content for "${step.stepId}": ${rawContent.length} chars (key: "${step.fallbackKey}")`,
    );

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
    step: PromptStepDefinition,
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
    step: PromptStepDefinition,
    variables: PromptVariables,
  ): string {
    // Validate required UV variables
    // UV dict uses keys without "uv-" prefix (matching substitution regex),
    // but uvVariables entries may include the "uv-" prefix for documentation.
    if (!this.allowMissingVariables && step.uvVariables.length > 0) {
      for (const uvName of step.uvVariables) {
        const key = uvName.startsWith("uv-") ? uvName.slice(3) : uvName;
        if (!variables.uv?.[key]) {
          throw prResolveMissingRequiredUv(uvName, step.stepId);
        }
      }
    }

    // Validate input_text if required
    if (
      !this.allowMissingVariables && step.usesStdin && !variables.inputText
    ) {
      throw prResolveMissingInputText(step.stepId);
    }

    // Substitute UV variables {uv-xxx}
    let result = content.replace(/\{uv-(\w+)\}/g, (_match, name) => {
      const value = variables.uv?.[name];
      if (value === undefined && !this.allowMissingVariables) {
        throw prResolveUvNotProvided(name, step.stepId);
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
  private buildPromptPath(step: PromptStepDefinition): string {
    const edition = step.edition ?? "default";
    const filename = step.adaptation
      ? `f_${edition}_${step.adaptation}.md`
      : `f_${edition}.md`;
    return `${this.registry.c1}/${step.c2}/${step.c3}/${filename}`;
  }

  /**
   * Format C3L path as a human-readable string for log messages
   */
  private formatC3LPath(path: C3LPath): string {
    const edition = path.edition ?? "default";
    const filename = path.adaptation
      ? `f_${edition}_${path.adaptation}.md`
      : `f_${edition}.md`;
    return `${path.c1}/${path.c2}/${path.c3}/${filename}`;
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

/**
 * Create a PromptResolver for an agent, loading its step registry
 * and wiring up the default fallback templates.
 *
 * Shared by verdict factory and runner to avoid duplicating
 * registry loading + fallback wiring logic.
 *
 * @param agentName - Agent identifier
 * @param agentDir - Agent root directory
 * @param registryRelPath - Registry path relative to agentDir
 * @returns Configured PromptResolver
 */
export async function createPromptResolverForAgent(
  agentName: string,
  agentDir: string,
  registryRelPath: string,
): Promise<{ resolver: PromptResolver; registry: StepRegistry }> {
  const { loadStepRegistry, createEmptyRegistry } = await import(
    "./step-registry.ts"
  );
  const { getDefaultFallbackTemplates } = await import(
    "../prompts/fallback.ts"
  );

  let registry;
  try {
    registry = await loadStepRegistry(agentName, agentDir, {
      registryPath: join(agentDir, registryRelPath),
      validateIntentEnums: false,
    });
  } catch {
    registry = createEmptyRegistry(agentName);
  }

  const fallback = createFallbackProvider(getDefaultFallbackTemplates());
  const resolver = new PromptResolver(registry, fallback, {
    workingDir: Deno.cwd(),
    configSuffix: registry.c1,
  });
  return { resolver, registry };
}
