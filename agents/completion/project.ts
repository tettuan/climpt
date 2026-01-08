/**
 * Project completion handler - completes when project reaches final phase
 */

import type { IterationSummary } from "../src_common/types.ts";
import type { PromptResolver } from "../prompts/resolver.ts";
import { BaseCompletionHandler, type CompletionCriteria } from "./types.ts";

const PHASES = ["preparation", "processing", "review", "complete"] as const;
type Phase = typeof PHASES[number];

export interface ProjectHandlerOptions {
  projectNumber: number;
  promptResolver: PromptResolver;
  labels?: Record<string, string>;
}

export class ProjectCompletionHandler extends BaseCompletionHandler {
  readonly type = "project" as const;
  private projectNumber: number;
  private currentPhase: Phase = "preparation";
  private promptResolver: PromptResolver;
  private labels?: Record<string, string>;

  constructor(options: ProjectHandlerOptions) {
    super();
    if (!options.projectNumber) {
      throw new Error(
        "--project <number> is required for project completion type",
      );
    }
    this.projectNumber = options.projectNumber;
    this.promptResolver = options.promptResolver;
    this.labels = options.labels;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return await this.promptResolver.resolve("initial_project", {
      "uv-project_number": String(this.projectNumber),
      "uv-phase": this.currentPhase,
      "uv-phases": PHASES.join(", "),
      ...this.argsToUvVars(args),
    });
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    // Detect phase from previous responses
    this.detectPhaseFromSummary(summaries);

    const stepName = `continuation_project_${this.currentPhase}`;

    // Try phase-specific prompt first, fall back to generic
    try {
      return await this.promptResolver.resolve(stepName, {
        "uv-iteration": String(iteration),
        "uv-project_number": String(this.projectNumber),
        "uv-phase": this.currentPhase,
        "uv-phases": PHASES.join(", "),
        "uv-previous_summary": this.formatSummaries(summaries.slice(-3)),
      });
    } catch {
      return await this.promptResolver.resolve("continuation_project", {
        "uv-iteration": String(iteration),
        "uv-project_number": String(this.projectNumber),
        "uv-phase": this.currentPhase,
        "uv-phases": PHASES.join(", "),
        "uv-previous_summary": this.formatSummaries(summaries.slice(-3)),
      });
    }
  }

  buildCompletionCriteria(): CompletionCriteria {
    const phaseDescriptions = [
      "1. Preparation: Gather requirements, setup",
      "2. Processing: Implement the main work",
      "3. Review: Validate and review changes",
      "4. Complete: Finalize and close",
    ];

    return {
      short: `Complete project #${this.projectNumber}`,
      detailed: `Work through GitHub Project #${this.projectNumber} phases:
${phaseDescriptions.join("\n")}

Move to the next phase when the current phase is complete. Use keywords like "Phase: complete" or "Moving to review" to indicate phase transitions.`,
    };
  }

  isComplete(_summary: IterationSummary): Promise<boolean> {
    return Promise.resolve(this.currentPhase === "complete");
  }

  getCompletionDescription(_summary: IterationSummary): Promise<string> {
    return Promise.resolve(
      `Project #${this.projectNumber} completed through all phases`,
    );
  }

  private detectPhaseFromSummary(summaries: IterationSummary[]): void {
    const lastResponses = summaries
      .slice(-2)
      .flatMap((s) => s.assistantResponses);
    const content = lastResponses.join(" ").toLowerCase();

    // Phase detection based on keywords
    if (
      content.includes("phase: complete") ||
      content.includes("project complete") ||
      content.includes("all phases complete")
    ) {
      this.currentPhase = "complete";
    } else if (
      content.includes("phase: review") ||
      content.includes("moving to review") ||
      content.includes("starting review")
    ) {
      this.currentPhase = "review";
    } else if (
      content.includes("phase: processing") ||
      content.includes("starting implementation") ||
      content.includes("moving to processing")
    ) {
      this.currentPhase = "processing";
    }
  }

  getCurrentPhase(): Phase {
    return this.currentPhase;
  }

  setPhase(phase: Phase): void {
    if (PHASES.includes(phase)) {
      this.currentPhase = phase;
    }
  }
}
