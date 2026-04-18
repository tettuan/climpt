/**
 * Configuration Error Catalog
 *
 * Centralizes all configuration-related error messages for user-configurable settings.
 * Each error conveys: what went wrong, the design rule behind it, and how to fix it.
 *
 * Error code format: {Category}-{SubCategory}-{Sequence}
 * Categories: SR (Step Registry), AC (Agent Config), WF (Workflow Config), PR (Prompt)
 *
 * @see agents/docs/design/08_step_flow_design.md
 * @see agents/docs/design/02_core_architecture.md
 */

import { ClimptError } from "./base.ts";

/**
 * Base class for configuration-related errors.
 *
 * ConfigError provides structured error messages with:
 * - `code`: Machine-readable error code (e.g., "SR-TRANS-001")
 * - `designRule`: Explains the design constraint that was violated
 * - `fix`: Actionable instruction for resolving the error
 * - `configFile`: Which configuration file needs to be changed
 */
export class ConfigError extends ClimptError {
  readonly recoverable = false;

  constructor(
    readonly code: string,
    what: string,
    readonly designRule: string,
    readonly fix: string,
    readonly configFile?: string,
  ) {
    super(`[${code}] ${what}\nDesign: ${designRule}\nFix: ${fix}`);
    this.name = "ConfigError";
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      designRule: this.designRule,
      fix: this.fix,
      configFile: this.configFile,
    };
  }
}

// ============================================================
// SR: Step Registry Errors (steps_registry.json)
// ============================================================

// --- SR-INTENT: Intent validation ---

export function srIntentNotAllowed(
  intent: string,
  stepKind: string,
  stepId: string,
  allowedIntents: readonly string[],
): ConfigError {
  return new ConfigError(
    "SR-INTENT-001",
    `Intent "${intent}" not allowed for ${stepKind} step "${stepId}".`,
    `${stepKind} steps can emit: [${
      allowedIntents.join(", ")
    }]. See design/08_step_flow_design.md Section 3.`,
    `Change the AI's next_action.action to one of [${
      allowedIntents.join(", ")
    }], or move this logic to a step with the correct stepKind.`,
    "steps_registry.json",
  );
}

// --- SR-TRANS: Transition routing ---

export function srTransTargetNotFound(
  target: string,
  stepId: string,
  intent: string,
): ConfigError {
  return new ConfigError(
    "SR-TRANS-001",
    `Transition target "${target}" does not exist in registry (step "${stepId}", intent "${intent}").`,
    `All transition targets must reference existing steps in steps_registry.json. See design/08_step_flow_design.md Section 7.`,
    `Add step "${target}" to steps in steps_registry.json, or change the transition target to an existing step.`,
    "steps_registry.json",
  );
}

export function srTransTerminalNotAllowed(
  stepId: string,
  intent: string,
): ConfigError {
  const suffix = stepId.split(".").slice(1).join(".");
  return new ConfigError(
    "SR-TRANS-002",
    `Step "${stepId}" has transitions.${intent}.target: null, but target: null is only allowed for "closing" intent on closure steps.`,
    `Only closure steps with "closing" intent can have terminal transitions (target: null). This signals workflow completion. See design/02_core_architecture.md Section 4.`,
    `Set a valid target step, e.g. transitions.${intent}.target: "continuation.${suffix}".`,
    "steps_registry.json",
  );
}

export function srTransNoContinuation(
  stepId: string,
  intent: string,
): ConfigError {
  const expectedContinuation = `continuation.${
    stepId.split(".").slice(1).join(".")
  }`;
  return new ConfigError(
    "SR-TRANS-003",
    `Step "${stepId}" emitted "${intent}" but has no transitions and no continuation step "${expectedContinuation}" in the registry.`,
    `Initial steps (initial.*) default-transition to continuation.* by prefix substitution. If no continuation step exists and no explicit transitions are defined, routing fails. See design/08_step_flow_design.md Section 5.`,
    `Add "${expectedContinuation}" to steps, or add explicit transitions to "${stepId}".`,
    "steps_registry.json",
  );
}

export function srTransHandoffNoTransition(
  stepId: string,
): ConfigError {
  const suffix = stepId.split(".").slice(1).join(".");
  return new ConfigError(
    "SR-TRANS-004",
    `Step "${stepId}" emitted "handoff" but has no transitions.handoff defined.`,
    `Handoff requires an explicit transition rule in steps_registry. Handoff routes work steps to closure steps. See design/08_step_flow_design.md Section 7.`,
    `Add transitions.handoff.target to e.g. "closure.${suffix}".`,
    "steps_registry.json",
  );
}

export function srTransHandoffNullTarget(
  stepId: string,
): ConfigError {
  const suffix = stepId.split(".").slice(1).join(".");
  return new ConfigError(
    "SR-TRANS-005",
    `Step "${stepId}" has transitions.handoff.target: null, but handoff must route to an existing step (typically a closure step).`,
    `Handoff transitions connect work steps to closure steps. Unlike "closing" on closure steps, handoff cannot signal workflow completion directly. See design/08_step_flow_design.md Section 7.`,
    `Set transitions.handoff.target to e.g. "closure.${suffix}".`,
    "steps_registry.json",
  );
}

