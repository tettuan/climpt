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
  DEFAULT_SUBJECT_STORE,
  deriveInvocations,
  type IssueSource,
  type WorkflowConfig,
  type WorkflowRules,
} from "./workflow-types.ts";
import {
  accept,
  type Decision,
  reject as rejectDecision,
  type ValidationError,
  validationError,
  type ValidationErrorCode,
} from "../shared/validation/mod.ts";
import { ConfigError } from "../shared/errors/config-errors.ts";
import {
  wfIssueSourceExplicitMissingIds,
  wfIssueSourceGhProjectMissingProject,
  wfIssueSourceGhRepoInvalidMembership,
  wfIssueSourceRequired,
  wfIssueSourceUnknownKind,
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
  wfProjectDonePhaseNotInLabelMapping,
  wfProjectDonePhaseNotTerminal,
  wfProjectDonePhaseUnknown,
  wfProjectEvalPhaseAgentMissing,
  wfProjectEvalPhaseNotActionable,
  wfProjectEvalPhaseNotInLabelMapping,
  wfProjectEvalPhaseUnknown,
  wfProjectPlanPhaseAgentMissing,
  wfProjectPlanPhaseNotActionable,
  wfProjectPlanPhaseNotInLabelMapping,
  wfProjectPlanPhaseUnknown,
  wfProjectSentinelLabelNotMarker,
  wfProjectSentinelLabelUnknown,
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

  const rawSubjectStore = parsed.subjectStore as
    | WorkflowConfig["subjectStore"]
    | undefined;

  // TODO(T1.7): the shipped `.agent/workflow.json` is migrated by the
  // disk-config migration script (phased-plan T1.7). Until that lands,
  // existing workflow.json files without `issueSource` will fail loading
  // here with WF-ISSUE-SOURCE-001 by design (no backward-compat shim per
  // CLAUDE.md "後方互換性不要").
  const issueSource = parseIssueSource(parsed.issueSource);

  const phases = parsed.phases as WorkflowConfig["phases"];
  const agents = parsed.agents as WorkflowConfig["agents"];

  const config: WorkflowConfig = {
    version: parsed.version as string,
    labelPrefix: parsed.labelPrefix as string | undefined,
    issueSource,
    phases,
    labelMapping: parsed.labelMapping as WorkflowConfig["labelMapping"],
    labels: parsed.labels as WorkflowConfig["labels"],
    agents,
    invocations: deriveInvocations(phases, agents),
    rules: applyDefaultRules(
      parsed.rules as Partial<WorkflowRules> | undefined,
    ),
    handoff: parsed.handoff as WorkflowConfig["handoff"],
    subjectStore: rawSubjectStore ?? DEFAULT_SUBJECT_STORE,
    prioritizer: parsed.prioritizer as WorkflowConfig["prioritizer"],
    handoffs: parsed.handoffs as WorkflowConfig["handoffs"],
    payloadSchema: parsed.payloadSchema as WorkflowConfig["payloadSchema"],
    projectBinding: parsed.projectBinding as WorkflowConfig["projectBinding"],
  };

  validateCrossReferences(config);

  return config;
}

const VALID_ISSUE_SOURCE_KINDS = ["ghProject", "ghRepoIssues", "explicit"];
const VALID_GH_REPO_MEMBERSHIP = ["any", "unbound"];

/**
 * Parse and validate the top-level `issueSource` ADT.
 *
 * The variant is selected by the `kind` discriminator. Per-variant
 * required fields are enforced; optional shared fields (`labels` /
 * `state` / `limit`) are passed through unchanged. See
 * `agents/docs/design/realistic/12-workflow-config.md` §C.
 */
