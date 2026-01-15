/**
 * Closer
 *
 * Completion judgment subsystem using AI structured outputs.
 *
 * ## Design Principle
 *
 * ```
 * AI structured output -> Closer prompt -> AI checklist generation -> Completion judgment
 * ```
 *
 * Closer does NOT:
 * - Parse test runner output directly
 * - Execute shell commands
 * - Check external state (git, GitHub, etc.)
 *
 * Closer DOES:
 * - Accept AI's structured output as input
 * - Load C3L prompt for completion checklist generation
 * - Request AI to verify completion via structured output
 * - Report completion status based on AI's judgment
 */

import { C3LPromptLoader } from "../common/c3l-prompt-loader.ts";
import type {
  CloserInput,
  CloserLogger,
  CloserOptions,
  CloserQueryFn,
  CloserResult,
  CloserStructuredOutput,
} from "./types.ts";
import { CLOSER_OUTPUT_SCHEMA } from "./types.ts";

/**
 * Default logger (no-op)
 */
const nullLogger: CloserLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Closer class
 *
 * Main entry point for completion judgment.
 */
export class Closer {
  private readonly promptLoader: C3LPromptLoader;
  private readonly logger: CloserLogger;
  private readonly options: CloserOptions;

  constructor(options: CloserOptions) {
    this.options = options;
    this.logger = options.logger ?? nullLogger;
    this.promptLoader = new C3LPromptLoader({
      agentId: options.agentId,
      configSuffix: "steps",
      workingDir: options.workingDir,
    });
  }

  /**
   * Check completion status
   *
   * @param input - Input containing structured output and context
   * @param queryFn - Function to execute AI queries
   * @returns Completion result
   */
  async check(
    input: CloserInput,
    queryFn: CloserQueryFn,
  ): Promise<CloserResult> {
    this.logger.debug(`Closer: checking completion for step ${input.stepId}`);

    // 1. Build completion prompt from C3L
    const promptResult = await this.buildPrompt(input);
    if (!promptResult.ok) {
      this.logger.error(
        `Closer: failed to build prompt: ${promptResult.error}`,
      );
      return {
        complete: false,
        output: this.createErrorOutput(
          promptResult.error ?? "Failed to load prompt",
        ),
        error: promptResult.error,
      };
    }

    // 2. Query AI with structured output schema
    const content = promptResult.content ?? "";
    const queryResult = await queryFn(content, {
      outputSchema: CLOSER_OUTPUT_SCHEMA,
    });

    if (queryResult.error) {
      this.logger.error(`Closer: query failed: ${queryResult.error}`);
      return {
        complete: false,
        output: this.createErrorOutput(queryResult.error),
        promptUsed: promptResult.content,
        error: queryResult.error,
      };
    }

    // 3. Parse structured output
    const output = this.parseOutput(queryResult.structuredOutput);
    if (!output) {
      this.logger.warn("Closer: failed to parse structured output");
      return {
        complete: false,
        output: this.createErrorOutput("Invalid structured output format"),
        promptUsed: promptResult.content,
        error: "Invalid structured output format",
      };
    }

    // 4. Determine completion
    const complete = output.allComplete;
    this.logger.info(
      `Closer: completion=${complete}, allComplete=${output.allComplete}`,
    );

    return {
      complete,
      output,
      promptUsed: promptResult.content,
    };
  }

  /**
   * Build completion prompt from C3L
   */
  private async buildPrompt(
    input: CloserInput,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    // Format structured output for prompt injection
    const structuredOutputText = JSON.stringify(
      input.structuredOutput,
      null,
      2,
    );

    // Load C3L prompt (uses steps/{c2}/{c3}/ path)
    const result = await this.promptLoader.load(
      {
        c1: "steps",
        c2: input.c3l.c2,
        c3: input.c3l.c3,
        edition: "default",
      },
      {
        inputText: structuredOutputText,
        uv: {
          step_id: input.stepId,
          ...input.context,
        },
      },
    );

    return result;
  }

  /**
   * Parse and validate structured output
   */
  private parseOutput(
    raw: Record<string, unknown> | undefined,
  ): CloserStructuredOutput | null {
    if (!raw) return null;

    // Basic validation
    if (
      !Array.isArray(raw.checklist) ||
      typeof raw.allComplete !== "boolean" ||
      typeof raw.summary !== "string"
    ) {
      return null;
    }

    // Validate checklist items
    const checklist = raw.checklist.map((item: unknown) => {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as Record<string, unknown>).id !== "string" ||
        typeof (item as Record<string, unknown>).description !== "string" ||
        typeof (item as Record<string, unknown>).completed !== "boolean"
      ) {
        return null;
      }
      const typedItem = item as Record<string, unknown>;
      return {
        id: typedItem.id as string,
        description: typedItem.description as string,
        completed: typedItem.completed as boolean,
        evidence: typedItem.evidence as string | undefined,
      };
    });

    if (checklist.some((item) => item === null)) {
      return null;
    }

    return {
      checklist: checklist as CloserStructuredOutput["checklist"],
      allComplete: raw.allComplete as boolean,
      summary: raw.summary as string,
      pendingActions: Array.isArray(raw.pendingActions)
        ? (raw.pendingActions as string[])
        : undefined,
    };
  }

  /**
   * Create error output
   */
  private createErrorOutput(error: string): CloserStructuredOutput {
    return {
      checklist: [],
      allComplete: false,
      summary: `Error: ${error}`,
      pendingActions: ["Resolve error and retry"],
    };
  }
}

/**
 * Factory function
 */
export function createCloser(options: CloserOptions): Closer {
  return new Closer(options);
}
