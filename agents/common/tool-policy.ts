/**
 * Tool Policy - kind-based tool permission enforcement
 *
 * Defines which tools are available for each step kind.
 * This ensures Work/Verification steps cannot perform boundary actions
 * (like closing issues), which are reserved for Closure steps only.
 *
 * @see agents/docs/design/08_step_flow_design.md Section 2.1
 * @see tmp/refactor/2026-01-28/stepkind-permissions/plan.md
 */

import type { PermissionMode } from "../src_common/types/agent-definition.ts";
import type { StepKind } from "./step-registry.ts";

/**
 * Bash command patterns that are considered boundary actions.
 *
 * These patterns are checked when Bash tool is used to prevent
 * boundary actions from being executed directly via bash in ANY step kind
 * (including closure steps). The Boundary Hook is the single write path.
 *
 * Classification criteria --blocked vs allowed:
 *   Blocked: All state-mutating write subcommands on GitHub resources that
 *            are owned by the Boundary Hook / OutboxProcessor / Orchestrator
 *            host-process layer. Labels, state transitions, and releases
 *            MUST go through those paths, never direct bash from the agent.
 *   Allowed: Read-only queries (e.g. `gh issue view`, `gh pr diff`) and
 *            workflow-continuation creates (e.g. `gh pr create`,
 *            `gh issue create`). Creates are non-destructive and handled
 *            by the finalize / outbox layers, not a closure action.
 */
export const BOUNDARY_BASH_PATTERNS = [
  // Issue write subcommands --all forms of edit (label/state/title/body),
  // close/delete/transfer/reopen/pin/lock end or mutate issue state.
  /\bgh\s+issue\s+edit\b/,
  /\bgh\s+issue\s+close\b/,
  /\bgh\s+issue\s+delete\b/,
  /\bgh\s+issue\s+transfer\b/,
  /\bgh\s+issue\s+reopen\b/,
  /\bgh\s+issue\s+pin\b/,
  /\bgh\s+issue\s+unpin\b/,
  /\bgh\s+issue\s+lock\b/,
  /\bgh\s+issue\s+unlock\b/,
  // PR write subcommands --edit covers label/title/body mutation,
  // close/merge/ready/review/reopen/lock mutate PR state.
  /\bgh\s+pr\s+edit\b/,
  /\bgh\s+pr\s+close\b/,
  /\bgh\s+pr\s+merge\b/,
  /\bgh\s+pr\s+ready\b/,
  /\bgh\s+pr\s+review\b/,
  /\bgh\s+pr\s+reopen\b/,
  /\bgh\s+pr\s+lock\b/,
  // Release operations --public-facing and irreversible
  /\bgh\s+release\s+create\b/,
  /\bgh\s+release\s+edit\b/,
  /\bgh\s+release\s+delete\b/,
  /\bgh\s+release\s+upload\b/,
  // Project writes --item add/edit/archive/delete, field mutation,
  // project edit/delete/close are orchestrator-layer operations.
  /\bgh\s+project\s+edit\b/,
  /\bgh\s+project\s+delete\b/,
  /\bgh\s+project\s+close\b/,
  /\bgh\s+project\s+copy\b/,
  /\bgh\s+project\s+field-create\b/,
  /\bgh\s+project\s+field-delete\b/,
  /\bgh\s+project\s+item-add\b/,
  /\bgh\s+project\s+item-archive\b/,
  /\bgh\s+project\s+item-create\b/,
  /\bgh\s+project\s+item-delete\b/,
  /\bgh\s+project\s+item-edit\b/,
  // Label admin --label taxonomy is repo-level config, not agent scope.
  /\bgh\s+label\s+create\b/,
  /\bgh\s+label\s+edit\b/,
  /\bgh\s+label\s+delete\b/,
  /\bgh\s+label\s+clone\b/,
  // Repo writes --creation/deletion/metadata mutation
  /\bgh\s+repo\s+create\b/,
  /\bgh\s+repo\s+delete\b/,
  /\bgh\s+repo\s+edit\b/,
  /\bgh\s+repo\s+archive\b/,
  /\bgh\s+repo\s+unarchive\b/,
  /\bgh\s+repo\s+rename\b/,
  /\bgh\s+repo\s+fork\b/,
  // GitHub API - block all direct API calls (can bypass other restrictions)
  /\bgh\s+api\b/,

  // --- Bypass prevention: network tools targeting GitHub API ---
  // LLM agents discovered they can bypass gh-command restrictions by using
  // curl/wget/python/etc. to call the GitHub REST API directly, e.g. closing
  // issues despite defaultClosureAction: "label-only". These patterns block
  // any HTTP client tool that targets api.github.com.
  /\bcurl\b.*api\.github\.com/,
  /\bwget\b.*api\.github\.com/,
  // Script-based HTTP clients targeting GitHub API
  /\bpython[23]?\b.*api\.github\.com/,
  /\bnode\b.*api\.github\.com/,
  /\bruby\b.*api\.github\.com/,
  /\bperl\b.*api\.github\.com/,
  /\bdeno\b.*api\.github\.com/,
  // GitHub API state mutation payloads (catch obfuscated URLs or piped input)
  /"state"\s*:\s*"closed"/,
  /'state'\s*:\s*'closed'/,
] as const;

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
  /** Default permissionMode for this step kind (if step doesn't declare its own) */
  defaultPermissionMode?: PermissionMode;
}