function parseIssueSource(raw: unknown): IssueSource {
  if (raw === undefined || raw === null || typeof raw !== "object") {
    throw wfIssueSourceRequired();
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== "string") {
    throw wfIssueSourceRequired();
  }

  switch (kind) {
    case "ghProject": {
      const project = obj.project;
      if (project === undefined || project === null) {
        throw wfIssueSourceGhProjectMissingProject();
      }
      // ProjectRef shape: { owner, number } | { id }. Loader trusts the
      // disk schema beyond presence — deeper validation belongs in T1.4.
      return {
        kind: "ghProject",
        project: project as IssueSource extends { kind: "ghProject" }
          ? Extract<IssueSource, { kind: "ghProject" }>["project"]
          : never,
        labels: obj.labels as readonly string[] | undefined,
        state: obj.state as
          | Extract<IssueSource, { kind: "ghProject" }>["state"]
          | undefined,
        limit: obj.limit as number | undefined,
      };
    }
    case "ghRepoIssues": {
      const membership = obj.projectMembership;
      if (
        membership !== undefined &&
        (typeof membership !== "string" ||
          !VALID_GH_REPO_MEMBERSHIP.includes(membership))
      ) {
        throw wfIssueSourceGhRepoInvalidMembership(
          membership,
          VALID_GH_REPO_MEMBERSHIP,
        );
      }
      return {
        kind: "ghRepoIssues",
        repo: obj.repo as string | undefined,
        labels: obj.labels as readonly string[] | undefined,
        state: obj.state as
          | Extract<IssueSource, { kind: "ghRepoIssues" }>["state"]
          | undefined,
        limit: obj.limit as number | undefined,
        projectMembership: membership as
          | Extract<IssueSource, { kind: "ghRepoIssues" }>["projectMembership"]
          | undefined,
      };
    }
    case "explicit": {
      const issueIds = obj.issueIds;
      if (!Array.isArray(issueIds) || issueIds.length === 0) {
        throw wfIssueSourceExplicitMissingIds();
      }
      return {
        kind: "explicit",
        issueIds: issueIds as readonly (string | number)[],
      };
    }
    default:
      throw wfIssueSourceUnknownKind(kind, VALID_ISSUE_SOURCE_KINDS);
  }
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

  // 7. projectBinding cross-references (T6.eval trigger)
  validateProjectBinding(config);
}

/**
 * Validate the `projectBinding` block when declared.
 *
 * When `projectBinding` is absent, T6.eval and the O1/O2 hooks are
 * no-ops (Invariant I1 in design/13_project_orchestration.md §3), so no
 * cross-ref check runs. When present, the three identifiers the T6.eval
 * trigger consumes (`donePhase`, `evalPhase`, `sentinelLabel`) must
 * resolve against the workflow — otherwise the trigger would silently
 * no-op or write an unreachable label at runtime. All nine failure
 * modes are enumerated as WF-PROJECT-00N so reviewers can spot drift
 * between projectBinding and phases/labels/labelMapping up front.
 */
function validateProjectBinding(config: WorkflowConfig): void {
  const binding = config.projectBinding;
  if (binding === undefined) return;

  // donePhase must reference a terminal phase that has a labelMapping entry.
  const donePhase = config.phases[binding.donePhase];
  if (donePhase === undefined) {
    throw wfProjectDonePhaseUnknown(binding.donePhase);
  }
  if (donePhase.type !== "terminal") {
    throw wfProjectDonePhaseNotTerminal(binding.donePhase, donePhase.type);
  }
  const doneHasLabel = Object.values(config.labelMapping).includes(
    binding.donePhase,
  );
  if (!doneHasLabel) {
    throw wfProjectDonePhaseNotInLabelMapping(binding.donePhase);
  }

  // evalPhase must reference an actionable phase with an agent, backed by
  // a labelMapping entry that lets the trigger actually apply a label.
  const evalPhase = config.phases[binding.evalPhase];
  if (evalPhase === undefined) {
    throw wfProjectEvalPhaseUnknown(binding.evalPhase);
  }
  if (evalPhase.type !== "actionable") {
    throw wfProjectEvalPhaseNotActionable(binding.evalPhase, evalPhase.type);
  }
  if (evalPhase.agent === null || evalPhase.agent === undefined) {
    throw wfProjectEvalPhaseAgentMissing(binding.evalPhase);
  }
  const evalHasLabel = Object.values(config.labelMapping).includes(
    binding.evalPhase,
  );
  if (!evalHasLabel) {
    throw wfProjectEvalPhaseNotInLabelMapping(binding.evalPhase);
  }

  // planPhase must reference an actionable phase with an agent, backed by
  // a labelMapping entry so project:init can stamp a label on creation.
  const planPhase = config.phases[binding.planPhase];
  if (planPhase === undefined) {
    throw wfProjectPlanPhaseUnknown(binding.planPhase);
  }
  if (planPhase.type !== "actionable") {
    throw wfProjectPlanPhaseNotActionable(binding.planPhase, planPhase.type);
  }
  if (planPhase.agent === null || planPhase.agent === undefined) {
    throw wfProjectPlanPhaseAgentMissing(binding.planPhase);
  }
  const planHasLabel = Object.values(config.labelMapping).includes(
    binding.planPhase,
  );
  if (!planHasLabel) {
    throw wfProjectPlanPhaseNotInLabelMapping(binding.planPhase);
  }

  // sentinelLabel must be a declared marker label. `config.labels` being
  // absent means the workflow never adopted the declarative label model,
  // so we cannot enforce the role constraint — skip silently. (Same
  // opt-in shape as validateLabelsSection.)
  if (config.labels !== undefined) {
    const spec = config.labels[binding.sentinelLabel];
    if (spec === undefined) {
      throw wfProjectSentinelLabelUnknown(binding.sentinelLabel);
    }
    const role = spec.role ?? "routing";
    if (role !== "marker") {
      throw wfProjectSentinelLabelNotMarker(binding.sentinelLabel, role);
    }
  }
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

  // Orphans: routing labels must be referenced somewhere. Marker labels
  // (role="marker") are identification-only and exempt — they are consumed
  // by code via label-membership probes (e.g., project-sentinel), not by
  // phase dispatch. Marker role is opt-in, so the default stays strict.
  const orphans = [...declaredKeys].filter((l) => {
    if (requiredLabels.has(l)) return false;
    return (declaredLabels[l].role ?? "routing") !== "marker";
  });
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

  // closeBinding.condition cross-validation
  // (replaces legacy closeOnComplete + closeCondition cross-check)
  const cb = agent.closeBinding;
  if (cb?.condition !== undefined) {
    if (cb.primary?.kind === "none" || cb.primary === undefined) {
      throw wfRefCloseConditionWithoutCloseOnComplete(agentId);
    }
    if (
      agent.role === "validator" &&
      !(cb.condition in agent.outputPhases)
    ) {
      throw wfRefInvalidCloseCondition(
        agentId,
        cb.condition,
        Object.keys(agent.outputPhases),
      );
    }
  }
}

