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
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import type { AgentEventEmitter } from "./events.ts";
import type { CloseEventBus } from "../events/bus.ts";
import type { SubjectRef } from "../orchestrator/workflow-types.ts";

export interface BoundaryHookDeps {
  getStepsRegistry(): ExtendedStepsRegistry | null;
  getEventEmitter(): AgentEventEmitter;
  /**
   * T3.3 (shadow mode): optional accessor for the frozen
   * {@link CloseEventBus} from `BootArtifacts.bus`. When undefined the
   * boundary hook publishes nothing — the internal `eventEmitter`
   * stays the only signal path. Production runs (run-workflow /
   * run-agent) thread the bus through; standalone tests omit it.
   */
  getBus?(): CloseEventBus | undefined;
  /** Stable boot correlation id; paired with {@link getBus}. */
  getRunId?(): string;
  /**
   * Best-effort subject id resolver. Boundary hooks do not own a
   * subject directly (the runner's `args.issue` is the canonical
   * source); the runner injects this getter so the published event
   * carries the subject without changing the hook signature.
   */
  getSubjectId?(): SubjectRef | undefined;
  /**
   * Agent id (from `definition.name`) — the boundary hook publishes
   * `closureBoundaryReached` whose payload requires it. Provided as a
   * getter so the runner can defer until `initialize` has run.
   */
  getAgentId?(): string | undefined;
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
    const stepKind = stepDef?.kind;

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
      kind: stepKind,
      structuredOutput: summary.structuredOutput,
    });

    // T3.3 (shadow mode): mirror the internal emitter onto the closed
    // {@link CloseEventBus} so subscribers (diagnostic logger today,
    // BoundaryClose channel in P4) observe `ClosureBoundaryReached`
    // without coupling to the legacy AgentEventEmitter shape. The
    // publish is fire-and-forget and the bus swallows handler errors,
    // so this branch can never fail the close path. The event is only
    // published when every payload field is available — the bus's
    // closed ADT forbids partial events.
    const bus = this.deps.getBus?.();
    const agentId = this.deps.getAgentId?.();
    if (bus && agentId !== undefined) {
      bus.publish({
        kind: "closureBoundaryReached",
        publishedAt: Date.now(),
        runId: this.deps.getRunId?.() ?? "",
        subjectId: this.deps.getSubjectId?.(),
        agentId,
        stepId,
      });
    }

    ctx.logger.info(`[BoundaryHook] Invoked for closure step: ${stepId}`);

    // Delegate to verdictHandler for actual side effects
    // The verdictHandler is responsible for implementing the boundary actions
    // based on the agent's configuration
    if (ctx.verdictHandler.onBoundaryHook) {
      await ctx.verdictHandler.onBoundaryHook({
        stepId,
        kind: stepKind,
        structuredOutput: summary.structuredOutput,
      });
    }
  }
}
