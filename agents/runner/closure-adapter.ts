/**
 * Closure Adapter - resolves closure step prompts with adaptation override.
 *
 * When the current step is a closure step, resolves the closure prompt
 * with the appropriate adaptation (e.g., "label-only", "label-and-close")
 * based on agent config.
 *
 * Extracted from runner.ts for separation of concerns.
 */

import type { AgentDefinition, RuntimeContext } from "../src_common/types.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import { inferStepKind } from "../common/step-registry.ts";
import type { PromptResolver as StepPromptResolver } from "../common/prompt-resolver.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";

export interface ClosureAdapterDeps {
  readonly definition: AgentDefinition;
  readonly args: Record<string, unknown>;
  getStepPromptResolver(): StepPromptResolver | null;
  getStepsRegistry(): ExtendedStepsRegistry | null;
}

export class ClosureAdapter {
  private readonly deps: ClosureAdapterDeps;

  constructor(deps: ClosureAdapterDeps) {
    this.deps = deps;
  }

  /**
   * Try to resolve a closure step prompt with adaptation override.
   *
   * @returns Resolved prompt or null if not a closure step or resolver unavailable
   */
  async tryClosureAdaptation(
    stepId: string,
    ctx: RuntimeContext,
  ): Promise<{ content: string; source: "user" | "fallback" } | null> {
    const stepPromptResolver = this.deps.getStepPromptResolver();
    const stepsRegistry = this.deps.getStepsRegistry();

    // Skip if no step prompt resolver or no registry
    if (!stepPromptResolver || !stepsRegistry) {
      return null;
    }

    // Get step definition and check if it's a closure step
    const stepDef = (stepsRegistry as unknown as StepRegistry).steps?.[stepId];
    if (!stepDef) {
      return null;
    }

    const stepKind = inferStepKind(stepDef);
    if (stepKind !== "closure") {
      return null;
    }

    // Determine closure action from config
    const closureAction = this.deps.definition.runner.integrations?.github
      ?.defaultClosureAction;

    // Only use adaptation override for non-default actions
    const overrides = closureAction && closureAction !== "close"
      ? { adaptation: closureAction }
      : undefined;

    try {
      const result = await stepPromptResolver.resolve(
        stepId,
        {
          uv: {
            ...(this.deps.args.issue !== undefined && {
              issue_number: String(this.deps.args.issue),
            }),
          },
        },
        overrides,
      );

      ctx.logger.info(
        `[ClosureAdaptation] Resolved closure prompt for step "${stepId}"`,
        {
          adaptation: closureAction ?? "close",
          source: result.source,
          promptPath: result.promptPath,
        },
      );

      return {
        content: result.content,
        source: result.source,
      };
    } catch (error) {
      ctx.logger.debug(
        `[ClosureAdaptation] Failed to resolve closure prompt, falling back to completionHandler: ${error}`,
      );
      return null;
    }
  }
}
