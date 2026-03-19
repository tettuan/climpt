/**
 * Workflow Loader - Load and validate .agent/workflow.json
 *
 * Reads the workflow configuration, applies defaults,
 * and performs cross-reference validation to ensure
 * all phase/agent references are consistent.
 */

import { join } from "@std/path";
import type {
  AgentDefinition,
  WorkflowConfig,
  WorkflowRules,
} from "./workflow-types.ts";

const DEFAULT_WORKFLOW_PATH = ".agent/workflow.json";

const DEFAULT_RULES: WorkflowRules = {
  maxCycles: 5,
  cycleDelayMs: 5000,
};

/**
 * Load and validate workflow configuration.
 *
 * @param cwd - Working directory containing the workflow file
 * @param workflowPath - Relative path to workflow JSON (default: .agent/workflow.json)
 * @returns Validated WorkflowConfig with defaults applied
 * @throws Error if file not found, invalid JSON, or validation fails
 */
export async function loadWorkflow(
  cwd: string,
  workflowPath?: string,
): Promise<WorkflowConfig> {
  const filePath = join(cwd, workflowPath ?? DEFAULT_WORKFLOW_PATH);

  let raw: string;
  try {
    raw = await Deno.readTextFile(filePath);
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) {
      throw new Error(`Workflow config not found: ${filePath}`);
    }
    throw new Error(`Failed to read workflow config: ${filePath}`, { cause });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`Invalid JSON in workflow config: ${filePath}`, { cause });
  }

  validateRequiredFields(parsed);

  const rawIssueStore = parsed.issueStore as
    | WorkflowConfig["issueStore"]
    | undefined;

  const config: WorkflowConfig = {
    version: parsed.version as string,
    labelPrefix: parsed.labelPrefix as string | undefined,
    phases: parsed.phases as WorkflowConfig["phases"],
    labelMapping: parsed.labelMapping as WorkflowConfig["labelMapping"],
    agents: parsed.agents as WorkflowConfig["agents"],
    rules: applyDefaultRules(
      parsed.rules as Partial<WorkflowRules> | undefined,
    ),
    handoff: parsed.handoff as WorkflowConfig["handoff"],
    issueStore: rawIssueStore ?? { path: ".agent/issues" },
    prioritizer: parsed.prioritizer as WorkflowConfig["prioritizer"],
  };

  validateCrossReferences(config);

  return config;
}

function validateRequiredFields(parsed: Record<string, unknown>): void {
  if (typeof parsed.version !== "string") {
    throw new Error(
      "Workflow config: 'version' is required and must be a string",
    );
  }
  if (typeof parsed.phases !== "object" || parsed.phases === null) {
    throw new Error(
      "Workflow config: 'phases' is required and must be an object",
    );
  }
  if (typeof parsed.labelMapping !== "object" || parsed.labelMapping === null) {
    throw new Error(
      "Workflow config: 'labelMapping' is required and must be an object",
    );
  }
  if (typeof parsed.agents !== "object" || parsed.agents === null) {
    throw new Error(
      "Workflow config: 'agents' is required and must be an object",
    );
  }
}

function applyDefaultRules(
  rules: Partial<WorkflowRules> | undefined,
): WorkflowRules {
  if (!rules) {
    return { ...DEFAULT_RULES };
  }
  return {
    maxCycles: rules.maxCycles ?? DEFAULT_RULES.maxCycles,
    cycleDelayMs: rules.cycleDelayMs ?? DEFAULT_RULES.cycleDelayMs,
  };
}

const VALID_PHASE_TYPES = new Set(["actionable", "terminal", "blocking"]);

function validateCrossReferences(config: WorkflowConfig): void {
  const phaseIds = new Set(Object.keys(config.phases));
  const agentIds = new Set(Object.keys(config.agents));

  // 0. Validate phase types, labelMapping non-empty, and rules bounds
  for (const [phaseId, phase] of Object.entries(config.phases)) {
    if (!VALID_PHASE_TYPES.has(phase.type)) {
      throw new Error(
        `Phase '${phaseId}' has invalid type '${phase.type}'. ` +
          `Must be one of: ${[...VALID_PHASE_TYPES].join(", ")}`,
      );
    }
  }

  if (Object.keys(config.labelMapping).length === 0) {
    throw new Error("Workflow config: 'labelMapping' must not be empty");
  }

  if (config.rules.maxCycles < 1) {
    throw new Error(
      `Workflow config: 'rules.maxCycles' must be >= 1, got ${config.rules.maxCycles}`,
    );
  }

  if (config.rules.cycleDelayMs < 0) {
    throw new Error(
      `Workflow config: 'rules.cycleDelayMs' must be >= 0, got ${config.rules.cycleDelayMs}`,
    );
  }

  // 1. Actionable phases must have agent and priority
  for (const [phaseId, phase] of Object.entries(config.phases)) {
    if (phase.type === "actionable") {
      if (phase.agent === null || phase.agent === undefined) {
        throw new Error(
          `Actionable phase '${phaseId}' must have 'agent' defined`,
        );
      }
      if (phase.priority === undefined) {
        throw new Error(
          `Actionable phase '${phaseId}' must have 'priority' defined`,
        );
      }
    }
  }

  // 2. Every phase.agent must exist in agents section
  for (const [phaseId, phase] of Object.entries(config.phases)) {
    if (
      phase.agent !== null && phase.agent !== undefined &&
      !agentIds.has(phase.agent)
    ) {
      throw new Error(
        `Phase '${phaseId}' references unknown agent '${phase.agent}'`,
      );
    }
  }

  // 3. Every labelMapping value must exist in phases section
  for (const [label, targetPhase] of Object.entries(config.labelMapping)) {
    if (!phaseIds.has(targetPhase)) {
      throw new Error(
        `Label '${label}' maps to unknown phase '${targetPhase}'`,
      );
    }
  }

  // 4 & 5. Agent outputPhase/outputPhases/fallbackPhase must exist in phases
  for (const [agentId, agent] of Object.entries(config.agents)) {
    validateAgentPhaseReferences(agentId, agent, phaseIds);
  }
}

function validateAgentPhaseReferences(
  agentId: string,
  agent: AgentDefinition,
  phaseIds: Set<string>,
): void {
  if (agent.fallbackPhase !== undefined && !phaseIds.has(agent.fallbackPhase)) {
    throw new Error(
      `Agent '${agentId}' references unknown fallbackPhase '${agent.fallbackPhase}'`,
    );
  }

  if (agent.role === "transformer") {
    if (!phaseIds.has(agent.outputPhase)) {
      throw new Error(
        `Agent '${agentId}' references unknown outputPhase '${agent.outputPhase}'`,
      );
    }
  } else if (agent.role === "validator") {
    for (const [key, targetPhase] of Object.entries(agent.outputPhases)) {
      if (!phaseIds.has(targetPhase)) {
        throw new Error(
          `Agent '${agentId}' outputPhases['${key}'] references unknown phase '${targetPhase}'`,
        );
      }
    }
  }
}