export function srTransHandoffTargetNotFound(
  target: string,
  stepId: string,
): ConfigError {
  return new ConfigError(
    "SR-TRANS-006",
    `Handoff target "${target}" does not exist in registry (step "${stepId}").`,
    `Handoff transition targets must reference existing steps. See design/08_step_flow_design.md Section 7.`,
    `Add step "${target}" to steps in steps_registry.json, or change the handoff target.`,
    "steps_registry.json",
  );
}

export function srTransEscalateNoTransition(
  stepId: string,
): ConfigError {
  return new ConfigError(
    "SR-TRANS-007",
    `No "escalate" transition defined for step "${stepId}".`,
    `Verification steps that use "escalate" intent must define a transition target to a support step. See design/08_step_flow_design.md Section 7.`,
    `Add transitions.escalate.target to step "${stepId}" in steps_registry.json.`,
    "steps_registry.json",
  );
}

export function srTransEscalateTargetNotFound(
  target: string,
  stepId: string,
): ConfigError {
  return new ConfigError(
    "SR-TRANS-008",
    `Escalate target "${target}" does not exist in registry (step "${stepId}").`,
    `Escalate transition targets must reference existing steps. See design/08_step_flow_design.md Section 7.`,
    `Add step "${target}" to steps in steps_registry.json, or change the escalate target.`,
    "steps_registry.json",
  );
}

export function srTransEscalateInvalid(
  stepId: string,
): ConfigError {
  return new ConfigError(
    "SR-TRANS-009",
    `Invalid "escalate" transition for step "${stepId}". Must specify a target step.`,
    `Escalate transitions route verification steps to support steps. A target step must be specified. See design/08_step_flow_design.md Section 7.`,
    `Set transitions.escalate.target to an existing step in steps_registry.json.`,
    "steps_registry.json",
  );
}

export function srTransJumpTargetNotFound(
  target: string,
  stepId: string,
): ConfigError {
  return new ConfigError(
    "SR-TRANS-010",
    `Jump target "${target}" does not exist in registry (step "${stepId}").`,
    `Jump transition targets must reference existing steps. See design/08_step_flow_design.md Section 7.`,
    `Add step "${target}" to steps in steps_registry.json, or change the jump target.`,
    "steps_registry.json",
  );
}

// --- SR-ENTRY: Entry step configuration ---

export function srEntryMissingConfig(agentId: string): ConfigError {
  return new ConfigError(
    "SR-ENTRY-001",
    `Step registry for "${agentId}" missing entry configuration.`,
    `Every registry must define either "entryStep" or "entryStepMapping" so the runner knows where to begin execution. See design/08_step_flow_design.md Section 2.`,
    `Add "entryStep": "<stepId>" or "entryStepMapping": { "<type>": "<stepId>" } to steps_registry.json for agent "${agentId}".`,
    "steps_registry.json",
  );
}

export function srEntryStepNotFound(
  agentId: string,
  entryStep: string,
): ConfigError {
  return new ConfigError(
    "SR-ENTRY-002",
    `Step registry for "${agentId}": entryStep "${entryStep}" does not exist in steps.`,
    `The entryStep must reference an existing step in the registry. See design/08_step_flow_design.md Section 2.`,
    `Add step "${entryStep}" to steps in steps_registry.json, or change entryStep to an existing step id.`,
    "steps_registry.json",
  );
}

export function srEntryMappingInvalid(
  agentId: string,
  errors: string[],
): ConfigError {
  return new ConfigError(
    "SR-ENTRY-003",
    `Step registry for "${agentId}" has invalid entryStepMapping:\n- ${
      errors.join("\n- ")
    }`,
    `All entryStepMapping values must reference existing steps in the registry. See design/08_step_flow_design.md Section 2.`,
    `Add the missing steps to steps_registry.json, or update entryStepMapping to reference existing step ids.`,
    "steps_registry.json",
  );
}

// --- SR-VALID: Registry validation ---

export function srValidStepKindIntentMismatch(errors: string[]): ConfigError {
  return new ConfigError(
    "SR-VALID-001",
    `Step registry validation failed (stepKind/intent mismatch):\n- ${
      errors.join("\n- ")
    }`,
    `Each stepKind restricts the set of intents a step may emit. Work steps use "handoff" to transition to closure; closure steps use "closing" to complete. See design/08_step_flow_design.md Section 3.`,
    `Update allowedIntents (or fallbackIntent) in steps_registry.json to only include intents permitted for each step's stepKind.`,
    "steps_registry.json",
  );
}

export function srValidIntentSchemaRef(errors: string[]): ConfigError {
  return new ConfigError(
    "SR-VALID-002",
    `Step registry validation failed (intentSchemaRef):\n- ${
      errors.join("\n- ")
    }`,
    `All flow steps with structuredGate must declare intentSchemaRef as an internal JSON Pointer starting with "#/". External file references are not allowed; use $ref in the step schema file instead. See design/08_step_flow_design.md Section 4.`,
    `Set intentSchemaRef to an internal pointer (e.g. "#/properties/next_action/properties/action") in steps_registry.json.`,
    "steps_registry.json",
  );
}

export function srValidIntentSchemaEnumMismatch(errors: string[]): ConfigError {
  return new ConfigError(
    "SR-VALID-003",
    `Step registry validation failed (intent schema enum mismatch):\n- ${
      errors.join("\n- ")
    }`,
    `The enum values at intentSchemaRef in the step schema must exactly match allowedIntents. Drift between the two causes runtime routing failures. See design/08_step_flow_design.md Section 4.`,
    `Synchronize the enum in the step schema file with the allowedIntents list in steps_registry.json.`,
    "steps_registry.json",
  );
}

