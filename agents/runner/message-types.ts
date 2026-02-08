/**
 * SDK Message Types - Type-safe definitions for Claude SDK messages
 *
 * These type guards provide runtime type checking for messages received
 * from the Claude SDK, replacing unsafe `as` casts with proper validation.
 *
 * @deprecated Use `agents/bridge/sdk-bridge.ts` instead.
 * This file will be removed in a future version.
 * Migration: Import from `../bridge/mod.ts` or `../bridge/sdk-bridge.ts`
 */

// ============================================================================
// Message Type Definitions
// ============================================================================

/**
 * Assistant message containing the model's response
 */
export interface AssistantMessage {
  readonly type: "assistant";
  readonly message: unknown;
}

/**
 * Tool use message indicating a tool was invoked
 */
export interface ToolUseMessage {
  readonly type: "tool_use";
  readonly "tool_name": string;
  readonly input?: Record<string, unknown>;
}

/**
 * Result message containing session information and optional structured output
 */
export interface ResultMessage {
  readonly type: "result";
  readonly "session_id": string;
  readonly subtype?: string;
  readonly "structured_output"?: Record<string, unknown>;
  readonly "total_cost_usd"?: number;
  readonly "num_turns"?: number;
  readonly "duration_ms"?: number;
}

/**
 * Error object structure within error messages
 */
export interface SdkError {
  readonly message?: string;
  readonly code?: string;
}

/**
 * Error message indicating an error occurred
 */
export interface ErrorMessage {
  readonly type: "error";
  readonly error: SdkError;
}

/**
 * Union type of all known SDK message types
 */
export type SdkMessage =
  | AssistantMessage
  | ToolUseMessage
  | ResultMessage
  | ErrorMessage;

// ============================================================================
// Type Guard Functions
// ============================================================================

/**
 * Check if a value is a non-null object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Type guard for AssistantMessage
 *
 * Validates that the message has type "assistant" and contains a message property.
 */
export function isAssistantMessage(msg: unknown): msg is AssistantMessage {
  if (!isObject(msg)) {
    return false;
  }
  return msg.type === "assistant" && "message" in msg;
}

/**
 * Type guard for ToolUseMessage
 *
 * Validates that the message has type "tool_use" and contains a string tool_name.
 */
export function isToolUseMessage(msg: unknown): msg is ToolUseMessage {
  if (!isObject(msg)) {
    return false;
  }
  return msg.type === "tool_use" && typeof msg.tool_name === "string";
}

/**
 * Type guard for ResultMessage
 *
 * Validates that the message has type "result" and contains a string session_id.
 */
export function isResultMessage(msg: unknown): msg is ResultMessage {
  if (!isObject(msg)) {
    return false;
  }
  return msg.type === "result" && typeof msg.session_id === "string";
}

/**
 * Type guard for ErrorMessage
 *
 * Validates that the message has type "error" and contains an error object.
 */
export function isErrorMessage(msg: unknown): msg is ErrorMessage {
  if (!isObject(msg)) {
    return false;
  }
  if (msg.type !== "error") {
    return false;
  }
  return isObject(msg.error);
}

/**
 * Type guard for any known SdkMessage type
 *
 * Useful for filtering unknown messages from known ones.
 */
export function isSdkMessage(msg: unknown): msg is SdkMessage {
  return (
    isAssistantMessage(msg) ||
    isToolUseMessage(msg) ||
    isResultMessage(msg) ||
    isErrorMessage(msg)
  );
}
