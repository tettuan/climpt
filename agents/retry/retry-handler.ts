/**
 * RetryHandler
 *
 * Generates retry prompts based on failure patterns.
 */

import type { Logger } from "../src_common/logger.ts";
import type {
  CompletionPattern,
  CompletionStepConfig,
  ExtendedStepsRegistry,
  ValidatorResult,
} from "./types.ts";
import { C3LPromptLoader } from "../common/c3l-prompt-loader.ts";
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
      configSuffix: "steps",
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
    stepConfig: CompletionStepConfig,
    validationResult: ValidatorResult,
  ): Promise<string> {
    const patternName = validationResult.pattern;

    if (!patternName) {
      this.ctx.logger.warn("No pattern in validation result, using fallback");
      return this.buildFallbackPrompt(stepConfig, validationResult);
    }

    const pattern = this.registry.completionPatterns?.[patternName];

    if (!pattern) {
      this.ctx.logger.warn(`Pattern not found: ${patternName}, using fallback`);
      return this.buildFallbackPrompt(stepConfig, validationResult);
    }

    // C3L path resolution
    const c3lPath = {
      c1: "steps",
      c2: stepConfig.c2, // e.g. "retry"
      c3: stepConfig.c3, // e.g. "issue"
      edition: pattern.edition, // e.g. "failed"
      adaptation: pattern.adaptation, // e.g. "git-dirty"
    };

    this.ctx.logger.debug(
      `[RetryHandler] Loading retry prompt for pattern: ${patternName}`,
      {
        path: c3lPath,
        stepId: stepConfig.stepId,
        workingDir: this.ctx.workingDir,
      },
    );

    const loadResult = await this.promptLoader.load(c3lPath);

    if (!loadResult.ok || !loadResult.content) {
      // Detailed error logging with path information for debugging
      const expectedPath = this.buildExpectedPath(c3lPath);
      this.ctx.logger.warn(
        `[RetryHandler] Failed to load retry prompt: ${loadResult.error}`,
        {
          pattern: patternName,
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

    // Parameter injection
    const params = validationResult.params ?? {};
    const prompt = injectParams(loadResult.content, params);

    this.ctx.logger.debug(
      `Generated retry prompt for pattern: ${patternName}`,
    );

    return prompt;
  }

  /**
   * Build expected file path for debugging
   */
  private buildExpectedPath(c3lPath: {
    c1: string;
    c2: string;
    c3: string;
    edition: string;
    adaptation?: string;
  }): string {
    const filename = c3lPath.adaptation
      ? `f_${c3lPath.edition}_${c3lPath.adaptation}.md`
      : `f_${c3lPath.edition}.md`;
    return `.agent/${this.ctx.agentId}/prompts/${c3lPath.c1}/${c3lPath.c2}/${c3lPath.c3}/${filename}`;
  }

  /**
   * Build fallback prompt
   *
   * Used when pattern-specific prompt is not found.
   */
  private async buildFallbackPrompt(
    stepConfig: CompletionStepConfig,
    validationResult: ValidatorResult,
  ): Promise<string> {
    // Fallback: try f_failed.md
    const c3lPath = {
      c1: "steps",
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
      const params = validationResult.params ?? {};
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
      "## Completion conditions not met",
      "",
    ];

    if (validationResult.pattern) {
      lines.push(`Detected pattern: ${validationResult.pattern}`);
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
   * Get completion pattern
   */
  getPattern(patternName: string): CompletionPattern | undefined {
    return this.registry.completionPatterns?.[patternName];
  }
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
