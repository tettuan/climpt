/**
 * StepMachine Completion Handler - Multi-step execution orchestration
 *
 * Completes when the step state machine reaches a terminal state.
 * Uses step registry to determine step order and transitions.
 *
 * Based on: agents/docs/03_runner.md and Issue #258
 */

import type { PromptResolver } from "../prompts/resolver.ts";
import type { StepContext, StepResult } from "../src_common/contracts.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type { PromptStepDefinition } from "../common/step-registry.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type IterationSummary,
} from "./types.ts";
import { StepContextImpl } from "../loop/step-context.ts";

/**
 * Step state for tracking execution progress
 */
export interface StepState {
  /** Current step identifier */
  currentStepId: string;
  /** Number of iterations within current step */
  stepIteration: number;
  /** Total iterations across all steps */
  totalIterations: number;
  /** Number of retries for current step */
  retryCount: number;
  /** Whether execution is complete */
  isComplete: boolean;
  /** Reason for completion if complete */
  completionReason?: string;
}

/**
 * Step transition result
 */
export interface StepTransition {
  /** Next step ID or "complete" */
  nextStep: string | "complete";
  /** Whether current step passed */
  passed: boolean;
  /** Reason for transition */
  reason?: string;
}

/**
 * StepMachine Completion Handler
 *
 * Orchestrates multi-step agent execution by:
 * 1. Tracking current step and iteration
 * 2. Managing step transitions based on registry
 * 3. Passing data between steps via StepContext
 * 4. Determining completion when terminal state reached
 */
export class StepMachineCompletionHandler extends BaseCompletionHandler {
  readonly type = "stepMachine" as const;

  private promptResolver?: PromptResolver;
  private state: StepState;
  private stepContext: StepContextImpl;
  private lastSummary?: IterationSummary;

  constructor(
    private readonly registry: ExtendedStepsRegistry,
    entryStep?: string,
  ) {
    super();

    // Determine entry step from registry or parameter
    const initialStep = entryStep ?? this.getDefaultEntryStep();

    this.state = {
      currentStepId: initialStep,
      stepIteration: 0,
      totalIterations: 0,
      retryCount: 0,
      isComplete: false,
    };

    this.stepContext = new StepContextImpl();
  }

  /**
   * Get the step context for data passing between steps
   */
  getStepContext(): StepContext {
    return this.stepContext;
  }

  /**
   * Get current state (for debugging/logging)
   */
  getState(): Readonly<StepState> {
    return { ...this.state };
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  /**
   * Set current iteration summary
   * Called by runner before isComplete()
   */
  setCurrentSummary(summary: IterationSummary): void {
    this.lastSummary = summary;
  }

  /**
   * Get default entry step from registry.
   *
   * Entry step must be explicitly configured via entryStep or entryStepMapping.
   * No implicit fallback is allowed.
   */
  private getDefaultEntryStep(): string {
    // Try entryStep from registry
    if (this.registry.entryStep) {
      return this.registry.entryStep;
    }

    // No implicit fallback - entry step must be configured
    throw new Error(
      `[StepMachine] No entry step configured in registry. ` +
        `Add "entryStep" or "entryStepMapping" to steps_registry.json.`,
    );
  }

  /**
   * Get step definition from registry
   */
  private getStepDefinition(stepId: string): PromptStepDefinition | undefined {
    return this.registry.steps[stepId] as PromptStepDefinition | undefined;
  }

  /**
   * Get next step based on current step result.
   *
   * All Flow steps must define transitions in the step definition.
   * No implicit fallback is allowed - missing transitions will throw an error.
   */
  getNextStep(result: StepResult): StepTransition {
    const { stepId, passed } = result;
    const stepDef = this.registry.steps[stepId];

    if (!stepDef) {
      throw new Error(
        `[StepMachine] Step "${stepId}" not found in registry. ` +
          `Check steps_registry.json for missing step definition.`,
      );
    }

    if (!stepDef.transitions) {
      throw new Error(
        `[StepMachine] Step "${stepId}" has no transitions defined. ` +
          `All Flow steps must define transitions. ` +
          `Add a "transitions" object to the step definition in steps_registry.json.`,
      );
    }

    const intent = passed ? "next" : "repeat";
    const rule = stepDef.transitions[intent];

    if (!rule) {
      throw new Error(
        `[StepMachine] Step "${stepId}" has no transition for intent "${intent}". ` +
          `Add "${intent}" to the transitions object in steps_registry.json.`,
      );
    }

    if (!("target" in rule)) {
      throw new Error(
        `[StepMachine] Step "${stepId}" transition for "${intent}" has no target. ` +
          `Conditional transitions are not yet supported. Use { "target": "..." } format.`,
      );
    }

    return {
      nextStep: rule.target === "complete" ? "complete" : rule.target,
      passed,
      reason: `Transition via ${intent} intent`,
    };
  }

  /**
   * Transition to next step
   */
  transition(result: StepResult): string | "complete" {
    const nextStep = this.getNextStep(result);

    if (nextStep.nextStep === "complete") {
      this.state.isComplete = true;
      this.state.completionReason = nextStep.reason ??
        "Step machine reached terminal state";
      return "complete";
    }

    // Update state for transition
    if (nextStep.nextStep === this.state.currentStepId) {
      // Retry - increment retry count
      this.state.retryCount++;
    } else {
      // New step - reset retry count
      this.state.currentStepId = nextStep.nextStep;
      this.state.retryCount = 0;
      this.state.stepIteration = 0;
    }

    return nextStep.nextStep;
  }

  /**
   * Record step output to context
   */
  recordStepOutput(stepId: string, output: Record<string, unknown>): void {
    this.stepContext.set(stepId, output);
  }

  async buildInitialPrompt(): Promise<string> {
    const stepDef = this.getStepDefinition(this.state.currentStepId);

    if (this.promptResolver && stepDef) {
      // Build UV variables from step definition
      const uvVars: Record<string, string> = {
        "uv-step_id": this.state.currentStepId,
        "uv-step_name": stepDef.name,
      };

      // Use prompt resolver to get prompt
      try {
        return await this.promptResolver.resolve(stepDef.fallbackKey, uvVars);
      } catch {
        // Fallback if prompt resolution fails
      }
    }

    // Fallback inline prompt
    return `
You are executing step: ${this.state.currentStepId}

## Step Information

- Step ID: ${this.state.currentStepId}
- Step Name: ${stepDef?.name ?? "Unknown"}
${stepDef?.description ? `- Description: ${stepDef.description}` : ""}

## Instructions

Execute the task for this step. When the step is complete, provide output
in the format expected by the step definition.

${this.buildStepInstructions(stepDef)}
    `.trim();
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    this.state.totalIterations = completedIterations;
    this.state.stepIteration++;
    this.lastSummary = previousSummary;

    const stepDef = this.getStepDefinition(this.state.currentStepId);

    if (this.promptResolver && stepDef) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";

      const uvVars: Record<string, string> = {
        "uv-step_id": this.state.currentStepId,
        "uv-step_name": stepDef.name,
        "uv-iteration": String(completedIterations),
        "uv-step_iteration": String(this.state.stepIteration),
        "uv-previous_summary": summaryText,
      };

      try {
        const continuationKey = stepDef.fallbackKey.replace(
          "initial",
          "continuation",
        );
        return await this.promptResolver.resolve(continuationKey, uvVars);
      } catch {
        // Fallback if prompt resolution fails
      }
    }

    // Fallback inline prompt
    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return `
Continue working on step: ${this.state.currentStepId}

## Progress

- Total iterations: ${completedIterations}
- Step iterations: ${this.state.stepIteration}
- Retry count: ${this.state.retryCount}

${summarySection}

## Continue

Continue executing this step. Review the previous summary and make progress.

${this.buildStepInstructions(stepDef)}
    `.trim();
  }

