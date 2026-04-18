/**
 * Workflow Loader - Load and validate .agent/workflow.json
 *
 * Reads the workflow configuration, applies defaults,
 * and performs cross-reference validation to ensure
 * all phase/agent references are consistent.
 */

import { join } from "@std/path";
import {
  type AgentDefinition,
  DEFAULT_ISSUE_STORE,
  type WorkflowConfig,
  type WorkflowRules,
} from "./workflow-types.ts";
import {
  wfLabelMappingEmpty,
  wfLabelSpecInvalidColor,
  wfLabelSpecMissing,
  wfLabelSpecOrphan,
  wfLabelUnknownPhase,
  wfLoadInvalidJson,
  wfLoadNotFound,
  wfLoadReadFailed,
  wfPhaseAgentRequired,
  wfPhaseInvalidType,
  wfPhasePriorityRequired,
  wfRefCloseConditionWithoutCloseOnComplete,
  wfRefInvalidCloseCondition,
  wfRefUnknownAgent,
  wfRefUnknownFallbackPhase,
  wfRefUnknownOutputPhase,
  wfRefUnknownOutputPhasesEntry,
  wfRuleCycleDelayInvalid,
  wfRuleMaxCyclesInvalid,
  wfSchemaAgentsRequired,
  wfSchemaLabelMappingRequired,
  wfSchemaPhasesRequired,
  wfSchemaVersionRequired,
} from "../shared/errors/config-errors.ts";

const DEFAULT_WORKFLOW_PATH = ".agent/workflow.json";

const DEFAULT_RULES: WorkflowRules = {
  maxCycles: 5,
  cycleDelayMs: 10000,
  maxConsecutivePhases: 0,
};

/**
 * Load and validate workflow configuration.
 *
 * @param cwd - Working directory containing the workflow file
 * @param workflowPath - Relative path to workflow JSON (default: .agent/workflow.json)
 * @returns Validated WorkflowConfig with defaults applied
 * @throws ConfigError if file not found, invalid JSON, or validation fails
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
      throw wfLoadNotFound(filePath);
    }
    throw wfLoadReadFailed(filePath);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw wfLoadInvalidJson(filePath);
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
    labels: parsed.labels as WorkflowConfig["labels"],
    agents: parsed.agents as WorkflowConfig["agents"],
    rules: applyDefaultRules(
      parsed.rules as Partial<WorkflowRules> | undefined,
    ),
    handoff: parsed.handoff as WorkflowConfig["handoff"],
    issueStore: rawIssueStore ?? DEFAULT_ISSUE_STORE,
    prioritizer: parsed.prioritizer as WorkflowConfig["prioritizer"],
    handoffs: parsed.handoffs as WorkflowConfig["handoffs"],
    payloadSchema: parsed.payloadSchema as WorkflowConfig["payloadSchema"],
  };

  validateCrossReferences(config);

  return config;
}

function validateRequiredFields(parsed: Record<string, unknown>): void {
  if (typeof parsed.version !== "string") {
    throw wfSchemaVersionRequired();
  }
  if (typeof parsed.phases !== "object" || parsed.phases === null) {
    throw wfSchemaPhasesRequired();
  }
  if (typeof parsed.labelMapping !== "object" || parsed.labelMapping === null) {
    throw wfSchemaLabelMappingRequired();
  }
  if (typeof parsed.agents !== "object" || parsed.agents === null) {
    throw wfSchemaAgentsRequired();
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
    maxConsecutivePhases: rules.maxConsecutivePhases ??
      DEFAULT_RULES.maxConsecutivePhases,
  };
}

const VALID_PHASE_TYPES = new Set(["actionable", "terminal", "blocking"]);
const VALID_PHASE_TYPES_LIST = ["actionable", "terminal", "blocking"] as const;

function validateCrossReferences(config: WorkflowConfig): void {
  const phaseIds = new Set(Object.keys(config.phases));
  const agentIds = new Set(Object.keys(config.agents));

  // 0. Validate phase types, labelMapping non-empty, and rules bounds
  for (const [phaseId, phase] of Object.entries(config.phases)) {
    if (!VALID_PHASE_TYPES.has(phase.type)) {
      throw wfPhaseInvalidType(phaseId, phase.type, VALID_PHASE_TYPES_LIST);
    }
  }

  if (Object.keys(config.labelMapping).length === 0) {
    throw wfLabelMappingEmpty();
  }

  if (config.rules.maxCycles < 1) {
    throw wfRuleMaxCyclesInvalid(config.rules.maxCycles);
  }

  if (config.rules.cycleDelayMs < 0) {
    throw wfRuleCycleDelayInvalid(config.rules.cycleDelayMs);
  }

  // 1. Actionable phases must have agent and priority
  for (const [phaseId, phase] of Object.entries(config.phases)) {
    if (phase.type === "actionable") {
      if (phase.agent === null || phase.agent === undefined) {
        throw wfPhaseAgentRequired(phaseId);
      }
      if (phase.priority === undefined) {
        throw wfPhasePriorityRequired(phaseId);
      }
    }
  }

  // 2. Every phase.agent must exist in agents section
  for (const [phaseId, phase] of Object.entries(config.phases)) {
    if (
      phase.agent !== null && phase.agent !== undefined &&
      !agentIds.has(phase.agent)
    ) {
      throw wfRefUnknownAgent(phaseId, phase.agent);
    }
  }

  // 3. Every labelMapping value must exist in phases section
  for (const [label, targetPhase] of Object.entries(config.labelMapping)) {
    if (!phaseIds.has(targetPhase)) {
      throw wfLabelUnknownPhase(label, targetPhase);
    }
  }

  // 4 & 5. Agent outputPhase/outputPhases/fallbackPhase must exist in phases
  for (const [agentId, agent] of Object.entries(config.agents)) {
    validateAgentPhaseReferences(agentId, agent, phaseIds);
  }

  // 6. labels[] completeness + color format
  validateLabelsSection(config);
}

const HEX_COLOR_RE = /^[0-9a-fA-F]{6}$/;

/**
 * Validate the `labels` section when declared.
 *
 * Opt-in semantics: if `labels` is absent from workflow.json, no
 * validation runs (backwards compat for pre-Phase-2 configs that
 * relied on an external bootstrap). Once `labels` is declared —
 * even as `{}` — the full completeness / orphan / color-format
 * contract is enforced. This forces any config that adopts the
 * declarative model to do so consistently.
 */
