/**
 * Shared Path Constants
 *
 * Centralized path strings extracted from the codebase.
 * All hardcoded directory and file name constants for agent configuration
 * should be defined here and imported where needed.
 */

/**
 * Agent directory and file path constants
 */
export const PATHS = {
  /** Root directory for agent configurations (e.g., .agent/iterator/) */
  AGENT_DIR_PREFIX: ".agent",
  /** Steps registry filename */
  STEPS_REGISTRY: "steps_registry.json",
  /** Agent definition filename */
  AGENT_JSON: "agent.json",
  /** Prompt registry filename (per-agent) */
  REGISTRY_JSON: "registry.json",
  /** Prompts subdirectory */
  PROMPTS_DIR: "prompts",
  /** Logs subdirectory */
  LOGS_DIR: "logs",
} as const;
