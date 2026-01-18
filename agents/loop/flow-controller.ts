/**
 * FlowController - Step advancement and handoff management
 *
 * Responsibility: entryStep tracking, handoff updates, prompt resolution only.
 *
 * Core of the Flow loop - executes steps in sequence and
 * passes handoff to next step. Does not perform completion checks.
 */

import type { StepContext } from "../src_common/contracts.ts";
import type { PromptResolver } from "../prompts/resolver.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type { PromptStepDefinition } from "../common/step-registry.ts";
import type { Logger } from "../src_common/logger.ts";
import { StepContextImpl } from "./step-context.ts";

/**
 * Flow iteration snapshot - what Flow produces each iteration
 */
export interface FlowIterationSnapshot {
  /** Current step ID */
  stepId: string;
  /** Iteration number */
  iteration: number;
  /** Handoff data from this step */
  handoff: Record<string, unknown>;
  /** Whether completion signal was detected */
  completionSignal: boolean;
  /** Structured output if available */
  structuredOutput?: Record<string, unknown>;
}

/**
 * FlowController configuration
 */
export interface FlowControllerConfig {
  /** Steps registry with step definitions */
  registry: ExtendedStepsRegistry;
  /** Prompt resolver for C3L prompts */
  promptResolver: PromptResolver;
  /** Logger instance */
  logger: Logger;
  /** Completion type from agent definition */
  completionType: string;
}

/**
 * FlowController - manages step progression and handoff
 */
export class FlowController {
  private readonly registry: ExtendedStepsRegistry;
  private readonly promptResolver: PromptResolver;
  private readonly logger: Logger;
  private readonly completionType: string;
  private readonly stepContext: StepContextImpl;

  private currentStepId: string;
  private iteration = 0;

  constructor(config: FlowControllerConfig) {
    this.registry = config.registry;
    this.promptResolver = config.promptResolver;
    this.logger = config.logger;
    this.completionType = config.completionType;
    this.stepContext = new StepContextImpl();

    // Determine entry step
    this.currentStepId = this.getEntryStepId();
    this.logger.debug(`[FlowController] Entry step: ${this.currentStepId}`);
  }

  /**
   * Get entry step ID based on completion type
   */
  private getEntryStepId(): string {
    // Check for entryStepMapping first
    const mapping = this.registry.entryStepMapping;
    if (mapping && mapping[this.completionType]) {
      return mapping[this.completionType];
    }

    // Fall back to entryStep
    return this.registry.entryStep ?? `initial.${this.completionType}`;
  }

  /**
   * Get current step ID
   */
  getCurrentStepId(): string {
    return this.currentStepId;
  }

  /**
   * Get current iteration
   */
  getCurrentIteration(): number {
    return this.iteration;
  }

  /**
   * Get step context for handoff data access
   */
  getStepContext(): StepContext {
    return this.stepContext;
  }

  /**
   * Get step ID for a given iteration
   */
  getStepIdForIteration(iteration: number): string {
    const prefix = iteration === 1 ? "initial" : "continuation";
    return `${prefix}.${this.completionType}`;
  }

  /**
   * Start a new iteration
   */
  startIteration(): string {
    this.iteration++;
    this.currentStepId = this.getStepIdForIteration(this.iteration);
    this.logger.debug(
      `[FlowController] Starting iteration ${this.iteration}, step: ${this.currentStepId}`,
    );
    return this.currentStepId;
  }

  /**
   * Record step output to handoff
   */
  recordOutput(
    stepId: string,
    output: Record<string, unknown>,
  ): void {
    this.stepContext.set(stepId, output);
    this.logger.debug(`[FlowController] Recorded output for step: ${stepId}`, {
      outputKeys: Object.keys(output),
    });
  }

  /**
   * Build user variables from handoff for prompt injection
   */
  buildUserVariables(): Record<string, string> {
    // Get input spec for current step if defined
    const stepDef = this.registry.steps[this.currentStepId] as
      | PromptStepDefinition
      | undefined;
    if (!stepDef?.inputs) {
      return {};
    }
    return this.stepContext.toUV(stepDef.inputs);
  }

  /**
   * Check if structured output indicates completion
   */
  hasCompletionSignal(structuredOutput?: Record<string, unknown>): boolean {
    if (!structuredOutput) {
      return false;
    }

    // Check status field
    if (structuredOutput.status === "completed") {
      return true;
    }

    // Check next_action.action field
    // Accepts both "closing" (new) and "complete" (legacy) for backward compatibility
    if (
      typeof structuredOutput.next_action === "object" &&
      structuredOutput.next_action !== null
    ) {
      const nextAction = structuredOutput.next_action as Record<
        string,
        unknown
      >;
      if (nextAction.action === "closing" || nextAction.action === "complete") {
        return true;
      }
    }

    return false;
  }

  /**
   * Create iteration snapshot
   */
  createSnapshot(
    structuredOutput?: Record<string, unknown>,
  ): FlowIterationSnapshot {
    const stepData = this.stepContext.get(this.currentStepId, "_all") as
      | Record<string, unknown>
      | undefined;

    return {
      stepId: this.currentStepId,
      iteration: this.iteration,
      handoff: stepData ?? {},
      completionSignal: this.hasCompletionSignal(structuredOutput),
      structuredOutput,
    };
  }

  /**
   * Get step definition for current step
   */
  getCurrentStepDefinition(): PromptStepDefinition | undefined {
    return this.registry.steps[this.currentStepId] as
      | PromptStepDefinition
      | undefined;
  }

  /**
   * Get output schema reference for current step
   */
  getOutputSchemaRef():
    | { file: string; schema: string }
    | undefined {
    const stepDef = this.getCurrentStepDefinition();
    return stepDef?.outputSchemaRef;
  }
}
