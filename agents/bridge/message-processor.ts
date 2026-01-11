/**
 * Message Processor - SDK Message Processing
 *
 * Responsibility: Extract content from messages, generate summaries
 * Side effects: None (Query)
 *
 * @module
 */

import type { AssistantMessage, SdkMessage } from "./sdk-bridge.ts";

// ============================================================================
// Processed Message Types
// ============================================================================

/**
 * Base processed message structure
 */
interface ProcessedMessageBase {
  /** The message type */
  type: SdkMessage["type"];
}

/**
 * Processed assistant message with extracted content
 */
interface ProcessedAssistantMessage extends ProcessedMessageBase {
  type: "assistant";
  /** Extracted text content from the message */
  content: string;
}

/**
 * Processed tool use message
 */
interface ProcessedToolUseMessage extends ProcessedMessageBase {
  type: "tool_use";
  /** Name of the tool that was used */
  toolName: string;
}

/**
 * Processed result message
 */
interface ProcessedResultMessage extends ProcessedMessageBase {
  type: "result";
  /** Session ID from the result */
  sessionId: string;
}

/**
 * Processed error message
 */
interface ProcessedErrorMessage extends ProcessedMessageBase {
  type: "error";
  /** Error message string */
  error: string;
}

/**
 * Processed unknown message
 */
interface ProcessedUnknownMessage extends ProcessedMessageBase {
  type: "unknown";
}

/**
 * Union type of all processed message types
 */
export type ProcessedMessage =
  | ProcessedAssistantMessage
  | ProcessedToolUseMessage
  | ProcessedResultMessage
  | ProcessedErrorMessage
  | ProcessedUnknownMessage;

// ============================================================================
// Message Processor
// ============================================================================

/**
 * Message Processor - Extracts and normalizes content from SDK messages
 *
 * This class provides:
 * - Content extraction from assistant messages
 * - Uniform interface for all message types
 * - Pure transformation without side effects
 *
 * @example
 * ```typescript
 * const processor = new MessageProcessor();
 * const processed = processor.process(sdkMessage);
 * if (processed.type === "assistant") {
 *   console.log(processed.content);
 * }
 * ```
 */
export class MessageProcessor {
  /**
   * Process an SDK message into a normalized ProcessedMessage
   *
   * @param message - The SDK message to process
   * @returns Processed message with extracted content
   */
  process(message: SdkMessage): ProcessedMessage {
    switch (message.type) {
      case "assistant":
        return {
          type: "assistant",
          content: this.extractContent(message),
        };

      case "tool_use":
        return {
          type: "tool_use",
          toolName: message.tool_name,
        };

      case "result":
        return {
          type: "result",
          sessionId: message.session_id,
        };

      case "error":
        return {
          type: "error",
          error: message.error.message ?? "Unknown error",
        };

      case "unknown":
      default:
        return { type: "unknown" };
    }
  }

  /**
   * Extract text content from an assistant message
   *
   * Handles multiple message formats:
   * - Direct string content
   * - Object with string content property
   * - Object with array content (Claude API format with text blocks)
   *
   * @param message - The assistant message to extract content from
   * @returns Extracted text content, or empty string if none found
   */
  extractContent(message: AssistantMessage): string {
    const msg = message.message;

    // Direct string message
    if (typeof msg === "string") {
      return msg;
    }

    // Object message format
    if (typeof msg === "object" && msg !== null) {
      const obj = msg as Record<string, unknown>;

      // Simple string content property
      if (typeof obj.content === "string") {
        return obj.content;
      }

      // Array content (Claude API format with text blocks)
      if (Array.isArray(obj.content)) {
        return obj.content
          .filter((c): c is { type: string; text: string } =>
            typeof c === "object" &&
            c !== null &&
            (c as Record<string, unknown>).type === "text" &&
            typeof (c as Record<string, unknown>).text === "string"
          )
          .map((c) => c.text)
          .join("\n");
      }
    }

    return "";
  }

  /**
   * Check if a processed message has meaningful content
   *
   * @param message - The processed message to check
   * @returns True if the message has content
   */
  hasContent(message: ProcessedMessage): boolean {
    switch (message.type) {
      case "assistant":
        return message.content.length > 0;
      case "tool_use":
        return message.toolName.length > 0;
      case "result":
        return message.sessionId.length > 0;
      case "error":
        return message.error.length > 0;
      default:
        return false;
    }
  }
}