export function srValidRegistryFailed(errors: string[]): ConfigError {
  return new ConfigError(
    "SR-VALID-004",
    `Registry validation failed:\n- ${errors.join("\n- ")}`,
    `steps_registry.json must conform to the StepRegistry schema: all required fields present, c3 in lowercase kebab-case, flow steps declare stepKind and transitions. See design/02_core_architecture.md Section 3.`,
    `Fix the listed fields in steps_registry.json to satisfy the StepRegistry schema.`,
    "steps_registry.json",
  );
}

// --- SR-LOAD: Registry loading ---

export function srLoadInvalidFormat(): ConfigError {
  return new ConfigError(
    "SR-LOAD-001",
    `Invalid registry format: missing required fields (agentId, version, steps).`,
    `steps_registry.json must contain at minimum: agentId, version, and steps. See design/02_core_architecture.md Section 3.`,
    `Ensure steps_registry.json has "agentId", "version", and "steps" fields at the top level.`,
    "steps_registry.json",
  );
}

export function srLoadAgentIdMismatch(
  expected: string,
  actual: string,
): ConfigError {
  return new ConfigError(
    "SR-LOAD-002",
    `Registry agentId mismatch: expected "${expected}", got "${actual}".`,
    `The agentId in steps_registry.json must match the agent directory name used to load it. See design/02_core_architecture.md Section 3.`,
    `Set "agentId": "${expected}" in steps_registry.json, or load the registry using the correct agent id.`,
    "steps_registry.json",
  );
}

export function srLoadNotFound(registryPath: string): ConfigError {
  return new ConfigError(
    "SR-LOAD-003",
    `Step registry not found at ${registryPath}.`,
    `Each agent must have a steps_registry.json at the expected path. See design/02_core_architecture.md Section 3.`,
    `Create steps_registry.json at "${registryPath}".`,
    "steps_registry.json",
  );
}

// --- SR-GATE: Structured gate configuration ---

export function srGateNoRoutedStepId(iteration: number): ConfigError {
  return new ConfigError(
    "SR-GATE-001",
    `No routed step ID for iteration ${iteration}.`,
    `All Flow steps must define structuredGate with transitions for routing. See design/08_step_flow_design.md Section 6.`,
    `Add structuredGate and transitions to each step in steps_registry.json.`,
    "steps_registry.json",
  );
}

export function srGateNoEntryStep(verdictType: string): ConfigError {
  return new ConfigError(
    "SR-GATE-002",
    `No entry step configured for verdictType "${verdictType}".`,
    `Each verdictType must have an entry step defined in the registry. See design/08_step_flow_design.md Section 6.`,
    `Define either "entryStepMapping.${verdictType}" or "entryStep" in steps_registry.json.`,
    "steps_registry.json",
  );
}

export function srGateFlowValidationFailed(details: string): ConfigError {
  return new ConfigError(
    "SR-GATE-003",
    `Flow validation failed. All Flow steps must define structuredGate, transitions, and outputSchemaRef.`,
    `Flow steps require structuredGate (for intent routing), transitions (for step-to-step routing), and outputSchemaRef (for structured output validation). See design/08_step_flow_design.md.`,
    `Add the missing fields to each step in steps_registry.json.\n${details}`,
    "steps_registry.json",
  );
}

export function srGateNoStructuredGateSteps(agentName: string): ConfigError {
  return new ConfigError(
    "SR-GATE-004",
    `Agent "${agentName}" uses verdictType "detect:graph" but registry has no steps with structuredGate.`,
    `The "detect:graph" verdictType requires at least one step with structuredGate defined for flow routing. See design/08_step_flow_design.md.`,
    `Add structuredGate to at least one step in steps_registry.json, or change verdictType.`,
    "steps_registry.json",
  );
}

// ============================================================
// WF: Workflow Config Errors (workflow.json)
// ============================================================

// --- WF-LOAD: Workflow file loading ---

export function wfLoadNotFound(filePath: string): ConfigError {
  return new ConfigError(
    "WF-LOAD-001",
    `Workflow config not found: ${filePath}.`,
    `The workflow configuration file must exist at the specified path. See workflow configuration documentation.`,
    `Create workflow.json at "${filePath}".`,
    "workflow.json",
  );
}

export function wfLoadReadFailed(filePath: string): ConfigError {
  return new ConfigError(
    "WF-LOAD-002",
    `Failed to read workflow config: ${filePath}.`,
    `The workflow configuration file must be readable. Check file permissions and path correctness.`,
    `Ensure workflow.json at "${filePath}" exists and is readable.`,
    "workflow.json",
  );
}

export function wfLoadInvalidJson(filePath: string): ConfigError {
  return new ConfigError(
    "WF-LOAD-003",
    `Invalid JSON in workflow config: ${filePath}.`,
    `The workflow configuration file must contain valid JSON. Syntax errors prevent loading.`,
    `Fix the JSON syntax error in workflow.json at "${filePath}".`,
    "workflow.json",
  );
}

// --- WF-SCHEMA: Required fields ---

export function wfSchemaVersionRequired(): ConfigError {
  return new ConfigError(
    "WF-SCHEMA-001",
    `Workflow config: 'version' is required and must be a string.`,
    `workflow.json must declare a "version" string field so the loader can verify compatibility.`,
    `Add "version": "<semver>" to the top level of workflow.json.`,
    "workflow.json",
  );
}

