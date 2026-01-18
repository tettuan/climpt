/**
 * Tool Policy - StepKind-based tool permission enforcement
 *
 * Defines which tools are available for each step kind.
 * This ensures Work/Verification steps cannot perform boundary actions
 * (like closing issues), which are reserved for Closure steps only.
 *
 * @see agents/docs/design/08_step_flow_design.md Section 2.1
 * @see tmp/refactor/2026-01-28/stepkind-permissions/plan.md
 */

import type { StepKind } from "./step-registry.ts";

/**
 * Boundary tools that can only be used in Closure steps.
 *
 * These tools perform actions that affect external state (GitHub issues, PRs, etc.)
 * and should only be executed when the workflow has confirmed completion.
 */
export const BOUNDARY_TOOLS = [
  // GitHub issue operations
  "githubIssueClose",
  "githubIssueUpdate",
  "githubIssueComment",
  // GitHub PR operations
  "githubPrClose",
  "githubPrMerge",
  "githubPrUpdate",
  // GitHub release operations
  "githubReleaseCreate",
  "githubReleasePublish",
] as const;

/**
 * Bash command patterns that are considered boundary actions.
 *
 * These patterns are checked when Bash tool is used to prevent
 * boundary actions from Work/Verification steps.
 */
export const BOUNDARY_BASH_PATTERNS = [
  // GitHub CLI issue operations
  /\bgh\s+issue\s+close\b/,
  /\bgh\s+issue\s+delete\b/,
  /\bgh\s+issue\s+transfer\b/,
  /\bgh\s+issue\s+edit\s+.*--state\s+closed/,
  /\bgh\s+issue\s+reopen\b/,
  // GitHub CLI PR operations
  /\bgh\s+pr\s+close\b/,
  /\bgh\s+pr\s+merge\b/,
  /\bgh\s+pr\s+ready\b/,
  // GitHub CLI release operations
  /\bgh\s+release\s+create\b/,
  /\bgh\s+release\s+edit\b/,
  // GitHub API - block all direct API calls (can bypass other restrictions)
  /\bgh\s+api\b/,
] as const;

export type BoundaryTool = (typeof BOUNDARY_TOOLS)[number];

/**
 * Base tools available to all step kinds.
 *
 * These are standard development tools that don't affect external state.
 */
export const BASE_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
] as const;

export type BaseTool = (typeof BASE_TOOLS)[number];

/**
 * Tool set definition for a step kind.
 */
export interface ToolSet {
  /** Tools always allowed for this step kind */
  allowed: readonly string[];
  /** Tools explicitly denied for this step kind (takes precedence over allowed) */
  denied: readonly string[];
  /** Whether boundary bash patterns are blocked */
  blockBoundaryBash: boolean;
}

/**
 * Tool policy mapping for each step kind.
 *
 * - work: Base tools only, boundary actions blocked
 * - verification: Base tools only, boundary actions blocked
 * - closure: All tools including boundary tools
 */
export const STEP_KIND_TOOL_POLICY: Record<StepKind, ToolSet> = {
  work: {
    allowed: BASE_TOOLS,
    denied: BOUNDARY_TOOLS,
    blockBoundaryBash: true,
  },
  verification: {
    allowed: BASE_TOOLS,
    denied: BOUNDARY_TOOLS,
    blockBoundaryBash: true,
  },
  closure: {
    allowed: [...BASE_TOOLS, ...BOUNDARY_TOOLS],
    denied: [],
    blockBoundaryBash: false,
  },
} as const;

/**
 * Result of tool permission check.
 */
export interface ToolPermissionResult {
  /** Whether the tool is allowed */
  allowed: boolean;
  /** Reason if denied */
  reason?: string;
}

/**
 * Check if a tool is allowed for a given step kind.
 *
 * @param tool - Tool name to check
 * @param stepKind - Current step kind
 * @returns Permission result with reason if denied
 */
export function isToolAllowed(
  tool: string,
  stepKind: StepKind,
): ToolPermissionResult {
  const policy = STEP_KIND_TOOL_POLICY[stepKind];

  // Check if explicitly denied
  if (policy.denied.includes(tool as BoundaryTool)) {
    return {
      allowed: false,
      reason:
        `Tool "${tool}" is a boundary tool and not allowed in ${stepKind} steps. ` +
        `Boundary actions are only permitted in closure steps.`,
    };
  }

  // Check if in allowed list (if the policy has restrictions)
  if (policy.allowed.length > 0) {
    const isAllowed = policy.allowed.includes(tool);
    if (!isAllowed) {
      return {
        allowed: false,
        reason:
          `Tool "${tool}" is not in the allowed list for ${stepKind} steps.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a bash command contains boundary actions.
 *
 * @param command - Bash command to check
 * @param stepKind - Current step kind
 * @returns Permission result with reason if denied
 */
export function isBashCommandAllowed(
  command: string,
  stepKind: StepKind,
): ToolPermissionResult {
  const policy = STEP_KIND_TOOL_POLICY[stepKind];

  if (!policy.blockBoundaryBash) {
    return { allowed: true };
  }

  // Check against boundary patterns
  for (const pattern of BOUNDARY_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason:
          `Bash command contains boundary action "${
            command.match(pattern)?.[0] ?? "unknown"
          }" ` +
          `which is not allowed in ${stepKind} steps. ` +
          `Boundary actions are only permitted in closure steps.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Filter allowed tools list based on step kind policy.
 *
 * Takes the agent's configured allowedTools and removes any that
 * are denied for the current step kind.
 *
 * @param configuredTools - Tools configured in agent.json
 * @param stepKind - Current step kind
 * @returns Filtered list of allowed tools
 */
export function filterAllowedTools(
  configuredTools: string[],
  stepKind: StepKind,
): string[] {
  const policy = STEP_KIND_TOOL_POLICY[stepKind];

  return configuredTools.filter((tool) => {
    // Remove explicitly denied tools
    if (policy.denied.includes(tool as BoundaryTool)) {
      return false;
    }
    return true;
  });
}

/**
 * Get the tool policy for a step kind.
 *
 * @param stepKind - Step kind to get policy for
 * @returns Tool set definition
 */
export function getToolPolicy(stepKind: StepKind): ToolSet {
  return STEP_KIND_TOOL_POLICY[stepKind];
}

/**
 * Check if a step kind allows boundary actions.
 *
 * @param stepKind - Step kind to check
 * @returns true if boundary actions are allowed
 */
export function allowsBoundaryActions(stepKind: StepKind): boolean {
  return stepKind === "closure";
}
