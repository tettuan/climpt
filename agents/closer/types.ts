/**
 * Closer Types
 *
 * Type definitions for the closer subsystem.
 * Closer handles completion judgment via AI structured outputs.
 */

/**
 * Input to Closer
 *
 * Contains the AI's structured output from previous step
 * and context needed for completion judgment.
 */
export interface CloserInput {
  /** Structured output from previous AI response */
  structuredOutput: Record<string, unknown>;

  /** Step identifier for C3L prompt resolution */
  stepId: string;

  /** C3L path components */
  c3l: {
    c2: string; // e.g., "complete"
    c3: string; // e.g., "issue"
  };

  /** Optional context for prompt generation */
  context?: Record<string, unknown>;
}

/**
 * Checklist item for completion verification
 *
 * AI generates this list of required tasks.
 */
export interface ChecklistItem {
  /** Task identifier */
  id: string;

  /** Human-readable task description */
  description: string;

  /** Whether the task is completed */
  completed: boolean;

  /** Evidence or reason for status */
  evidence?: string;
}

/**
 * Closer's structured output format
 *
 * This is the format AI returns via structured output.
 */
export interface CloserStructuredOutput {
  /** Checklist of tasks needed for completion */
  checklist: ChecklistItem[];

  /** Whether all tasks are completed */
  allComplete: boolean;

  /** Summary of completion status */
  summary: string;

  /** Actions needed if not complete */
  pendingActions?: string[];
}

/**
 * Closer result
 *
 * Final output from closer processing.
 */
export interface CloserResult {
  /** Whether completion is achieved */
  complete: boolean;

  /** The structured output from AI */
  output: CloserStructuredOutput;

  /** Prompt used for closer (for debugging) */
  promptUsed?: string;

  /** Error if processing failed */
  error?: string;
}

/**
 * Closer options
 */
export interface CloserOptions {
  /** Working directory for C3L resolution */
  workingDir: string;

  /** Agent ID for C3L prompt loading */
  agentId: string;

  /** Optional logger */
  logger?: CloserLogger;
}

/**
 * Minimal logger interface for closer
 */
export interface CloserLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Query function type
 *
 * Used to execute AI queries with structured output.
 */
export type CloserQueryFn = (
  prompt: string,
  options: { outputSchema: Record<string, unknown> },
) => Promise<{ structuredOutput?: Record<string, unknown>; error?: string }>;

/**
 * Schema for closer structured output
 *
 * JSON Schema definition for AI's response format.
 */
export const CLOSER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    checklist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          completed: { type: "boolean" },
          evidence: { type: "string" },
        },
        required: ["id", "description", "completed"],
        additionalProperties: false,
      },
    },
    allComplete: { type: "boolean" },
    summary: { type: "string" },
    pendingActions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["checklist", "allComplete", "summary"],
  additionalProperties: false,
} as const;
