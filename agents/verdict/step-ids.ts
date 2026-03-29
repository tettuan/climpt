/**
 * Step ID resolution for verdict handlers.
 *
 * Derives initial and continuation step IDs from the registry's
 * entryStepMapping, with fallback to default naming conventions.
 */

import type { VerdictStepIds } from "./types.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";

/**
 * Resolve step IDs from registry's entryStepMapping.
 *
 * Derives continuation step ID by replacing "initial." prefix
 * with "continuation." in the entry step ID.
 *
 * @param registry - Steps registry with entryStepMapping
 * @param verdictType - Verdict type key for entryStepMapping lookup
 * @param defaultInitial - Fallback initial step ID if not in mapping
 * @returns Resolved initial and continuation step IDs
 */
export function resolveStepIds(
  registry: ExtendedStepsRegistry,
  verdictType: string,
  defaultInitial: string,
): VerdictStepIds {
  const entryStep = registry.entryStepMapping?.[verdictType];
  if (entryStep) {
    const continuation = entryStep.startsWith("initial.")
      ? "continuation." + entryStep.slice("initial.".length)
      : "continuation." + entryStep.split(".").slice(1).join(".");
    return { initial: entryStep, continuation };
  }
  const defaultContinuation = defaultInitial.startsWith("initial.")
    ? "continuation." + defaultInitial.slice("initial.".length)
    : defaultInitial;
  return { initial: defaultInitial, continuation: defaultContinuation };
}

/**
 * Default initial step IDs for each verdict type.
 *
 * Used when the registry's entryStepMapping does not specify
 * an entry step for the given verdict type.
 */
export const DEFAULT_INITIAL_STEP_MAP: Record<string, string> = {
  "poll:state": "initial.polling",
  "count:iteration": "initial.iteration",
  "detect:keyword": "initial.keyword",
  "count:check": "initial.check",
  "detect:structured": "initial.structured",
};
