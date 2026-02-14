/**
 * Boundary Hooks - external side-effect invocation for closure steps.
 *
 * Boundary hook is the single surface for external side effects:
 * - Issue close
 * - Release publish
 * - PR merge
 *
 * Work/Verification steps cannot mutate issues directly - all external
 * state changes must flow through this hook.
 *
 * Extracted from runner.ts for separation of concerns.
 *
 * @see agents/docs/design/08_step_flow_design.md Section 7.1
 */

import type { IterationSummary, RuntimeContext } from "../src_common/types.ts";
import type { PromptStepDefinition } from "../common/step-registry.ts";
import { inferStepKind } from "../common/step-registry.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type { AgentEventEmitter } from "./events.ts";

export interface BoundaryHookDeps {
  getStepsRegistry(): ExtendedStepsRegistry | null;
  getEventEmitter(): AgentEventEmitter;
}

export class BoundaryHooks {
  private readonly deps: BoundaryHookDeps;

  constructor(deps: BoundaryHookDeps) {
    this.deps = deps;
  }

  /**
   * Invoke boundary hook when a closure step emits `closing` intent.
   *
   * @see agents/docs/design/08_step_flow_design.md Section 7.1
   */
  async invokeBoundaryHook(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): Promise<void> {
    const stepsRegistry = this.deps.getStepsRegistry();

    // Only invoke for closure steps
    const stepDef = stepsRegistry?.steps[stepId] as
      | PromptStepDefinition
      | undefined;
    const stepKind = stepDef ? inferStepKind(stepDef) : undefined;

    if (stepKind !== "closure") {
      ctx.logger.debug(
        `[BoundaryHook] Skipping: step "${stepId}" is not a closure step (kind: ${
          stepKind ?? "unknown"
        })`,
      );
      return;
    }

    // Emit boundaryHook event for external handlers
    await this.deps.getEventEmitter().emit("boundaryHook", {
      stepId,
      stepKind,
      structuredOutput: summary.structuredOutput,
    });

    ctx.logger.info(`[BoundaryHook] Invoked for closure step: ${stepId}`);

    // Delegate to completionHandler for actual side effects
    // The completionHandler is responsible for implementing the boundary actions
    // based on the agent's configuration
    if (ctx.completionHandler.onBoundaryHook) {
      await ctx.completionHandler.onBoundaryHook({
        stepId,
        stepKind,
        structuredOutput: summary.structuredOutput,
      });
    }
  }
}