export function wfSchemaPhasesRequired(): ConfigError {
  return new ConfigError(
    "WF-SCHEMA-002",
    `Workflow config: 'phases' is required and must be an object.`,
    `workflow.json must declare a "phases" object mapping phase IDs to their definitions.`,
    `Add "phases": { ... } to the top level of workflow.json.`,
    "workflow.json",
  );
}

export function wfSchemaLabelMappingRequired(): ConfigError {
  return new ConfigError(
    "WF-SCHEMA-003",
    `Workflow config: 'labelMapping' is required and must be an object.`,
    `workflow.json must declare a "labelMapping" object mapping GitHub labels to phase IDs.`,
    `Add "labelMapping": { ... } to the top level of workflow.json.`,
    "workflow.json",
  );
}

export function wfSchemaAgentsRequired(): ConfigError {
  return new ConfigError(
    "WF-SCHEMA-004",
    `Workflow config: 'agents' is required and must be an object.`,
    `workflow.json must declare an "agents" object mapping agent IDs to their definitions.`,
    `Add "agents": { ... } to the top level of workflow.json.`,
    "workflow.json",
  );
}

// --- WF-PHASE: Phase validation ---

export function wfPhaseInvalidType(
  phaseId: string,
  type: string,
  validTypes: readonly string[],
): ConfigError {
  return new ConfigError(
    "WF-PHASE-001",
    `Phase "${phaseId}" has invalid type "${type}".`,
    `Phase types must be one of: [${
      validTypes.join(", ")
    }]. See workflow configuration documentation.`,
    `Change the type of phase "${phaseId}" in workflow.json to a valid type.`,
    "workflow.json",
  );
}

export function wfPhaseAgentRequired(phaseId: string): ConfigError {
  return new ConfigError(
    "WF-PHASE-002",
    `Actionable phase "${phaseId}" must have 'agent' defined.`,
    `Actionable phases must reference an agent that handles work for that phase. See workflow configuration documentation.`,
    `Add "agent": "<agentId>" to phase "${phaseId}" in workflow.json.`,
    "workflow.json",
  );
}

export function wfPhasePriorityRequired(phaseId: string): ConfigError {
  return new ConfigError(
    "WF-PHASE-003",
    `Actionable phase "${phaseId}" must have 'priority' defined.`,
    `Actionable phases must declare a priority so the orchestrator can schedule work correctly. See workflow configuration documentation.`,
    `Add "priority": <number> to phase "${phaseId}" in workflow.json.`,
    "workflow.json",
  );
}

// --- WF-LABEL: Label mapping ---

export function wfLabelMappingEmpty(): ConfigError {
  return new ConfigError(
    "WF-LABEL-001",
    `Workflow config: 'labelMapping' must not be empty.`,
    `labelMapping must contain at least one entry to route GitHub labels to phases. An empty mapping means no issues can be processed.`,
    `Add at least one label-to-phase mapping to "labelMapping" in workflow.json.`,
    "workflow.json",
  );
}

export function wfLabelUnknownPhase(
  label: string,
  targetPhase: string,
): ConfigError {
  return new ConfigError(
    "WF-LABEL-002",
    `Label "${label}" maps to unknown phase "${targetPhase}".`,
    `All labelMapping values must reference phase IDs defined in the "phases" section. See workflow configuration documentation.`,
    `Add phase "${targetPhase}" to the "phases" section in workflow.json, or change the mapping for label "${label}" to an existing phase.`,
    "workflow.json",
  );
}

export function wfLabelSpecMissing(
  missingLabels: readonly string[],
): ConfigError {
  const list = missingLabels.map((l) => `"${l}"`).join(", ");
  return new ConfigError(
    "WF-LABEL-003",
    `Workflow config: labels[] is missing specs for: [${list}].`,
    `Every label referenced by labelMapping or prioritizer.labels must have a matching entry in "labels" so the pre-dispatch sync can create/update it with the correct color and description. Missing specs would force the sync to invent defaults, drifting from the declared source of truth.`,
    `Add entries to "labels" in workflow.json for: [${list}], each with { "color": "<6-hex>", "description": "<text>" }.`,
    "workflow.json",
  );
}

export function wfLabelSpecOrphan(
  orphanLabels: readonly string[],
): ConfigError {
  const list = orphanLabels.map((l) => `"${l}"`).join(", ");
  return new ConfigError(
    "WF-LABEL-004",
    `Workflow config: labels[] declares specs not referenced by labelMapping or prioritizer.labels: [${list}].`,
    `Orphan label specs risk drifting from runtime behavior — if a label is declared but never used, the sync still pushes it and a later contributor has no signal about whether removing it is safe. Keep the label set tight.`,
    `Either reference the label from labelMapping / prioritizer.labels, or remove the entry from "labels" in workflow.json.`,
    "workflow.json",
  );
}

export function wfLabelSpecInvalidColor(
  label: string,
  color: string,
): ConfigError {
  return new ConfigError(
    "WF-LABEL-005",
    `Workflow config: labels["${label}"].color "${color}" is not a valid 6-char hex value.`,
    `GitHub label colors must be exactly 6 hex characters without a leading "#". Any other form will cause the label sync API call to fail.`,
    `Change labels["${label}"].color in workflow.json to a 6-character hex value (0-9, a-f), e.g. "a2eeef".`,
    "workflow.json",
  );
}