/**
 * Map a workflow `ConfigError` (WF-* code) to its design rule code.
 *
 * Mapping is by error-code prefix family per design 12 §F:
 *  - `WF-LOAD-*` / `WF-SCHEMA-*` → loader-time JSON shape, **W1**
 *    (closest fit; T1.4 keeps loader-shape errors at W1 since the
 *    realistic-design rule set begins at W1 = "phases declared").
 *  - `WF-PHASE-*`     → **W1** (PhaseDecl integrity).
 *  - `WF-LABEL-*`     → **W5** (labelMapping value ∈ phases).
 *  - `WF-RULE-*`      → **W1** (workflow-level integrity).
 *  - `WF-REF-001`     → **W3** (invocation/agent reference).
 *  - `WF-REF-002..6`  → **W4** (nextPhase / outputPhase references).
 *  - `WF-PROJECT-*`   → **W6** (projectBinding cross-references).
 *  - `WF-ISSUE-SOURCE-*` → **W7** (issueSource ADT — keeps the T1.1
 *    typed throws as W7-tagged ValidationError when surfaced via the
 *    Decision boundary; loader-level throw path is unchanged).
 *
 * TODO[T2.2]: replace this code-prefix mapping with native
 * Decision-shaped sub-validators inside `validateCrossReferences` so
 * each rule emits its own ValidationError without re-classification.
 */
function mapWorkflowErrorCodeToRule(code: string): ValidationErrorCode {
  if (code.startsWith("WF-ISSUE-SOURCE-")) return "W7";
  if (code.startsWith("WF-PROJECT-")) return "W6";
  if (code === "WF-REF-001") return "W3";
  if (code.startsWith("WF-REF-")) return "W4";
  if (code.startsWith("WF-LABEL-")) return "W5";
  if (code.startsWith("WF-PHASE-")) return "W1";
  if (code.startsWith("WF-LOAD-")) return "W1";
  if (code.startsWith("WF-SCHEMA-")) return "W1";
  if (code.startsWith("WF-RULE-")) return "W1";
  // Unknown WF-* — fall back to W1 (workflow-level integrity).
  return "W1";
}

/**
 * Decision-shaped sibling of {@link loadWorkflow}.
 *
 * The legacy `loadWorkflow` throws on the first cross-reference
 * failure (fail-fast at the loader). T1.4 wraps that throw into a
 * single-element `Decision` rejection so the validator chain can
 * combine it with other Decisions and report all failures at the
 * boundary. Each emitted `ValidationError` is tagged with its design
 * rule code (W1..W7) per {@link mapWorkflowErrorCodeToRule}.
 *
 * On Accept, the value is the loaded {@link WorkflowConfig} so callers
 * can chain into downstream validators that need the parsed config.
 *
 * @param cwd - Working directory containing the workflow file.
 * @param workflowPath - Optional override for the relative file path.
 */
export async function loadWorkflowAsDecision(
  cwd: string,
  workflowPath?: string,
): Promise<Decision<WorkflowConfig>> {
  try {
    const config = await loadWorkflow(cwd, workflowPath);
    return accept(config);
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      const code = mapWorkflowErrorCodeToRule(error.code);
      const ve: ValidationError = validationError(code, error.message, {
        source: error.configFile ?? "workflow.json",
        context: { configErrorCode: error.code },
      });
      return rejectDecision([ve]);
    }
    // Non-ConfigError (e.g., unexpected runtime failure) — surface as
    // a generic W1 rejection so the boundary still reports it via the
    // unified Decision shape rather than letting the throw escape.
    const message = error instanceof Error ? error.message : String(error);
    return rejectDecision([
      validationError("W1", message, { source: "workflow.json" }),
    ]);
  }
}
