/**
 * RetryHandler
 *
 * Generates retry prompts based on failure patterns.
 */

import type { Logger } from "../src_common/logger.ts";
import type {
  ExtendedStepsRegistry,
  FailurePattern,
  ValidationStepConfig,
  ValidatorResult,
} from "./types.ts";
import type { SemanticParams } from "../common/validation-types.ts";
import { C3LPromptLoader } from "../common/c3l-prompt-loader.ts";
import { PATHS } from "../shared/paths.ts";
import {
  buildPromptFilePath,
  resolvePromptRoot,
} from "../config/c3l-path-builder.ts";
import { injectParams } from "./param-injector.ts";

/**
 * RetryHandler context
 */
export interface RetryHandlerContext {
  /** Working directory */
  workingDir: string;
  /** Logger */
  logger: Logger;
  /** Agent ID */
  agentId: string;
}

/**
 * RetryHandler
 *
 * Generates pattern-based retry prompts on validation failure.
 * Works with C3LPromptLoader to resolve prompts for failure patterns.
 */
export class RetryHandler {
  private readonly registry: ExtendedStepsRegistry;
  private readonly promptLoader: C3LPromptLoader;
  private readonly ctx: RetryHandlerContext;

  constructor(
    registry: ExtendedStepsRegistry,
    ctx: RetryHandlerContext,
  ) {
    this.registry = registry;
    this.ctx = ctx;
    this.promptLoader = new C3LPromptLoader({
      agentId: ctx.agentId,
      configSuffix: registry.c1,
      workingDir: ctx.workingDir,
    });
  }

  /**
   * Build retry prompt
   *
   * @param stepConfig - Configuration of the failed step
   * @param validationResult - Validation result (contains pattern and params)
   * @returns Generated retry prompt
   */
  async buildRetryPrompt(
    stepConfig: ValidationStepConfig,
    validationResult: ValidatorResult,
  ): Promise<string> {
    const patternName = validationResult.pattern;

    if (!patternName) {
      this.ctx.logger.warn("No pattern in validation result, using fallback");
      return this.buildFallbackPrompt(stepConfig, validationResult);
    }

    let pattern = this.registry.failurePatterns?.[patternName];
    let resolvedPatternName = patternName;

    if (!pattern) {
      // Exact match failed — attempt semantic fuzzy matching
      const bestMatch = this.findBestPattern(validationResult);
      if (bestMatch) {
        this.ctx.logger.info(
          `[RetryHandler] Pattern "${patternName}" not found, ` +
            `semantic match selected "${bestMatch.name}" (score: ${bestMatch.score})`,
        );
        pattern = bestMatch.pattern;
        resolvedPatternName = bestMatch.name;
      } else {
        this.ctx.logger.warn(
          `Pattern not found: ${patternName}, using fallback`,
        );
        return this.buildFallbackPrompt(stepConfig, validationResult);
      }
    }

    // C3L path resolution
    const c3lPath = {
      c1: this.registry.c1,
      c2: stepConfig.c2, // e.g. "retry"
      c3: stepConfig.c3, // e.g. "issue"
      edition: pattern.edition, // e.g. "failed"
      adaptation: pattern.adaptation, // e.g. "git-dirty"
    };

    this.ctx.logger.debug(
      `[RetryHandler] Loading retry prompt for pattern: ${resolvedPatternName}`,
      {
        path: c3lPath,
        stepId: stepConfig.stepId,
        workingDir: this.ctx.workingDir,
      },
    );

    const loadResult = await this.promptLoader.load(c3lPath);

    if (!loadResult.ok || !loadResult.content) {
      // Detailed error logging with path information for debugging
      const expectedPath = await this.buildExpectedPath(c3lPath);
      this.ctx.logger.warn(
        `[RetryHandler] Failed to load retry prompt: ${loadResult.error}`,
        {
          pattern: resolvedPatternName,
          stepId: stepConfig.stepId,
          c3lPath,
          expectedPath,
          workingDir: this.ctx.workingDir,
          agentId: this.ctx.agentId,
          error: loadResult.error,
        },
      );
      return this.buildFallbackPrompt(stepConfig, validationResult);
    }

    // Parameter injection (merge semantic params if available)
    const params = mergeSemanticParams(
      validationResult.params ?? {},
      validationResult.semanticParams,
    );
    const prompt = injectParams(loadResult.content, params);

    this.ctx.logger.debug(
      `Generated retry prompt for pattern: ${resolvedPatternName}`,
    );

    return prompt;
  }