// --- WF-RULE: Rules validation ---

export function wfRuleMaxCyclesInvalid(value: number): ConfigError {
  return new ConfigError(
    "WF-RULE-001",
    `Workflow config: 'rules.maxCycles' must be >= 1, got ${value}.`,
    `maxCycles controls the maximum number of orchestration cycles. A value less than 1 would prevent any work from being done.`,
    `Set "rules.maxCycles" to a positive integer (>= 1) in workflow.json.`,
    "workflow.json",
  );
}

export function wfRuleCycleDelayInvalid(value: number): ConfigError {
  return new ConfigError(
    "WF-RULE-002",
    `Workflow config: 'rules.cycleDelayMs' must be >= 0, got ${value}.`,
    `cycleDelayMs is the delay between orchestration cycles in milliseconds. A negative value is not a valid duration.`,
    `Set "rules.cycleDelayMs" to a non-negative integer (>= 0) in workflow.json.`,
    "workflow.json",
  );
}

// --- WF-REF: Cross-references ---

export function wfRefUnknownAgent(
  phaseId: string,
  agentId: string,
): ConfigError {
  return new ConfigError(
    "WF-REF-001",
    `Phase "${phaseId}" references unknown agent "${agentId}".`,
    `Every agent referenced by a phase must be declared in the "agents" section. See workflow configuration documentation.`,
    `Add agent "${agentId}" to the "agents" section in workflow.json, or change the agent reference in phase "${phaseId}".`,
    "workflow.json",
  );
}

export function wfRefUnknownFallbackPhase(
  agentId: string,
  fallbackPhase: string,
): ConfigError {
  return new ConfigError(
    "WF-REF-002",
    `Agent "${agentId}" references unknown fallbackPhase "${fallbackPhase}".`,
    `All agent phase references must point to phases declared in the "phases" section. See workflow configuration documentation.`,
    `Add phase "${fallbackPhase}" to the "phases" section in workflow.json, or change the fallbackPhase of agent "${agentId}".`,
    "workflow.json",
  );
}

export function wfRefUnknownOutputPhase(
  agentId: string,
  outputPhase: string,
): ConfigError {
  return new ConfigError(
    "WF-REF-003",
    `Agent "${agentId}" references unknown outputPhase "${outputPhase}".`,
    `All agent phase references must point to phases declared in the "phases" section. See workflow configuration documentation.`,
    `Add phase "${outputPhase}" to the "phases" section in workflow.json, or change the outputPhase of agent "${agentId}".`,
    "workflow.json",
  );
}

export function wfRefUnknownOutputPhasesEntry(
  agentId: string,
  key: string,
  targetPhase: string,
): ConfigError {
  return new ConfigError(
    "WF-REF-004",
    `Agent "${agentId}" outputPhases["${key}"] references unknown phase "${targetPhase}".`,
    `All outputPhases entries must reference phases declared in the "phases" section. See workflow configuration documentation.`,
    `Add phase "${targetPhase}" to the "phases" section in workflow.json, or change outputPhases["${key}"] of agent "${agentId}".`,
    "workflow.json",
  );
}

// --- WF-REF: closeOnComplete / closeCondition cross-reference errors ---

export function wfRefCloseConditionWithoutCloseOnComplete(
  agentId: string,
): ConfigError {
  return new ConfigError(
    "WF-REF-005",
    `Agent "${agentId}" has "closeCondition" but "closeOnComplete" is not enabled.`,
    `"closeCondition" filters which outcome triggers issue close, so it requires "closeOnComplete: true" to take effect.`,
    `Add "closeOnComplete": true to agent "${agentId}", or remove "closeCondition".`,
    "workflow.json",
  );
}

export function wfRefInvalidCloseCondition(
  agentId: string,
  closeCondition: string,
  validKeys: string[],
): ConfigError {
  return new ConfigError(
    "WF-REF-006",
    `Agent "${agentId}" closeCondition "${closeCondition}" is not a key in outputPhases.`,
    `closeCondition must match one of the outcome keys in outputPhases so it can actually trigger. Valid keys: [${
      validKeys.join(", ")
    }].`,
    `Change closeCondition to one of [${
      validKeys.join(", ")
    }], or add "${closeCondition}" to outputPhases.`,
    "workflow.json",
  );
}

// --- WF-BATCH: Batch operation errors ---

export function wfBatchPrioritizeMissingConfig(): ConfigError {
  return new ConfigError(
    "WF-BATCH-001",
    "--prioritize requested but 'prioritizer' is not defined in workflow config.",
    "Prioritize mode requires a 'prioritizer' section with agent, labels, and defaultLabel.",
    "Add a 'prioritizer' section to workflow.json, or remove the --prioritize flag.",
    "workflow.json",
  );
}

// ============================================================
// PR: Prompt Errors (prompts/)
// ============================================================

// --- PR-FILE: Prompt file access ---

export function prFileNotFound(path: string): ConfigError {
  return new ConfigError(
    "PR-FILE-001",
    `Prompt file not found: "${path}".`,
    `Prompt files must exist at the expected path. File-not-found at the adapter layer indicates a missing C3L template, system prompt, or fallback file. See design/08_step_flow_design.md.`,
    `Create the prompt file at "${path}", or verify the path configuration in steps_registry.json and agent.json.`,
    "prompts/",
  );
}

/**
 * Type guard for PR-FILE-001 errors.
 * Use this instead of instanceof checks on the former PromptNotFoundError class.
 */