/**
 * Tool policy mapping for each step kind.
 *
 * GitHub write operations are enforced exclusively at the bash layer
 * (BOUNDARY_BASH_PATTERNS). No MCP-level boundary tools exist because
 * the single write path is the Boundary Hook (closure step structured
 * output) + OutboxProcessor / Orchestrator in the host process.
 *
 * See agents/runner/github-read-tool.ts:8-9:
 *   "Write operations (edit, close, comment, create) are not exposed.
 *    Those are handled exclusively by the Boundary Hook."
 */
export const STEP_KIND_TOOL_POLICY: Record<StepKind, ToolSet> = {
  work: {
    allowed: BASE_TOOLS,
    denied: [],
    blockBoundaryBash: true,
    defaultPermissionMode: "acceptEdits",
  },
  verification: {
    allowed: BASE_TOOLS,
    denied: [],
    blockBoundaryBash: true,
    defaultPermissionMode: "plan",
  },
  closure: {
    allowed: BASE_TOOLS,
    denied: [],
    // Block boundary bash commands even in closure steps.
    // The boundary hook handles GitHub operations based on defaultClosureAction.
    // This ensures AI doesn't bypass label-only mode by running gh commands directly.
    blockBoundaryBash: true,
    defaultPermissionMode: "acceptEdits",
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
 * @param kind - Current step kind
 * @returns Permission result with reason if denied
 */
export function isToolAllowed(
  tool: string,
  kind: StepKind,
): ToolPermissionResult {
  const policy = STEP_KIND_TOOL_POLICY[kind];

  // Check if explicitly denied
  if (policy.denied.includes(tool)) {
    return {
      allowed: false,
      reason: `Tool "${tool}" is not allowed in ${kind} steps. ` +
        `GitHub writes are handled by the Boundary Hook.`,
    };
  }

  // Check if in allowed list (if the policy has restrictions)
  if (policy.allowed.length > 0) {
    const isAllowed = policy.allowed.includes(tool);
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Tool "${tool}" is not in the allowed list for ${kind} steps.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a bash command contains boundary actions.
 *
 * @param command - Bash command to check
 * @param kind - Current step kind
 * @returns Permission result with reason if denied
 */
export function isBashCommandAllowed(
  command: string,
  kind: StepKind,
): ToolPermissionResult {
  const policy = STEP_KIND_TOOL_POLICY[kind];

  if (!policy.blockBoundaryBash) {
    return { allowed: true };
  }

  // Check against boundary patterns
  for (const pattern of BOUNDARY_BASH_PATTERNS) {
    if (pattern.test(command)) {
      const matched = command.match(pattern)?.[0] ?? "unknown";
      return {
        allowed: false,
        reason: kind === "closure"
          ? `Bash command contains boundary action "${matched}" ` +
            `which cannot be executed directly. ` +
            `Use the closing intent to trigger the Boundary Hook instead.`
          : `Bash command contains boundary action "${matched}" ` +
            `which is not allowed in ${kind} steps. ` +
            `Boundary actions are handled by the Boundary Hook in closure steps.`,
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
 * @param kind - Current step kind
 * @returns Filtered list of allowed tools
 */
export function filterAllowedTools(
  configuredTools: string[],
  kind: StepKind,
): string[] {
  const policy = STEP_KIND_TOOL_POLICY[kind];

  return configuredTools.filter((tool) => {
    // Remove explicitly denied tools
    if (policy.denied.includes(tool)) {
      return false;
    }
    return true;
  });
}

/**
 * Resolve the effective permissionMode for a step.
 *
 * Resolution order:
 * 1. Step-level permissionMode (explicit in steps_registry.json)
 * 2. Kind default permissionMode (from STEP_KIND_TOOL_POLICY)
 * 3. Agent-level permissionMode (from boundaries config)
 *
 * @param stepPermissionMode - Step's explicit permissionMode (from step definition)
 * @param kind - Current step kind (may be undefined for simple agents)
 * @param agentPermissionMode - Agent-level permissionMode (from boundaries)
 * @returns Resolved permissionMode
 */
export function resolvePermissionMode(
  stepPermissionMode: PermissionMode | undefined,
  kind: StepKind | undefined,
  agentPermissionMode: PermissionMode,
): PermissionMode {
  if (stepPermissionMode) {
    return stepPermissionMode;
  }
  if (kind) {
    const policy = STEP_KIND_TOOL_POLICY[kind];
    if (policy.defaultPermissionMode) {
      return policy.defaultPermissionMode;
    }
  }
  return agentPermissionMode;
}

/**
 * Get the tool policy for a step kind.
 *
 * @param kind - Step kind to get policy for
 * @returns Tool set definition
 */
export function getToolPolicy(kind: StepKind): ToolSet {
  return STEP_KIND_TOOL_POLICY[kind];
}

/**
 * Check if a step kind allows boundary actions.
 *
 * @param kind - Step kind to check
 * @returns true if boundary actions are allowed
 */
export function allowsBoundaryActions(kind: StepKind): boolean {
  return kind === "closure";
}

/**
 * Tools that modify state and must be denied in plan mode (read-only exploration).
 *
 * Plan mode permits only read-only tools (Read, Glob, Grep, WebFetch, WebSearch, Task).
 * AskUserQuestion is handled separately by the canUseTool callback (auto-response).
 *
 * @see agents/docs/design/08_step_flow_design.md Section 2.1
 */
export const PLAN_MODE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "Write",
  "Edit",
  "Bash",
  "NotebookEdit",
  "TodoWrite",
]);

/**
 * Check if a tool should be denied based on the effective permissionMode.
 *
 * The SDK's canUseTool callback returning `{ behavior: "allow" }` overrides
 * the SDK's own permissionMode enforcement. Therefore, plan mode restrictions
 * must be enforced explicitly in the callback.
 *
 * @param toolName - Tool name to check
 * @param permissionMode - Effective permissionMode for the current step
 * @returns Permission result with reason if denied
 */
export function isToolDeniedByPermissionMode(
  toolName: string,
  permissionMode: PermissionMode,
): ToolPermissionResult {
  if (permissionMode === "plan" && PLAN_MODE_WRITE_TOOLS.has(toolName)) {
    return {
      allowed: false,
      reason:
        `Tool "${toolName}" denied in plan mode (read-only exploration). ` +
        `Plan mode permits only read-only tools.`,
    };
  }
  return { allowed: true };
}
