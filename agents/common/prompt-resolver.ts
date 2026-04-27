/**
 * Prompt Resolver - External Prompt Resolution System
 *
 * Resolves prompts via breakdown (C3L) only. No fallback to embedded prompts.
 * Key features:
 * - Uses C3LPromptLoader to call runBreakdown
 * - Throws PR-C3L-002 on non-file-not-found C3L errors (UV, frontmatter, YAML)
 * - Throws PR-C3L-004 when C3L prompt file cannot be found
 * - Variable substitution for {uv-xxx} and {input_text}
 * - Frontmatter removal for clean prompt content
 */

import type { PromptStepDefinition, StepRegistry } from "./step-registry.ts";
import {
  type BreakdownErrorKind,
  type C3LPath,
  C3LPromptLoader,
} from "./c3l-prompt-loader.ts";
import {
  prC3lBreakdownFailed,
  prC3lPromptNotFound,
  prResolveMissingInputText,
  prResolveMissingRequiredUv,
  prResolveUnknownStepId,
  prResolveUvNotProvided,
} from "../shared/errors/config-errors.ts";

/**
 * BreakdownErrorKind values that the resolver treats as "prompt file not
 * found". TemplateNotFound is the only unambiguous signal: it means the
 * configured path resolved to a file that does not exist on disk.
 *
 * ParameterParsingError is NOT included. Breakdown emits it for two
 * unrelated conditions — an unrecognized c2/c3 directive *and* a UV
 * value that trips breakdown's own security check (e.g. shell
 * metacharacters in `previous_summary`). Classifying both as
 * PR-C3L-004 ("file not found") makes the error message lie when the
 * underlying cause is a UV value. Let it surface as PR-C3L-002 so the
 * breakdown detail string propagates verbatim and the real cause is
 * visible to the user.
 *
 * Exported so tests can iterate without duplicating the membership list
 * (partial-enumeration anti-pattern).
 */
export const FILE_NOT_FOUND_KINDS = [
  "TemplateNotFound",
] as const satisfies readonly BreakdownErrorKind[];

export type FileNotFoundKind = typeof FILE_NOT_FOUND_KINDS[number];

function isFileNotFoundKind(
  kind: BreakdownErrorKind,
): kind is FileNotFoundKind {
  return (FILE_NOT_FOUND_KINDS as readonly BreakdownErrorKind[]).includes(kind);
}

/**
 * Result of prompt resolution
 */
export interface PromptResolutionResult {
  /** Resolved prompt content (variables substituted, frontmatter removed) */
  content: string;

  /** Source of the prompt */
  source: "user";

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
 * Options for PromptResolver
 */
export interface PromptResolverOptions {
  /** Working directory for relative path resolution */
  workingDir?: string;

  /** Whether to strip frontmatter from prompts (default: true) */
  stripFrontmatter?: boolean;

  /** Whether to allow missing variables (default: false - throws error) */
  allowMissingVariables?: boolean;

  /** Config suffix for C3LPromptLoader (e.g., "dev" results in config="iterator-dev") */
  configSuffix?: string;
}

/**
 * PromptResolver - Resolves prompts via breakdown (C3L) only
 *
 * Usage:
 * ```typescript
 * const resolver = new PromptResolver(registry, { configSuffix: "steps" });
 * const result = await resolver.resolve("initial.issue", {
 *   uv: { issue: "123", repository: "owner/repo" }
 * });
 * console.log(result.content);
 * ```
 */
export class PromptResolver {
  private workingDir: string;
  private stripFrontmatter: boolean;
  private allowMissingVariables: boolean;
  private c3lLoader: C3LPromptLoader;

  /**
   * Create a new PromptResolver
   *
   * @param registry - Step registry containing step definitions
   * @param options - Resolver options
   */
  constructor(
    private readonly registry: StepRegistry,
    options: PromptResolverOptions = {},
  ) {
    this.workingDir = options.workingDir ?? Deno.cwd();
    this.stripFrontmatter = options.stripFrontmatter ?? true;
    this.allowMissingVariables = options.allowMissingVariables ?? false;

    this.c3lLoader = new C3LPromptLoader({
      agentId: registry.agentId,
      configSuffix: options.configSuffix ?? registry.c1,
      workingDir: this.workingDir,
    });
  }