export function isPromptFileNotFound(error: unknown): error is ConfigError {
  return error instanceof ConfigError && error.code === "PR-FILE-001";
}

// --- PR-RESOLVE: Prompt resolution (step lookup, variable substitution) ---

export function prResolveUnknownStepId(stepId: string): ConfigError {
  return new ConfigError(
    "PR-RESOLVE-001",
    `Unknown step ID "${stepId}" in steps_registry.`,
    `Step IDs must match entries defined in steps_registry.json. See design/08_step_flow_design.md.`,
    `Add step "${stepId}" to steps in steps_registry.json, or correct the step ID reference.`,
    "steps_registry.json",
  );
}

export function prResolveMissingRequiredUv(
  uvName: string,
  stepId: string,
): ConfigError {
  return new ConfigError(
    "PR-RESOLVE-003",
    `Missing required UV variable "${uvName}" for step "${stepId}".`,
    `UV variables declared in uvVariables (steps_registry.json) must be provided at runtime. Check that the variable is declared in agent.json parameters and steps_registry.json uvVariables.`,
    `Ensure "${uvName}" is in agent.json parameters, steps_registry.json uvVariables for step "${stepId}", and passed at runtime. If step was derived via prefix substitution (initial.* -> continuation.*), ensure both steps declare the same uvVariables.`,
    "steps_registry.json",
  );
}

export function prResolveMissingInputText(stepId: string): ConfigError {
  return new ConfigError(
    "PR-RESOLVE-004",
    `Step "${stepId}" requires input_text but none provided.`,
    `Steps with usesStdin: true in steps_registry.json require input_text to be passed at runtime.`,
    `Provide input_text when calling resolve() for step "${stepId}", or set usesStdin: false in steps_registry.json if stdin is not required.`,
    "steps_registry.json",
  );
}

export function prResolveUvNotProvided(
  uvName: string,
  stepId: string,
): ConfigError {
  return new ConfigError(
    "PR-RESOLVE-005",
    `UV variable "${uvName}" not provided for step "${stepId}".`,
    `All UV variables referenced in the prompt template must be provided at runtime. See design/08_step_flow_design.md.`,
    `Pass "${uvName}" in the uv variables map when resolving prompts for step "${stepId}".`,
    "steps_registry.json",
  );
}

// --- PR-C3L: C3L path, breakdown, and prompt file errors ---

export function prC3lInvalidPathFormat(path: string): ConfigError {
  return new ConfigError(
    "PR-C3L-001",
    `Invalid C3L path format: ${path}. Expected "c1/c2/c3" or "c1/c2/c3:edition".`,
    `C3L paths must have exactly 3 slash-separated components (c1/c2/c3), optionally followed by a colon-separated edition. See design/02_core_architecture.md.`,
    `Correct the path to the format "c1/c2/c3" or "c1/c2/c3:edition", e.g. "to/issue/create" or "to/issue/create:default".`,
    "prompts/",
  );
}

// --- PR-C3L-002: C3L breakdown returned a non-file-not-found error ---

export function prC3lBreakdownFailed(
  stepId: string,
  detail: string,
): ConfigError {
  return new ConfigError(
    "PR-C3L-002",
    `C3L breakdown failed for step "${stepId}": ${detail}`,
    `When C3L load returns ok:false with an error other than file-not-found (e.g., UV undefined, frontmatter broken, YAML parse failure), the error must propagate — not silently fall back. Silent fallback hides user-correctable C3L issues. See CLAUDE.md (fallback最小限).`,
    `Fix the C3L template for step "${stepId}": check UV variables, frontmatter syntax, and YAML format. The detail above describes the specific failure.`,
    "prompts/",
  );
}

export function prC3lNoPrompt(
  stepId: string,
  iteration: number,
): ConfigError {
  return new ConfigError(
    "PR-C3L-003",
    `No C3L prompt found for step "${stepId}" at iteration ${iteration}.`,
    `Flow steps must have C3L prompts when steps_registry is configured (design: "プロンプト参照は C3L 形式のみ"). See design/08_step_flow_design.md.`,
    `Add a C3L prompt file for step "${stepId}" under the configured prompts directory.`,
    "prompts/",
  );
}

// --- PR-C3L-004: C3L prompt file not found ---

export function prC3lPromptNotFound(
  stepId: string,
  triedPath: string,
): ConfigError {
  return new ConfigError(
    "PR-C3L-004",
    `C3L prompt file not found for step "${stepId}" (tried: ${triedPath}).`,
    `All steps must have a C3L prompt file. Embedded fallback prompts are not supported. See design/08_step_flow_design.md.`,
    `Add a C3L prompt file for step "${stepId}" under the configured prompts directory at the expected path: ${triedPath}.`,
    "prompts/",
  );
}

// --- PR-SYSTEM: System prompt resolution ---

export function prSystemPromptLoadFailed(
  path: string,
  detail: string,
): ConfigError {
  return new ConfigError(
    "PR-SYSTEM-001",
    `Failed to load system prompt at "${path}": ${detail}`,
    `System prompts must be readable UTF-8 files so the runner can inject agent metadata deterministically. Fallback prompts are only for bootstrap scenarios. See docs/guides/en/11-runner-reference.md Section 11.3.5.`,
    `Fix the file (permissions, encoding, or syntax) at "${path}" so it can be read successfully, or restore the expected prompts/system.md file.`,
    "prompts/",
  );
}

