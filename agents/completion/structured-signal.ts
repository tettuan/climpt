/**
 * Structured Signal completion handler - completes when LLM outputs specific JSON signal
 *
 * Used for scenarios where completion is determined by the LLM outputting
 * a specific action block type with optional required field values.
 */

import type { PromptResolver } from "../prompts/resolver.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type IterationSummary,
} from "./types.ts";

const COMPLETE = true;
const INCOMPLETE = false;

export class StructuredSignalCompletionHandler extends BaseCompletionHandler {
  readonly type = "structuredSignal" as const;
  private promptResolver?: PromptResolver;
  private lastSummary?: IterationSummary;

  constructor(
    private readonly signalType: string,
    private readonly requiredFields?: Record<string, unknown>,
  ) {
    super();
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  async buildInitialPrompt(): Promise<string> {
    const requiredFieldsDesc = this.requiredFields
      ? `\n\nRequired fields in the signal:\n${
        Object.entries(this.requiredFields)
          .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
          .join("\n")
      }`
      : "";

    if (this.promptResolver) {
      return await this.promptResolver.resolve("initial_structured_signal", {
        "uv-signal_type": this.signalType,
        "uv-required_fields": JSON.stringify(this.requiredFields ?? {}),
      });
    }

    // Fallback inline prompt
    return `
You are working on a task that will be completed when you output a structured signal.

## Instructions

1. Work on the assigned task
2. When you are certain the task is complete, output the completion signal
3. Do not output the signal until you have verified the task is done

## Completion Signal

When ready, output the following action block:

\`\`\`${this.signalType}
{
  "result": "complete"${
      this.requiredFields
        ? `,
  ${
          Object.entries(this.requiredFields)
            .map(([key, value]) => `"${key}": ${JSON.stringify(value)}`)
            .join(",\n  ")
        }`
        : ""
    }
}
\`\`\`
${requiredFieldsDesc}
    `.trim();
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    // Store for isComplete check
    this.lastSummary = previousSummary;

    if (this.promptResolver) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";
      return await this.promptResolver.resolve(
        "continuation_structured_signal",
        {
          "uv-iteration": String(completedIterations),
          "uv-signal_type": this.signalType,
          "uv-required_fields": JSON.stringify(this.requiredFields ?? {}),
          "uv-previous_summary": summaryText,
        },
      );
    }

    // Fallback inline prompt
    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return `
Continue working. Iterations completed: ${completedIterations}

${summarySection}

## Continue

Work on the task. When complete, output the structured signal:

\`\`\`${this.signalType}
{"result": "complete"}
\`\`\`
    `.trim();
  }

  buildCompletionCriteria(): CompletionCriteria {
    const fieldDesc = this.requiredFields
      ? ` with required fields: ${Object.keys(this.requiredFields).join(", ")}`
      : "";
    return {
      short: `Output "${this.signalType}" signal`,
      detailed:
        `When the task is complete, output a \`\`\`${this.signalType}\`\`\` action block${fieldDesc} to signal completion. Do not output this signal until you are certain the task is fully complete.`,
    };
  }

  isComplete(): Promise<boolean> {
    if (!this.lastSummary) return Promise.resolve(INCOMPLETE);

    // Check if structured output matches the signal
    const so = this.lastSummary.structuredOutput;
    if (!so || typeof so !== "object") {
      return Promise.resolve(INCOMPLETE);
    }

    // Check if structured output has the expected signal type
    const output = so as Record<string, unknown>;
    if (output.signal !== this.signalType && output.type !== this.signalType) {
      // Also check for status-based completion
      if (output.status === "completed" || output.result === "complete") {
        // Check required fields if specified
        if (this.requiredFields) {
          const matches = Object.entries(this.requiredFields).every(
            ([key, value]) => {
              if (typeof value === "object" && value !== null) {
                return JSON.stringify(output[key]) === JSON.stringify(value);
              }
              return output[key] === value;
            },
          );
          if (matches) return Promise.resolve(COMPLETE);
        } else {
          return Promise.resolve(COMPLETE);
        }
      }
      return Promise.resolve(INCOMPLETE);
    }

    // Check required fields if specified
    if (this.requiredFields) {
      const matches = Object.entries(this.requiredFields).every(
        ([key, value]) => {
          if (typeof value === "object" && value !== null) {
            return JSON.stringify(output[key]) === JSON.stringify(value);
          }
          return output[key] === value;
        },
      );
      if (matches) return Promise.resolve(COMPLETE);
      return Promise.resolve(INCOMPLETE);
    }

    return Promise.resolve(COMPLETE);
  }

  async getCompletionDescription(): Promise<string> {
    const complete = await this.isComplete();
    return complete
      ? `Structured signal "${this.signalType}" detected`
      : `Waiting for "${this.signalType}" signal`;
  }
}
