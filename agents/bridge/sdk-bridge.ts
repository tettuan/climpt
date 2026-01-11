/**
 * SDK Bridge - Claude Agent SDK Connection Layer
 *
 * Responsibility: SDK API calls, session management, response normalization
 * Side effects: API calls, session state updates
 *
 * @module
 */

import type { SandboxConfig } from "../src_common/types.ts";

// ============================================================================
// Query Options
// ============================================================================

/**
 * Options for SDK query execution
 */
export interface QueryOptions {
  /** Working directory for the query */
  cwd: string;
  /** System prompt to use */
  systemPrompt?: string;
  /** Session ID for resuming a previous session */
  sessionId?: string;
  /** List of allowed tools */
  allowedTools?: string[];
  /** Permission mode for tool execution */
  permissionMode?: string;
  /** Additional plugins to load */
  plugins?: string[];
  /** Sandbox configuration */
  sandbox?: SandboxConfig;
  /** Skip permissions (dangerous, use with caution) */
  dangerouslySkipPermissions?: boolean;
}

// ============================================================================
// SDK Message Types
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
  readonly tool_name: string;
}

/**
 * Result message containing session information
 */
export interface ResultMessage {
  readonly type: "result";
  readonly session_id: string;
}

/**
 * Error message indicating an error occurred
 */
export interface ErrorMessage {
  readonly type: "error";
  readonly error: { message?: string };
}

/**
 * Unknown message type for unrecognized messages
 */
export interface UnknownMessage {
  readonly type: "unknown";
  readonly raw: unknown;
}

/**
 * Union type of all SDK message types
 */
export type SdkMessage =
  | AssistantMessage
  | ToolUseMessage
  | ResultMessage
  | ErrorMessage
  | UnknownMessage;

// ============================================================================
// SDK Bridge Interface
// ============================================================================

/**
 * Interface for SDK bridge implementations
 *
 * Abstracts the Claude Agent SDK connection to allow for:
 * - Dependency injection in tests
 * - Alternative implementations
 * - Connection state management
 */
export interface SdkBridge {
  /**
   * Execute a query and yield normalized messages
   *
   * @param prompt - The prompt to send
   * @param options - Query execution options
   * @yields Normalized SDK messages
   */
  query(prompt: string, options: QueryOptions): AsyncIterable<SdkMessage>;

  /**
   * Get the current session ID if one exists
   *
   * @returns The session ID from the last result message, or undefined
   */
  getSessionId(): string | undefined;
}

// ============================================================================
// Type Guards (internal)
// ============================================================================

/**
 * Check if a value is a non-null object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Type guard for AssistantMessage
 */
function isAssistantMessage(msg: unknown): msg is AssistantMessage {
  if (!isObject(msg)) {
    return false;
  }
  return msg.type === "assistant" && "message" in msg;
}

/**
 * Type guard for ToolUseMessage
 */
function isToolUseMessage(msg: unknown): msg is ToolUseMessage {
  if (!isObject(msg)) {
    return false;
  }
  return msg.type === "tool_use" && typeof msg.tool_name === "string";
}

/**
 * Type guard for ResultMessage
 */
function isResultMessage(msg: unknown): msg is ResultMessage {
  if (!isObject(msg)) {
    return false;
  }
  return msg.type === "result" && typeof msg.session_id === "string";
}

/**
 * Type guard for ErrorMessage
 */
function isErrorMessage(msg: unknown): msg is ErrorMessage {
  if (!isObject(msg)) {
    return false;
  }
  if (msg.type !== "error") {
    return false;
  }
  return isObject(msg.error);
}

// ============================================================================
// Claude SDK Bridge Implementation
// ============================================================================

/**
 * Default implementation of SdkBridge using Claude Agent SDK
 *
 * This class provides:
 * - Direct SDK integration
 * - Message normalization
 * - Session ID tracking
 *
 * @example
 * ```typescript
 * const bridge = new ClaudeSdkBridge();
 * for await (const message of bridge.query("Hello", { cwd: "/path" })) {
 *   console.log(message.type, message);
 * }
 * ```
 */
export class ClaudeSdkBridge implements SdkBridge {
  private sessionId?: string;

  /**
   * Execute a query against the Claude Agent SDK
   *
   * @param prompt - The prompt to send to the SDK
   * @param options - Query options including cwd, system prompt, etc.
   * @yields Normalized SdkMessage objects
   */
  async *query(
    prompt: string,
    options: QueryOptions,
  ): AsyncIterable<SdkMessage> {
    // Dynamic import to allow lazy loading of SDK
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    const queryOptions: Record<string, unknown> = {
      cwd: options.cwd,
      systemPrompt: options.systemPrompt,
      allowedTools: options.allowedTools,
      permissionMode: options.permissionMode,
      settingSources: ["user", "project"],
      plugins: options.plugins,
      resume: options.sessionId,
    };

    // Handle sandbox configuration
    if (options.dangerouslySkipPermissions) {
      queryOptions.dangerouslySkipPermissions = true;
    } else if (options.sandbox) {
      // Import sandbox config converter
      const { toSdkSandboxConfig } = await import("./sandbox-config.ts");
      queryOptions.sandbox = toSdkSandboxConfig(options.sandbox);
    }

    const queryIterator = query({ prompt, options: queryOptions });

    for await (const message of queryIterator) {
      yield this.normalizeMessage(message);
    }
  }

  /**
   * Get the session ID from the most recent result message
   *
   * @returns The session ID or undefined if no result has been received
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * Normalize a raw SDK message to a typed SdkMessage
   *
   * @param message - Raw message from SDK iterator
   * @returns Normalized SdkMessage with type discrimination
   */
  private normalizeMessage(message: unknown): SdkMessage {
    if (isAssistantMessage(message)) {
      return {
        type: "assistant",
        message: message.message,
      };
    }

    if (isToolUseMessage(message)) {
      return {
        type: "tool_use",
        tool_name: message.tool_name,
      };
    }

    if (isResultMessage(message)) {
      // Track session ID for later retrieval
      this.sessionId = message.session_id;
      return {
        type: "result",
        session_id: message.session_id,
      };
    }

    if (isErrorMessage(message)) {
      return {
        type: "error",
        error: message.error,
      };
    }

    // Unknown message type - preserve for debugging
    return {
      type: "unknown",
      raw: message,
    };
  }
}