  /**
   * Build expected file path for debugging.
   * Resolves promptRoot from app.yml to match runtime path resolution.
   */
  private async buildExpectedPath(c3lPath: {
    c1: string;
    c2: string;
    c3: string;
    edition: string;
    adaptation?: string;
  }): Promise<string> {
    const promptRoot = await resolvePromptRoot(
      this.ctx.workingDir,
      this.ctx.agentId,
      c3lPath.c1,
    );
    if (promptRoot) {
      return buildPromptFilePath(promptRoot, c3lPath);
    }
    // Fallback for debug display when app.yml is unavailable
    const agentDir = `${PATHS.AGENT_DIR_PREFIX}/${this.ctx.agentId}`;
    return `${agentDir}/prompts/${c3lPath.c1}/${c3lPath.c2}/${c3lPath.c3}/f_${c3lPath.edition}${
      c3lPath.adaptation ? `_${c3lPath.adaptation}` : ""
    }.md`;
  }

  /**
   * Build fallback prompt
   *
   * Used when pattern-specific prompt is not found.
   */
  private async buildFallbackPrompt(
    stepConfig: ValidationStepConfig,
    validationResult: ValidatorResult,
  ): Promise<string> {
    // Fallback: try f_failed.md
    const c3lPath = {
      c1: this.registry.c1,
      c2: stepConfig.c2,
      c3: stepConfig.c3,
      edition: "failed",
    };

    this.ctx.logger.debug(
      `[RetryHandler] Attempting fallback prompt load`,
      {
        path: c3lPath,
        stepId: stepConfig.stepId,
      },
    );

    const loadResult = await this.promptLoader.load(c3lPath);

    if (loadResult.ok && loadResult.content) {
      this.ctx.logger.debug(
        `[RetryHandler] Loaded fallback prompt successfully`,
        { path: c3lPath },
      );
      const params = mergeSemanticParams(
        validationResult.params ?? {},
        validationResult.semanticParams,
      );
      return injectParams(loadResult.content, params);
    }

    // Log fallback failure with detailed path info
    const expectedPath = this.buildExpectedPath(c3lPath);
    this.ctx.logger.warn(
      `[RetryHandler] Fallback prompt not found, using generic message`,
      {
        stepId: stepConfig.stepId,
        expectedPath,
        error: loadResult.error,
      },
    );

    // Final fallback: generic message
    return this.buildGenericRetryPrompt(validationResult);
  }

  /**
   * Build generic retry prompt
   */
  private buildGenericRetryPrompt(
    validationResult: ValidatorResult,
  ): string {
    const lines: string[] = [
      "## Verdict conditions not met",
      "",
    ];

    if (validationResult.pattern) {
      lines.push(`Detected pattern: ${validationResult.pattern}`);
      lines.push("");
    }

    // Include semantic summary and context when available
    const sp = validationResult.semanticParams;
    if (sp) {
      lines.push(`**Summary:** ${sp.summary}`);
      lines.push(`**Severity:** ${sp.severity}`);
      if (sp.rootCause) {
        lines.push(`**Root cause:** ${sp.rootCause}`);
      }
      if (sp.suggestedAction) {
        lines.push(`**Suggested action:** ${sp.suggestedAction}`);
      }
      if (sp.relatedFiles.length > 0) {
        lines.push("**Related files:**");
        for (const file of sp.relatedFiles) {
          lines.push(`- ${file}`);
        }
      }
      lines.push("");
    }

    if (validationResult.error) {
      lines.push("### Error details");
      lines.push("```");
      lines.push(validationResult.error);
      lines.push("```");
      lines.push("");
    }

    if (validationResult.params) {
      lines.push("### Details");
      for (const [key, value] of Object.entries(validationResult.params)) {
        if (Array.isArray(value) && value.length > 0) {
          lines.push(`**${key}:**`);
          for (const item of value) {
            if (typeof item === "object") {
              lines.push(`- ${JSON.stringify(item)}`);
            } else {
              lines.push(`- ${item}`);
            }
          }
        } else if (typeof value === "string" && value.trim()) {
          lines.push(`**${key}:** ${value}`);
        }
      }
      lines.push("");
    }

    lines.push("Please resolve this issue and try completing again.");

    return lines.join("\n");
  }

