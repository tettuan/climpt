/**
 * Flow Orchestrator - step flow routing and transition management.
 *
 * Handles:
 * - Determining step IDs for iterations (entry step, routed step)
 * - Step transition via structured gate routing
 * - stepId normalization in structured output
 * - Recording step output to step context
 *
 * Extracted from runner.ts for separation of concerns.
 */

import type {
  AgentDefinition,
  IterationSummary,
  RuntimeContext,
} from "../src_common/types.ts";
import { isRecord, isString } from "../src_common/type-guards.ts";
import type { PromptStepDefinition } from "../common/step-registry.ts";
import { inferStepKind } from "../common/step-registry.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import { StepContextImpl } from "../loop/step-context.ts";
import type { StepContext } from "../src_common/contracts.ts";
import type { StepGateInterpreter } from "./step-gate-interpreter.ts";
import type { RoutingResult, WorkflowRouter } from "./workflow-router.ts";
import { PATHS } from "../shared/paths.ts";

export interface FlowOrchestratorDeps {
  readonly definition: AgentDefinition;
  readonly args: Record<string, unknown>;
  getStepsRegistry(): ExtendedStepsRegistry | null;
  getStepGateInterpreter(): StepGateInterpreter | null;
  getWorkflowRouter(): WorkflowRouter | null;
  hasFlowRoutingEnabled(): boolean;
}

export class FlowOrchestrator {
  private readonly deps: FlowOrchestratorDeps;

  // Step flow orchestration
  stepContext: StepContextImpl | null = null;
  currentStepId: string | null = null;

  // Flag to skip StepGate when schema resolution failed
  private schemaResolutionFailed = false;

  constructor(deps: FlowOrchestratorDeps) {
    this.deps = deps;
  }

  /**
   * Initialize step context for a new run.
   */
  initializeStepContext(): void {
    this.stepContext = new StepContextImpl();
    this.currentStepId = this.getStepIdForIteration(1);
  }

  /**
   * Set schema resolution failed flag.
   */
  setSchemaResolutionFailed(failed: boolean): void {
    this.schemaResolutionFailed = failed;
  }

  /**
   * Get the step context for data passing between steps.
   */
  getStepContext(): StepContext | null {
    return this.stepContext;
  }

  /**
   * Get step ID for a given iteration.
   *
   * For iteration 1: Uses entryStepMapping or entryStep from registry.
   * For iteration > 1: Requires currentStepId to be set by structured gate routing.
   */
  getStepIdForIteration(iteration: number): string {
    // For iteration > 1, require routed step ID
    if (iteration > 1) {
      if (!this.currentStepId) {
        throw new Error(
          `[StepFlow] No routed step ID for iteration ${iteration}. ` +
            `All Flow steps must define structuredGate with transitions. ` +
            `Check ${PATHS.STEPS_REGISTRY} for missing gate configuration.`,
        );
      }
      return this.currentStepId;
    }

    const stepsRegistry = this.deps.getStepsRegistry();

    // For iteration 1: Use registry-based lookup
    const completionType = this.deps.definition.behavior.completionType;

    // Try entryStepMapping first
    if (stepsRegistry?.entryStepMapping?.[completionType]) {
      return stepsRegistry.entryStepMapping[completionType];
    }

    // Try generic entryStep
    if (stepsRegistry?.entryStep) {
      return stepsRegistry.entryStep;
    }

    // No implicit fallback - entry step must be explicitly configured
    throw new Error(
      `[StepFlow] No entry step configured for completionType "${completionType}". ` +
        `Define either "entryStepMapping.${completionType}" or "entryStep" in ${PATHS.STEPS_REGISTRY}.`,
    );
  }

