/**
 * StepMachine Verdict Handler - Multi-step execution orchestration
 *
 * Completes when the step state machine reaches a terminal state.
 * Uses step registry to determine step order and transitions.
 *
 * Based on: agents/docs/design/01_runner.md and Issue #258
 */

import type { PromptResolver } from "../common/prompt-resolver.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import type { Step } from "../common/step-registry.ts";
import {
  BaseVerdictHandler,
  type IterationSummary,
  type VerdictCriteria,
} from "./types.ts";
import {
  prResolveUnknownStepId,
  srEntryNotConfigured,
} from "../shared/errors/config-errors.ts";

const COMPLETE = true;
const INCOMPLETE = false;

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
}

/**
 * StepMachine Verdict Handler
 *
 * Orchestrates multi-step agent execution by:
 * 1. Tracking current step and iteration
 * 2. Determining completion when structured output signals terminal state
 *
 * Step transitions and data passing are handled by FlowOrchestrator.
 */
export class StepMachineVerdictHandler extends BaseVerdictHandler {
  readonly type = "detect:graph" as const;

  private promptResolver?: PromptResolver;
  private uvVariables: Record<string, string> = {};
  private state: StepState;
  private verdictReason?: string;
  private lastSummary?: IterationSummary;
  #lastVerdict?: string;

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
    };
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
   * Supply base UV variables (CLI args + runtime) for prompt resolution.
   */
  setUvVariables(uv: Record<string, string>): void {
    this.uvVariables = uv;
  }

  /**
   * Get the last verdict value extracted from closure step's structured output.
   * Used by runner to populate AgentResult.verdict for orchestrator routing.
   */
  override getLastVerdict(): string | undefined {
    return this.#lastVerdict;
  }

  /**
   * Set current iteration summary
   * Called by runner before isFinished()
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
    throw srEntryNotConfigured();
  }

  /**
   * Get step definition from registry
   */
  private getStepDefinition(stepId: string): Step | undefined {
    return this.registry.steps[stepId] as Step | undefined;
  }

  async buildInitialPrompt(): Promise<string> {
    const stepDef = this.getStepDefinition(this.state.currentStepId);

    if (this.promptResolver && stepDef) {
      return (await this.promptResolver.resolve(
        this.state.currentStepId,
        {
          uv: {
            ...this.uvVariables,
            step_id: this.state.currentStepId,
            step_name: stepDef.name,
          },
        },
      )).content;
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

${this.buildStepInstructions(stepDef, this.state.currentStepId)}
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

      return (await this.promptResolver.resolve(
        this.state.currentStepId,
        {
          uv: {
            ...this.uvVariables,
            step_id: this.state.currentStepId,
            step_name: stepDef.name,
            iteration: String(completedIterations),
            step_iteration: String(this.state.stepIteration),
            previous_summary: summaryText,
          },
        },
      )).content;
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

${summarySection}

## Continue

Continue executing this step. Review the previous summary and make progress.

${this.buildStepInstructions(stepDef, this.state.currentStepId)}
    `.trim();
  }

  /**
   * Build step-specific instructions
   */
  private buildStepInstructions(
    stepDef: Step | undefined,
    stepId?: string,
  ): string {
    if (!stepDef) {
      throw prResolveUnknownStepId(stepId ?? "unknown");
    }

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

  buildVerdictCriteria(): VerdictCriteria {
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

  /**
   * Handle boundary hook for closure steps.
   * Extracts verdict from structured output for orchestrator routing.
   */
  onBoundaryHook(payload: {
    stepId: string;
    kind: "closure";
    structuredOutput?: Record<string, unknown>;
  }): Promise<void> {
    if (payload.structuredOutput) {
      const rawVerdict = payload.structuredOutput.verdict;
      if (typeof rawVerdict === "string" && rawVerdict.length > 0) {
        this.#lastVerdict = rawVerdict;
      }
    }
    return Promise.resolve();
  }

  isFinished(): Promise<boolean> {
    // Check if last summary has completion signal
    if (this.lastSummary?.structuredOutput) {
      const so = this.lastSummary.structuredOutput;

      // Check for explicit completion status
      if (so.status === "completed" || so.complete === true) {
        this.verdictReason = "AI declared completion";
        return Promise.resolve(COMPLETE);
      }
    }

    return Promise.resolve(INCOMPLETE);
  }

  async getVerdictDescription(): Promise<string> {
    const complete = await this.isFinished();
    if (complete) {
      return this.verdictReason ?? "Step machine complete";
    }
    return `Step ${this.state.currentStepId}, iteration ${this.state.stepIteration}, total ${this.state.totalIterations}`;
  }
}
