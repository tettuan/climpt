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
import type { PromptResolver as StepPromptResolver } from "../common/prompt-resolver.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";

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
   * `adaptationOverride` (when present) wins over the config-derived
   * `defaultClosureAction` adaptation. This is the entry point for
   * self-route adaptation on the closure step (design 01-self-route-
   * termination §3.2): when `runClosureLoop` advanced the cursor on the
   * previous iteration's `action === "repeat"`, the runner threads the
   * resolved chain element here so the C3L address resolves to the
   * declared variant. When `adaptationOverride` is omitted, behaviour is
   * unchanged from the pre-cursor path.
   *
   * @returns Resolved prompt or null if not a closure step or resolver unavailable
   */
  async tryClosureAdaptation(
    stepId: string,
    ctx: RuntimeContext,
    uvVariables?: Record<string, string>,
    adaptationOverride?: string,
  ): Promise<{ content: string; source: "user" } | null> {
    const stepPromptResolver = this.deps.getStepPromptResolver();
    const stepsRegistry = this.deps.getStepsRegistry();

    // Skip if no step prompt resolver or no registry
    if (!stepPromptResolver || !stepsRegistry) {
      return null;
    }

    // Get step definition and check if it's a closure step
    const stepDef = (stepsRegistry as StepRegistry).steps[stepId];
    if (!stepDef) {
      return null;
    }

    const kind = stepDef.kind;
    if (kind !== "closure") {
      return null;
    }

    // Determine closure action from config (only when GitHub is enabled)
    const githubConfig = this.deps.definition.runner.integrations?.github;
    const closureAction = githubConfig?.enabled !== false
      ? githubConfig?.defaultClosureAction
      : undefined;

    // Resolve the adaptation override. Self-route cursor wins over config
    // — the cursor expresses "what variant should run on this repeat",
    // which supersedes the config-default close action. When neither
    // applies, omit the override entirely so the resolver uses the step's
    // declared `address.adaptation`.
    const overrides = adaptationOverride !== undefined
      ? { adaptation: adaptationOverride }
      : closureAction && closureAction !== "close"
      ? { adaptation: closureAction }
      : undefined;

    try {
      // Build UV dict: prefer caller-provided uvVariables (from runner.buildUvVariables),
      // fall back to minimal dict from CLI args for backward compat
      const uv: Record<string, string> = uvVariables ? { ...uvVariables } : {
        ...(this.deps.args.issue !== undefined && {
          issue: String(this.deps.args.issue),
        }),
      };

      const result = await stepPromptResolver.resolve(
        stepId,
        { uv },
        overrides,
      );

      ctx.logger.info(
        `[ClosureAdaptation] Resolved closure prompt for step "${stepId}"`,
        {
          adaptation: overrides?.adaptation ?? "close",
          source: result.source,
          promptPath: result.promptPath,
        },
      );

      return {
        content: result.content,
        source: result.source,
      };
    } catch (error) {
      ctx.logger.warn(
        `[ClosureAdaptation] Failed to resolve closure prompt, falling back to verdictHandler: ${error}`,
      );
      return null;
    }
  }
}