  /**
   * Normalize stepId in structured output to match Flow's canonical value.
   */
  normalizeStructuredOutputStepId(
    expectedStepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): void {
    // Skip normalization if no structured output
    if (!summary.structuredOutput) {
      return;
    }

    const structuredOutput = summary.structuredOutput;
    const stepsRegistry = this.deps.getStepsRegistry();

    // Check if stepId exists in structured output
    if (!isRecord(structuredOutput) || !isString(structuredOutput.stepId)) {
      ctx.logger.debug(
        `[StepFlow] No stepId in structured output, skipping normalization`,
      );
      return;
    }

    const actualStepId = structuredOutput.stepId;

    // Normalize stepId if it differs from expected
    if (actualStepId !== expectedStepId) {
      // Get step name for telemetry
      const stepName = stepsRegistry?.steps[expectedStepId]?.name ??
        expectedStepId;
      // Get issue number if available
      const issueNumber = this.deps.args.issue;

      ctx.logger.warn(
        `[StepFlow] stepId corrected: "${actualStepId}" -> "${expectedStepId}" ` +
          `(Flow owns canonical stepId)`,
        {
          step: stepName,
          expectedStepId,
          actualStepId,
          ...(issueNumber !== undefined && { issue: issueNumber }),
        },
      );

      // Correct the value (Flow is single source of truth)
      (structuredOutput as Record<string, unknown>).stepId = expectedStepId;
    } else {
      ctx.logger.debug(
        `[StepFlow] stepId matches expected: ${actualStepId}`,
      );
    }
  }

  /**
   * Record step output to step context.
   */
  recordStepOutput(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): void {
    if (!this.stepContext) return;

    const output: Record<string, unknown> = {};

    if (summary.structuredOutput) {
      Object.assign(output, summary.structuredOutput);
    }

    output.iteration = summary.iteration;
    output.sessionId = summary.sessionId;

    if (summary.errors.length > 0) {
      output.hasErrors = true;
      output.errorCount = summary.errors.length;
    }

    this.stepContext.set(stepId, output);
    this.currentStepId = stepId;

    ctx.logger.debug(
      `[StepFlow] Recorded output for step: ${stepId}`,
      { outputKeys: Object.keys(output) },
    );
  }

  /**
   * Handle step transition using structured gate routing.
   *
   * Returns null if prerequisites are not met, which will cause
   * getStepIdForIteration() to error on the next iteration.
   */
  handleStepTransition(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): RoutingResult | null {
    // Skip StepGate when schema resolution failed (StructuredOutputUnavailable)
    if (this.schemaResolutionFailed) {
      ctx.logger.info(
        `[StepFlow] Skipping StepGate routing: StructuredOutputUnavailable for step "${stepId}"`,
      );
      // Keep currentStepId unchanged to retry the same step
      return null;
    }
    return this.tryStructuredGateRouting(stepId, summary, ctx);
  }

  /**
   * Try to route using structured gate if configured.
   */
  private tryStructuredGateRouting(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): RoutingResult | null {
    const stepsRegistry = this.deps.getStepsRegistry();
    const stepGateInterpreter = this.deps.getStepGateInterpreter();
    const workflowRouter = this.deps.getWorkflowRouter();

    // Check prerequisites
    if (!stepsRegistry || !stepGateInterpreter || !workflowRouter) {
      return null;
    }

    if (!summary.structuredOutput) {
      return null;
    }

    // Get step definition
    const stepDef = stepsRegistry.steps[stepId] as
      | PromptStepDefinition
      | undefined;
    if (!stepDef?.structuredGate) {
      return null;
    }

    // Get step kind for logging
    const stepKind = inferStepKind(stepDef);

    // Interpret structured output through the gate
    const interpretation = stepGateInterpreter.interpret(
      summary.structuredOutput,
      stepDef,
    );

    ctx.logger.info(`[StepFlow] Interpreted intent: ${interpretation.intent}`, {
      stepId,
      stepKind,
      target: interpretation.target,
      usedFallback: interpretation.usedFallback,
      reason: interpretation.reason,
    });

    // Merge handoff into step context
    if (interpretation.handoff && this.stepContext) {
      this.stepContext.set(stepId, interpretation.handoff);
      ctx.logger.debug(`[StepFlow] Stored handoff data for step: ${stepId}`, {
        handoffKeys: Object.keys(interpretation.handoff),
      });
    }

    // Route to next step
    const routing = workflowRouter.route(stepId, interpretation);

    // Log warning if present (e.g., handoff from initial step)
    if (routing.warning) {
      ctx.logger.warn(`[StepFlow] ${routing.warning}`);
    }

    ctx.logger.info(
      `[StepFlow] Routing decision: ${stepId} -> ${routing.nextStepId}`,
      {
        stepKind,
        intent: interpretation.intent,
        signalCompletion: routing.signalCompletion,
        reason: routing.reason,
      },
    );

    // Update current step ID
    if (!routing.signalCompletion && routing.nextStepId !== stepId) {
      this.currentStepId = routing.nextStepId;
    }

    return routing;
  }
}