  /**
   * Find the best matching failure pattern via semantic keyword matching.
   *
   * Iterates all registered failurePatterns and checks each pattern's
   * `semanticMatch` keywords against the validation result's error output
   * and string params. Returns the highest-scoring match, or undefined
   * if no pattern scores above zero.
   */
  findBestPattern(
    validationResult: ValidatorResult,
  ): { name: string; pattern: FailurePattern; score: number } | undefined {
    const patterns = this.registry.failurePatterns;
    if (!patterns) return undefined;

    // Build the corpus to match against: error text + string param values
    const corpus = buildMatchCorpus(validationResult);
    if (!corpus) return undefined;

    let bestName: string | undefined;
    let bestPattern: FailurePattern | undefined;
    let bestScore = 0;

    for (const [name, pattern] of Object.entries(patterns)) {
      const keywords = pattern.semanticMatch;
      if (!keywords || keywords.length === 0) continue;

      const score = scoreKeywords(keywords, corpus);
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
        bestPattern = pattern;
      }
    }

    if (bestName && bestPattern && bestScore > 0) {
      return { name: bestName, pattern: bestPattern, score: bestScore };
    }

    return undefined;
  }

  /**
   * Get failure pattern
   */
  getPattern(patternName: string): FailurePattern | undefined {
    return this.registry.failurePatterns?.[patternName];
  }
}

/**
 * Build a single string corpus from the validation result for keyword matching.
 *
 * Concatenates the error message, string-valued params, and semantic summary
 * into a single lowercased string for efficient keyword search.
 *
 * @internal Exported for testing
 */
export function buildMatchCorpus(result: ValidatorResult): string | undefined {
  const parts: string[] = [];

  if (result.error) {
    parts.push(result.error);
  }

  if (result.params) {
    for (const value of Object.values(result.params)) {
      if (typeof value === "string") {
        parts.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            parts.push(item);
          }
        }
      }
    }
  }

  if (result.semanticParams?.summary) {
    parts.push(result.semanticParams.summary);
  }
  if (result.semanticParams?.rootCause) {
    parts.push(result.semanticParams.rootCause);
  }

  if (parts.length === 0) return undefined;
  return parts.join(" ").toLowerCase();
}

/**
 * Score how well a set of keywords matches against a corpus string.
 *
 * Each keyword is treated as a case-insensitive substring search.
 * If a keyword starts and ends with `/`, it is treated as a regex pattern.
 * Returns the count of matching keywords.
 *
 * @internal Exported for testing
 */
export function scoreKeywords(keywords: string[], corpus: string): number {
  let score = 0;

  for (const keyword of keywords) {
    // Regex keyword: /pattern/
    if (
      keyword.length >= 3 &&
      keyword.startsWith("/") &&
      keyword.endsWith("/")
    ) {
      const regexBody = keyword.slice(1, -1);
      try {
        const re = new RegExp(regexBody, "i");
        if (re.test(corpus)) {
          score++;
        }
      } catch {
        // Invalid regex — skip silently
      }
    } else {
      // Plain keyword — case-insensitive substring match
      if (corpus.includes(keyword.toLowerCase())) {
        score++;
      }
    }
  }

  return score;
}

/**
 * Merges semantic params into the template params record
 *
 * Adds {{summary}}, {{rootCause}}, {{suggestedAction}}, and {{relatedFiles}}
 * to the params without overwriting existing keys. Templates that reference
 * these variables get semantic context; templates that don't simply ignore them.
 */
function mergeSemanticParams(
  params: Record<string, unknown>,
  semantic: SemanticParams | undefined,
): Record<string, unknown> {
  if (!semantic) {
    return params;
  }

  const merged = { ...params };

  // Only set if not already present in raw params
  if (!("summary" in merged)) {
    merged.summary = semantic.summary;
  }
  if (!("rootCause" in merged) && semantic.rootCause) {
    merged.rootCause = semantic.rootCause;
  }
  if (!("suggestedAction" in merged) && semantic.suggestedAction) {
    merged.suggestedAction = semantic.suggestedAction;
  }
  if (!("relatedFiles" in merged)) {
    merged.relatedFiles = semantic.relatedFiles;
  }
  if (!("severity" in merged)) {
    merged.severity = semantic.severity;
  }

  return merged;
}

/**
 * RetryHandler factory function
 */
export function createRetryHandler(
  registry: ExtendedStepsRegistry,
  ctx: RetryHandlerContext,
): RetryHandler {
  return new RetryHandler(registry, ctx);
}
