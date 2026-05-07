/**
 * Phase Transition Logic
 *
 * Computes target phases from agent outcomes, determines label
 * changes for GitHub issue updates, and renders handoff templates.
 */

import type {
  AgentDefinition,
  TransformerDefinition,
  WorkflowConfig,
} from "./workflow-types.ts";
import { stripPrefix } from "./label-resolver.ts";

/**
 * Determines the target phase based on agent role and outcome.
 *
 * - Transformer: "success" -> outputPhase, otherwise -> fallbackPhase
 * - Validator: outcome key in outputPhases -> mapped phase, otherwise -> fallbackPhase
 *
 * Throws if fallback is needed but no fallbackPhase is defined.
 */
export function computeTransition(
  agent: AgentDefinition,
  outcome: string,
): { targetPhase: string; isFallback: boolean } {
  if (agent.role === "transformer") {
    if (outcome === "success") {
      return { targetPhase: agent.outputPhase, isFallback: false };
    }
    // Look up outcome in fallbackPhases first, then fall back to fallbackPhase
    const typed = agent as TransformerDefinition;
    const mappedPhase = typed.fallbackPhases?.[outcome];
    if (mappedPhase !== undefined) {
      return { targetPhase: mappedPhase, isFallback: true };
    }
    if (agent.fallbackPhase === undefined) {
      throw new Error(
        `Transformer has no fallbackPhase defined for non-success outcome "${outcome}"`,
      );
    }
    return { targetPhase: agent.fallbackPhase, isFallback: true };
  }

  // validator
  if (outcome in agent.outputPhases) {
    return { targetPhase: agent.outputPhases[outcome], isFallback: false };
  }
  if (agent.fallbackPhase === undefined) {
    throw new Error(
      `Validator has no fallbackPhase defined for unknown outcome "${outcome}"`,
    );
  }
  return { targetPhase: agent.fallbackPhase, isFallback: true };
}

/**
 * Computes which labels to remove and add for a phase transition.
 *
 * - Removes all current labels that are workflow labels (keys in labelMapping).
 * - On terminal transitions, also removes prioritizer labels so seq capacity
 *   is released and closed issues do not carry stale ordering state.
 *   Non-terminal transitions (actionable / blocking) preserve prioritizer
 *   labels — a single subject traversing consider → detail → impl keeps
 *   one order slot per `.agent/workflow-issue-states.md §Order seq の消費と解放`.
 * - Adds the first label in labelMapping whose value equals targetPhase.
 */
export function computeLabelChanges(
  currentLabels: string[],
  targetPhase: string,
  config: WorkflowConfig,
): { labelsToRemove: string[]; labelsToAdd: string[] } {
  const prefix = config.labelPrefix;
  const stripSet = new Set(Object.keys(config.labelMapping));

  const isTerminal = config.phases[targetPhase]?.type === "terminal";
  if (isTerminal && config.prioritizer?.labels) {
    for (const label of config.prioritizer.labels) {
      stripSet.add(label);
    }
  }

  const labelsToRemove = currentLabels.filter((label) => {
    const bare = stripPrefix(label, prefix);
    return bare !== null && stripSet.has(bare);
  });

  // NOTE: Multiple labels may map to the same phase.
  // The first label (by labelMapping insertion order) is used.
  const labelsToAdd: string[] = [];
  for (const [label, phase] of Object.entries(config.labelMapping)) {
    if (phase === targetPhase) {
      labelsToAdd.push(prefix ? `${prefix}:${label}` : label);
      break;
    }
  }

  return { labelsToRemove, labelsToAdd };
}

/**
 * Returns the first prefix-applied GitHub label whose `labelMapping`
 * entry routes to `targetPhase`, or `null` if no entry maps there.
 *
 * Mirrors the add-side scan in {@link computeLabelChanges}: insertion
 * order of `labelMapping` is the tiebreaker, prefix is taken from
 * `config.labelPrefix`. Use this whenever code needs to refer to the
 * label that represents a workflow phase — never hardcode the bare
 * label name, since a workflow may carry a `labelPrefix` that turns
 * `done` into `docs:done`.
 */
export function resolvePhaseLabel(
  config: WorkflowConfig,
  targetPhase: string,
): string | null {
  const prefix = config.labelPrefix;
  for (const [label, phase] of Object.entries(config.labelMapping)) {
    if (phase === targetPhase) {
      return prefix ? `${prefix}:${label}` : label;
    }
  }
  return null;
}

/**
 * Returns true when any of `labels` carries a workflow label that
 * routes to `targetPhase` via `labelMapping`.
 *
 * Strips `config.labelPrefix` before consulting `labelMapping`, so a
 * workflow with `labelPrefix: "docs"` correctly recognises both
 * `docs:done` and a bare `done` for the same phase semantics. Labels
 * outside the prefix namespace are ignored.
 */
export function hasPhaseLabel(
  labels: readonly string[],
  config: WorkflowConfig,
  targetPhase: string,
): boolean {
  const prefix = config.labelPrefix;
  for (const label of labels) {
    const bare = stripPrefix(label, prefix);
    if (bare === null) continue;
    if (config.labelMapping[bare] === targetPhase) return true;
  }
  return false;
}

/**
 * Replaces `{variable}` placeholders in a template string.
 *
 * Variables not present in the record are left as-is.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (key in variables) {
      return variables[key];
    }
    return match;
  });
}
