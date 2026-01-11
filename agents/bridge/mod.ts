/**
 * Bridge Module - Claude Agent SDK Connection Layer
 *
 * Separates SDK connection into single-responsibility modules:
 * - SdkBridge: SDK API calls and session management
 * - MessageProcessor: Message processing and content extraction
 * - Sandbox Config: Sandbox configuration utilities
 *
 * @module
 */

// SDK Bridge
export {
  type AssistantMessage,
  ClaudeSdkBridge,
  type ErrorMessage,
  type QueryOptions,
  type ResultMessage,
  type SdkBridge,
  type SdkMessage,
  type ToolUseMessage,
  type UnknownMessage,
} from "./sdk-bridge.ts";

// Message Processor
export {
  MessageProcessor,
  type ProcessedMessage,
} from "./message-processor.ts";

// Sandbox Configuration
export {
  DEFAULT_SANDBOX_CONFIG,
  DEFAULT_TRUSTED_DOMAINS,
  getDefaultFilesystemPaths,
  mergeSandboxConfig,
  type SdkSandboxSettings,
  toSdkSandboxConfig,
} from "./sandbox-config.ts";
