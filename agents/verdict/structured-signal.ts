/**
 * Structured Signal completion handler - completes when LLM outputs specific JSON signal
 *
 * Used for scenarios where completion is determined by the LLM outputting
 * a specific action block type with optional required field values.
 */

import type { PromptResolver } from "../common/prompt-resolver.ts";
import {
  BaseVerdictHandler,
  type IterationSummary,
  type VerdictCriteria,
  type VerdictStepIds,
} from "./types.ts";

const COMPLETE = true;
const INCOMPLETE = false;

export class StructuredSignalVerdictHandler extends BaseVerdictHandler {
  readonly type = "detect:structured" as const;
  private promptResolver?: PromptResolver;
  private uvVariables: Record<string, string> = {};
  private lastSummary?: IterationSummary;
  private readonly stepIds: VerdictStepIds;

  constructor(
    private readonly signalType: string,
    private readonly requiredFields?: Record<string, unknown>,
    stepIds?: VerdictStepIds,
  ) {
    super();
    this.stepIds = stepIds ?? {
      initial: "initial.structured",
      continuation: "continuation.structured",
    };
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  /**
   * Set the current iteration summary before verdict check.
   * Called by runner before isFinished() to provide current response context.
   */
  setCurrentSummary(summary: IterationSummary): void {
    this.lastSummary = summary;
  }

  /**
   * Supply base UV variables (CLI args + runtime) for prompt resolution.
   */
  setUvVariables(uv: Record<string, string>): void {
    this.uvVariables = uv;
  }

  /**
   * Get required field names, handling both array and object forms.
   */
  private getRequiredFieldNames(): string[] {
    if (!this.requiredFields) return [];
    if (Array.isArray(this.requiredFields)) {
      return this.requiredFields as unknown as string[];
    }
    return Object.keys(this.requiredFields);
  }

  /**
   * Check if required fields are satisfied in the output.
   * Array form: field names must exist with non-undefined values.
   * Object form: key-value pairs must match.
   */
  private checkRequiredFields(output: Record<string, unknown>): boolean {
    if (!this.requiredFields) return true;
    if (Array.isArray(this.requiredFields)) {
      return (this.requiredFields as unknown as string[]).every(
        (fieldName) => fieldName in output && output[fieldName] !== undefined,
      );
    }
    return Object.entries(this.requiredFields).every(
      ([key, value]) => {
        if (typeof value === "object" && value !== null) {
          return JSON.stringify(output[key]) === JSON.stringify(value);
        }
        return output[key] === value;
      },
    );
  }

  /**
   * Check if assistant responses contain the signal type code fence.
   * Handles cases where tryParseJsonFromText strips the code fence tag.
   */
  private hasSignalInResponses(): boolean {
    if (!this.lastSummary) return false;
    const fence = "```" + this.signalType;
    return this.lastSummary.assistantResponses.some((r) => r.includes(fence));
  }

  /**
   * Extract and parse JSON from the signal type code fence in assistant responses.
   * Used when structuredOutput is unavailable (no outputSchemaRef on the step).
   */
  private tryParseSignalFromResponses():
    | Record<string, unknown>
    | undefined {
    if (!this.lastSummary) return undefined;
    const fence = "```" + this.signalType;
    for (const response of this.lastSummary.assistantResponses) {
      const fenceIdx = response.indexOf(fence);
      if (fenceIdx === -1) continue;
      const contentStart = response.indexOf("\n", fenceIdx);
      if (contentStart === -1) continue;
      const fenceEnd = response.indexOf("```", contentStart);
      if (fenceEnd === -1) continue;
      const jsonStr = response.substring(contentStart, fenceEnd).trim();
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  async buildInitialPrompt(): Promise<string> {
    const requiredFieldsDesc = this.requiredFields
      ? `\n\nRequired fields in the signal:\n${
        Array.isArray(this.requiredFields)
          ? (this.requiredFields as unknown as string[]).map((f) => `- ${f}`)
            .join("\n")
          : Object.entries(this.requiredFields)
            .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
            .join("\n")
      }`
      : "";

    if (this.promptResolver) {
      return (await this.promptResolver.resolve(this.stepIds.initial, {
        uv: {
          ...this.uvVariables,
          signal_type: this.signalType,
          required_fields: JSON.stringify(this.requiredFields ?? {}),
        },
      })).content;
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
          Array.isArray(this.requiredFields)
            ? (this.requiredFields as unknown as string[])
              .map((f) => `"${f}": "..."`)
              .join(",\n  ")
            : Object.entries(this.requiredFields)
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
    // Store for isFinished check
    this.lastSummary = previousSummary;

    if (this.promptResolver) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";
      return (await this.promptResolver.resolve(
        this.stepIds.continuation,
        {
          uv: {
            ...this.uvVariables,
            iteration: String(completedIterations),
            signal_type: this.signalType,
            required_fields: JSON.stringify(this.requiredFields ?? {}),
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
Continue working. Iterations completed: ${completedIterations}

${summarySection}

## Continue

Work on the task. When complete, output the structured signal:

\`\`\`${this.signalType}
{"result": "complete"}
\`\`\`
    `.trim();
  }

  buildVerdictCriteria(): VerdictCriteria {
    const fieldDesc = this.requiredFields
      ? ` with required fields: ${this.getRequiredFieldNames().join(", ")}`
      : "";
    return {
      short: `Output "${this.signalType}" signal`,
      detailed:
        `When the task is complete, output a \`\`\`${this.signalType}\`\`\` action block${fieldDesc} to signal completion. Do not output this signal until you are certain the task is fully complete.`,
    };
  }

  isFinished(): Promise<boolean> {
    if (!this.lastSummary) return Promise.resolve(INCOMPLETE);

    // Signal detection: code fence check is independent of structuredOutput.
    // structuredOutput may be undefined when the step has no outputSchemaRef
    // (SDK only populates it when a schema is configured).
    const signalInResponses = this.hasSignalInResponses();

    const so = this.lastSummary.structuredOutput;
    const hasOutput = so && typeof so === "object";

    if (hasOutput) {
      // Path 1: structuredOutput available (schema-configured step)
      const output = so as Record<string, unknown>;
      const signalInOutput = output.signal === this.signalType ||
        output.type === this.signalType;

      if (signalInOutput || signalInResponses) {
        return Promise.resolve(
          this.checkRequiredFields(output) ? COMPLETE : INCOMPLETE,
        );
      }

      // Status-based completion fallback
      if (output.status === "completed" || output.result === "complete") {
        return Promise.resolve(
          this.checkRequiredFields(output) ? COMPLETE : INCOMPLETE,
        );
      }
      return Promise.resolve(INCOMPLETE);
    }

    // Path 2: no structuredOutput (no schema on step)
    // Detect signal via code fence and parse JSON from it
    if (signalInResponses) {
      const parsed = this.tryParseSignalFromResponses();
      if (parsed) {
        return Promise.resolve(
          this.checkRequiredFields(parsed) ? COMPLETE : INCOMPLETE,
        );
      }
      // Signal fence found but JSON unparseable — complete if no fields required
      return Promise.resolve(!this.requiredFields ? COMPLETE : INCOMPLETE);
    }

    return Promise.resolve(INCOMPLETE);
  }

  async getVerdictDescription(): Promise<string> {
    const complete = await this.isFinished();
    return complete
      ? `Structured signal "${this.signalType}" detected`
      : `Waiting for "${this.signalType}" signal`;
  }
}