  /**
   * Resolve a prompt by step ID
   *
   * Resolution: Try breakdown via C3LPromptLoader. Throws if not found.
   *
   * @param stepId - Step identifier to resolve
   * @param variables - Variables for substitution
   * @param overrides - Optional overrides (adaptation)
   * @returns Resolution result with content and metadata
   */
  async resolve(
    stepId: string,
    variables?: PromptVariables,
    overrides?: { adaptation?: string },
  ): Promise<PromptResolutionResult> {
    // Default variables if not provided
    variables = variables ?? {};
    const step = this.registry.steps[stepId];
    if (!step) {
      throw prResolveUnknownStepId(stepId);
    }

    // Apply adaptation override if provided. The override targets the C3L
    // address aggregate (`step.address.adaptation`); a shallow-spread copy
    // of `address` keeps the rest of the address (c1/c2/c3/edition) intact.
    const effectiveStep = overrides?.adaptation
      ? {
        ...step,
        address: { ...step.address, adaptation: overrides.adaptation },
      }
      : step;

    // tryBreakdown returns the resolved prompt or throws. PR-C3L-004 is
    // thrown for file-not-found conditions (with breakdown's attemptedPaths
    // preserved as diagnostic detail); PR-C3L-002 is thrown for other
    // structured failures so user-correctable issues propagate verbatim.
    return await this.tryBreakdown(effectiveStep, variables);
  }

  /**
   * Build C3L path from step definition.
   *
   * The step's `address: C3LAddress` already carries c1/c2/c3/edition/
   * adaptation; we surface it as a C3LPath for the loader. The registry's
   * top-level `c1` is the source of truth for c1 and is preserved here.
   */
  private buildC3LPath(step: PromptStepDefinition): C3LPath {
    return {
      c1: this.registry.c1,
      c2: step.address.c2,
      c3: step.address.c3,
      edition: step.address.edition,
      adaptation: step.address.adaptation,
    };
  }

  /**
   * Try to resolve via breakdown (C3LPromptLoader).
   *
   * Returns the resolved prompt on success, or throws a structured
   * ConfigError. File-not-found conditions (TemplateNotFound /
   * ParameterParsingError) throw PR-C3L-004 with breakdown's attemptedPaths
   * preserved as diagnostic detail. All other structured errors throw
   * PR-C3L-002 so user-correctable issues (UV undefined, frontmatter
   * broken, YAML parse failure, etc.) propagate verbatim.
   *
   * @throws ConfigError (PR-C3L-004) if the prompt file is not found
   * @throws ConfigError (PR-C3L-002) if breakdown fails with a
   *   non-file-not-found error
   */
  private async tryBreakdown(
    step: PromptStepDefinition,
    variables: PromptVariables,
  ): Promise<PromptResolutionResult> {
    const c3lPath = this.buildC3LPath(step);

    const result = await this.c3lLoader.load(c3lPath, {
      uv: variables.uv,
      inputText: variables.inputText,
    });

    if (!result.ok || !result.content) {
      // Dispatch on errorKind via FILE_NOT_FOUND_KINDS (exported source of
      // truth). TemplateNotFound = file missing on disk; ParameterParsingError
      // = breakdown rejects the c2/c3 directive — both surface as PR-C3L-004
      // with breakdown's own attemptedPaths preserved as diagnostic detail.
      // Any other kind is user-correctable and must propagate verbatim as
      // PR-C3L-002.
      if (result.errorKind && isFileNotFoundKind(result.errorKind)) {
        throw prC3lPromptNotFound(
          step.stepId,
          this.formatC3LPath(c3lPath),
          result.error,
        );
      }
      throw prC3lBreakdownFailed(
        step.stepId,
        result.error ?? "<no error detail>",
      );
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
   * Format C3L path as a human-readable string for log/error messages.
   * Uses C3L logical coordinates only — Runner does not resolve physical paths.
   */
  private formatC3LPath(path: C3LPath): string {
    const edition = path.edition ?? "default";
    const filename = path.adaptation
      ? `f_${edition}_${path.adaptation}.md`
      : `f_${edition}.md`;
    return `${path.c1}/${path.c2}/${path.c3}/${filename}`;
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