export function prSystemPromptNotFound(path: string): ConfigError {
  return new ConfigError(
    "PR-SYSTEM-002",
    `System prompt file not found: "${path}". Every agent must provide a prompts/system.md file.`,
    `C3L-only prompt resolution — no fallback`,
    `Create a system prompt file at "${path}" with role-specific instructions for this agent.`,
    "prompts/",
  );
}

// --- SR-ENTRY-004: Step machine entry step (StepMachineVerdictHandler) ---

export function srEntryNotConfigured(): ConfigError {
  return new ConfigError(
    "SR-ENTRY-004",
    `No entry step configured in registry.`,
    `The step machine requires an explicit entry step to start execution. No implicit fallback is allowed. See design/06_runner.md.`,
    `Add "entryStep" or "entryStepMapping" to steps_registry.json.`,
    "steps_registry.json",
  );
}

// ============================================================
// AC: Agent Config Errors (agent.json)
// ============================================================

// --- AC-LOAD: Agent config loading ---

export function acLoadNotFound(path: string): ConfigError {
  return new ConfigError(
    "AC-LOAD-001",
    `Agent definition not found at "${path}".`,
    `Each agent requires an agent.json file defining its parameters, verdict type, and integrations. See design/02_core_architecture.md Section 3.`,
    `Create agent.json at "${path}", or run \`deno task agent --init --agent <name>\` to scaffold.`,
    "agent.json",
  );
}

export function acLoadParseFailed(path: string, detail: string): ConfigError {
  return new ConfigError(
    "AC-LOAD-002",
    `Failed to parse agent definition at "${path}": ${detail}`,
    `agent.json must be valid JSON. See design/02_core_architecture.md Section 3.`,
    `Fix the JSON syntax error in "${path}". Use a JSON validator to locate the issue.`,
    "agent.json",
  );
}

export function acLoadInvalid(errors: string): ConfigError {
  return new ConfigError(
    "AC-LOAD-003",
    `Invalid agent definition: ${errors}`,
    `agent.json must pass schema validation. All required fields (name, version, runner, etc.) must be present and well-formed. See design/02_core_architecture.md Section 3.`,
    `Fix the listed fields in agent.json to satisfy the agent definition schema.`,
    "agent.json",
  );
}

// --- AC-VALID: Agent config validation ---

export function acValidFailed(errors: string): ConfigError {
  return new ConfigError(
    "AC-VALID-001",
    `Configuration validation failed: ${errors}`,
    `agent.json must pass all configuration validation rules after defaults are applied. See design/02_core_architecture.md Section 3.`,
    `Fix the listed validation errors in agent.json.`,
    "agent.json",
  );
}

export function acValidIncomplete(errors: string): ConfigError {
  return new ConfigError(
    "AC-VALID-002",
    `Configuration incomplete: ${errors}`,
    `agent.json must have all required fields populated after defaults are applied. See design/02_core_architecture.md Section 3.`,
    `Add the missing required fields to agent.json.`,
    "agent.json",
  );
}

// --- AC-SERVICE: Config service loading ---

export function acServiceFileNotFound(path: string): ConfigError {
  const configFile = path.endsWith("steps_registry.json")
    ? "steps_registry.json"
    : "agent.json";
  return new ConfigError(
    "AC-SERVICE-001",
    `Configuration load failed at "${path}": File not found.`,
    `The configuration file must exist at the expected path. See design/02_core_architecture.md Section 3.`,
    `Create the file at "${path}", or verify the agent name and base directory are correct.`,
    configFile,
  );
}

export function acServiceInvalidJson(path: string): ConfigError {
  const configFile = path.endsWith("steps_registry.json")
    ? "steps_registry.json"
    : "agent.json";
  return new ConfigError(
    "AC-SERVICE-002",
    `Configuration load failed at "${path}": Invalid JSON.`,
    `Configuration files must be valid JSON. See design/02_core_architecture.md Section 3.`,
    `Fix the JSON syntax error in "${path}". Use a JSON validator to locate the issue.`,
    configFile,
  );
}

export function acServiceLoadFailed(path: string, detail: string): ConfigError {
  const configFile = path.endsWith("steps_registry.json")
    ? "steps_registry.json"
    : "agent.json";
  return new ConfigError(
    "AC-SERVICE-003",
    `Configuration load failed at "${path}": ${detail}`,
    `The configuration file must be readable. See design/02_core_architecture.md Section 3.`,
    `Check file permissions and ensure "${path}" is accessible.`,
    configFile,
  );
}

export function acServiceRegistryLoadFailed(
  path: string,
  detail: string,
): ConfigError {
  return new ConfigError(
    "AC-SERVICE-004",
    `Configuration load failed at "${path}": ${detail}`,
    `steps_registry.json must be readable when present. See design/02_core_architecture.md Section 3.`,
    `Check file permissions and ensure "${path}" is valid JSON.`,
    "steps_registry.json",
  );
}

// ============================================================
// AC-VERDICT: Verdict configuration (agent.json)
// ============================================================

export function acVerdict001PollStateRequiresIssue(): ConfigError {
  return new ConfigError(
    "AC-VERDICT-001",
    `poll:state verdict type requires "issue" parameter.`,
    `poll:state checks external issue state for completion. It needs an issue number to poll. See design/06_runner.md.`,
    `Add "issue" to parameters in agent.json with {type: "number", required: true, cli: "--issue"}.`,
    "agent.json",
  );
}