function validateLabelsSection(config: WorkflowConfig): void {
  if (config.labels === undefined) return;

  // Required labels = labelMapping keys ∪ prioritizer.labels
  const requiredLabels = new Set<string>(Object.keys(config.labelMapping));
  if (config.prioritizer) {
    for (const label of config.prioritizer.labels) {
      requiredLabels.add(label);
    }
  }

  const declaredLabels = config.labels;
  const declaredKeys = new Set(Object.keys(declaredLabels));

  // Completeness: every required label must appear in labels[]
  const missing = [...requiredLabels].filter((l) => !declaredKeys.has(l));
  if (missing.length > 0) {
    throw wfLabelSpecMissing(missing.sort());
  }

  // Orphans: declared specs must be referenced somewhere
  const orphans = [...declaredKeys].filter((l) => !requiredLabels.has(l));
  if (orphans.length > 0) {
    throw wfLabelSpecOrphan(orphans.sort());
  }

  // Color format: 6-char hex, no leading '#'
  for (const [name, spec] of Object.entries(declaredLabels)) {
    if (!HEX_COLOR_RE.test(spec.color)) {
      throw wfLabelSpecInvalidColor(name, spec.color);
    }
  }
}

function validateAgentPhaseReferences(
  agentId: string,
  agent: AgentDefinition,
  phaseIds: Set<string>,
): void {
  if (agent.fallbackPhase !== undefined && !phaseIds.has(agent.fallbackPhase)) {
    throw wfRefUnknownFallbackPhase(agentId, agent.fallbackPhase);
  }

  if (agent.role === "transformer") {
    if (!phaseIds.has(agent.outputPhase)) {
      throw wfRefUnknownOutputPhase(agentId, agent.outputPhase);
    }
  } else if (agent.role === "validator") {
    for (const [key, targetPhase] of Object.entries(agent.outputPhases)) {
      if (!phaseIds.has(targetPhase)) {
        throw wfRefUnknownOutputPhasesEntry(agentId, key, targetPhase);
      }
    }
  }

  // closeCondition cross-validation
  if (agent.closeCondition !== undefined) {
    if (!agent.closeOnComplete) {
      throw wfRefCloseConditionWithoutCloseOnComplete(agentId);
    }
    if (
      agent.role === "validator" &&
      !(agent.closeCondition in agent.outputPhases)
    ) {
      throw wfRefInvalidCloseCondition(
        agentId,
        agent.closeCondition,
        Object.keys(agent.outputPhases),
      );
    }
  }
}