  /**
   * Build step-specific instructions
   */
  private buildStepInstructions(
    stepDef: PromptStepDefinition | undefined,
  ): string {
    if (!stepDef) return "";

    const instructions: string[] = [];

    if (stepDef.uvVariables && stepDef.uvVariables.length > 0) {
      instructions.push(
        `Expected inputs: ${stepDef.uvVariables.join(", ")}`,
      );
    }

    if (stepDef.outputSchemaRef) {
      instructions.push(
        `Output schema: ${stepDef.outputSchemaRef.file}#${stepDef.outputSchemaRef.schema}`,
      );
    }

    return instructions.length > 0
      ? `\n## Step Requirements\n\n${instructions.join("\n")}`
      : "";
  }

  buildCompletionCriteria(): CompletionCriteria {
    const stepCount = Object.keys(this.registry.steps).length;
    return {
      short: `Step machine with ${stepCount} steps`,
      detailed:
        `This task uses a step machine with ${stepCount} defined steps. ` +
        `Each step has specific inputs, outputs, and completion criteria. ` +
        `The task is complete when the step machine reaches a terminal state. ` +
        `Current step: ${this.state.currentStepId}`,
    };
  }

  isComplete(): Promise<boolean> {
    // Check if marked complete by transition
    if (this.state.isComplete) {
      return Promise.resolve(true);
    }

    // Check if last summary has completion signal
    if (this.lastSummary?.structuredOutput) {
      const so = this.lastSummary.structuredOutput;

      // Check for explicit completion status
      if (so.status === "completed" || so.complete === true) {
        this.state.isComplete = true;
        this.state.completionReason = "AI declared completion";
        return Promise.resolve(true);
      }

      // Check for next_action.action === "complete"
      if (typeof so.next_action === "object" && so.next_action !== null) {
        const nextAction = so.next_action as Record<string, unknown>;
        if (nextAction.action === "complete") {
          this.state.isComplete = true;
          this.state.completionReason = "AI requested completion action";
          return Promise.resolve(true);
        }
      }
    }

    return Promise.resolve(false);
  }

  async getCompletionDescription(): Promise<string> {
    const complete = await this.isComplete();
    if (complete) {
      return this.state.completionReason ?? "Step machine complete";
    }
    return `Step ${this.state.currentStepId}, iteration ${this.state.stepIteration}, total ${this.state.totalIterations}`;
  }
}