export function acVerdict002DetectStructuredRequiresSignalType(): ConfigError {
  return new ConfigError(
    "AC-VERDICT-002",
    `detect:structured verdict type requires "signalType" in verdictConfig.`,
    `detect:structured matches structured JSON output from the LLM by signal type. Without a signalType, the handler cannot identify completion signals. See design/06_runner.md.`,
    `Add "signalType" to runner.verdict.config in agent.json, e.g. { "signalType": "task_complete" }.`,
    "agent.json",
  );
}

export function acVerdict003CompositeRequiresConditionsAndOperator(): ConfigError {
  return new ConfigError(
    "AC-VERDICT-003",
    `meta:composite verdict type requires "conditions" and "operator" in verdictConfig.`,
    `meta:composite combines multiple verdict conditions with a logical operator (and/or/first). Both fields are mandatory to define the composite logic. See design/06_runner.md.`,
    `Add "conditions" (array of condition objects) and "operator" ("and", "or", or "first") to runner.verdict.config in agent.json.`,
    "agent.json",
  );
}

export function acVerdict004CustomRequiresHandlerPath(): ConfigError {
  return new ConfigError(
    "AC-VERDICT-004",
    `meta:custom verdict type requires "handlerPath" in verdictConfig.`,
    `meta:custom delegates completion logic to a user-provided handler module. The handlerPath tells the runner where to load it from. See design/06_runner.md.`,
    `Add "handlerPath" to runner.verdict.config in agent.json, e.g. { "handlerPath": "handlers/my-handler.ts" }.`,
    "agent.json",
  );
}

export function acVerdict005UnknownCompletionType(
  verdictType: string,
): ConfigError {
  return new ConfigError(
    "AC-VERDICT-005",
    `Unknown completion type: "${verdictType}".`,
    `The runner selects a verdict handler by matching the type field in runner.verdict against the registered handler registry. An unrecognized type has no handler. See design/06_runner.md.`,
    `Set runner.verdict.type in agent.json to one of: "poll:state", "count:iteration", "detect:keyword", "count:check", "detect:structured", "meta:composite", "detect:graph", "meta:custom".`,
    "agent.json",
  );
}

export function acVerdict006CustomHandlerMustExportFactory(
  fullPath: string,
): ConfigError {
  return new ConfigError(
    "AC-VERDICT-006",
    `Custom handler must export default factory function: "${fullPath}".`,
    `meta:custom handler modules must export a default function that acts as a factory, receiving (definition, args) and returning a VerdictHandler. See design/06_runner.md.`,
    `Ensure the module at "handlerPath" has "export default function(definition, args): VerdictHandler { ... }".`,
    "agent.json",
  );
}

export function acVerdict007FailedToLoadCustomHandler(
  fullPath: string,
  cause: string,
): ConfigError {
  return new ConfigError(
    "AC-VERDICT-007",
    `Failed to load custom completion handler from "${fullPath}": ${cause}`,
    `meta:custom handler must be a valid importable module at the path specified in handlerPath. See design/06_runner.md.`,
    `Verify that "handlerPath" in agent.json resolves to an existing, valid TypeScript/JavaScript module.`,
    "agent.json",
  );
}

export function acVerdict008DetectStructuredConditionRequiresSignalType(): ConfigError {
  return new ConfigError(
    "AC-VERDICT-008",
    `detect:structured condition in composite requires "signalType" in config.`,
    `Within a meta:composite handler, each detect:structured condition must specify a signalType so the handler knows which JSON signal signals completion for that condition. See design/06_runner.md.`,
    `Add "signalType" to the detect:structured condition's config object inside runner.verdict.config.conditions in agent.json.`,
    "agent.json",
  );
}

export function acVerdict009PollStateConditionRequiresIssue(): ConfigError {
  return new ConfigError(
    "AC-VERDICT-009",
    `poll:state condition in composite requires "issue" parameter.`,
    `Within a meta:composite handler, poll:state conditions still require an issue number to poll. The --issue CLI parameter must be declared in agent.json parameters. See design/06_runner.md.`,
    `Add "issue" to parameters in agent.json with {type: "number", required: true, cli: "--issue"}.`,
    "agent.json",
  );
}

export function acVerdict010UnsupportedConditionTypeInComposite(
  conditionType: string,
): ConfigError {
  return new ConfigError(
    "AC-VERDICT-010",
    `Unsupported condition type in composite: "${conditionType}".`,
    `meta:composite only supports a fixed set of condition types. An unrecognized type cannot be instantiated. See design/06_runner.md.`,
    `Use only supported condition types in runner.verdict.config.conditions in agent.json: "count:iteration", "detect:keyword", "count:check", "detect:structured", "poll:state".`,
    "agent.json",
  );
}

export function acVerdict011DetectGraphRequiresRegistry(
  registryPath: string,
): ConfigError {
  return new ConfigError(
    "AC-VERDICT-011",
    `detect:graph verdict type requires steps_registry.json but file not found at "${registryPath}".`,
    `detect:graph uses StepMachineVerdictHandler which reads the step graph from steps_registry.json. Without it, the handler cannot determine completion. See design/02_core_architecture.md.`,
    `Create steps_registry.json at the expected path, or change runner.verdict.type to a type that does not require a registry (e.g., "count:iteration").`,
    "steps_registry.json",
  );
}
