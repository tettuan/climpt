/**
 * Label Resolver
 *
 * Resolves GitHub issue labels to workflow phases and agents.
 * Maps labels to phases via labelMapping, then selects the
 * highest-urgency (lowest priority number) actionable phase.
 */

import type {
  AgentDefinition,
  PhaseDefinition,
  WorkflowConfig,
} from "./workflow-types.ts";

/**
 * Resolves a set of GitHub labels to the highest-priority actionable phase.
 *
 * - Unknown labels (not in config.labelMapping) are ignored.
 * - Terminal and blocking phases are excluded.
 * - When multiple actionable phases match, the one with the lowest
 *   priority number (highest urgency) is selected.
 *
 * @returns The resolved phase, or null if no actionable phase matches.
 */
export function resolvePhase(
  labels: string[],
  config: WorkflowConfig,
): { phaseId: string; phase: PhaseDefinition } | null {
  const prefix = config.labelPrefix;
  let best: { phaseId: string; phase: PhaseDefinition } | null = null;

  for (const label of labels) {
    const bare = stripPrefix(label, prefix);
    if (bare === null) continue;

    const phaseId = config.labelMapping[bare];
    if (phaseId === undefined) continue;

    const phase = config.phases[phaseId];
    if (phase === undefined) continue;

    if (phase.type !== "actionable") continue;

    const currentPriority = phase.priority ?? Infinity;
    const bestPriority = best?.phase.priority ?? Infinity;
    if (
      best === null ||
      currentPriority < bestPriority ||
      (currentPriority === bestPriority && phaseId < best.phaseId)
    ) {
      best = { phaseId, phase };
    }
  }

  return best;
}

/**
 * Strips prefix from a GitHub label to produce a bare label.
 *
 * - If prefix is set, only labels starting with "{prefix}:" are accepted;
 *   the prefix and colon are stripped. Non-matching labels return null.
 * - If prefix is not set, the label is returned as-is.
 */
export function stripPrefix(
  label: string,
  prefix: string | undefined,
): string | null {
  if (!prefix) return label;
  const marker = prefix + ":";
  if (label.startsWith(marker)) {
    return label.slice(marker.length);
  }
  return null;
}

/**
 * Resolves a phase ID to the agent that should be dispatched.
 *
 * @returns The resolved agent, or null if the phase is not actionable
 *          or has no agent defined.
 */
export function resolveAgent(
  phaseId: string,
  config: WorkflowConfig,
): { agentId: string; agent: AgentDefinition } | null {
  const phase = config.phases[phaseId];
  if (phase === undefined) return null;

  if (phase.type !== "actionable") return null;

  const agentId = phase.agent;
  if (agentId === undefined || agentId === null) return null;

  const agent = config.agents[agentId];
  if (agent === undefined) return null;

  return { agentId, agent };
}
