/**
 * Agent Coordination Configuration Loader
 *
 * Loads and manages coordination configuration for agent communication.
 * Provides utilities for label management, handoff comments, and correlation IDs.
 */

import type { CoordinationConfig, LabelConfig } from "./coordination-types.ts";
import COORDINATION_CONFIG from "./coordination-config.json" with {
  type: "json",
};

/**
 * Default coordination configuration
 * Used as fallback when config file is missing or incomplete
 */
const DEFAULT_COORDINATION: CoordinationConfig = {
  version: "1.0.0",
  labels: {
    requirements: "docs",
    review: "review",
    gap: "implementation-gap",
    fromReviewer: "from-reviewer",
    feedback: "need clearance",
  },
  handoff: {
    iteratorToReviewer: {
      trigger: "internal-review-pass",
      action: "add-review-label",
      commentTemplate: "[Agent Handoff] Ready for review",
    },
    reviewerToIterator: {
      trigger: "gaps-found",
      action: "create-gap-issues",
      issueTemplate: {
        titlePrefix: "[Gap]",
        labels: ["implementation-gap", "from-reviewer"],
        bodyTemplate: "## Gap Summary\n{summary}",
      },
    },
    reviewerComplete: {
      trigger: "no-gaps",
      action: "close-review-issue",
      commentTemplate: "[Agent Review Complete]",
    },
  },
  retry: {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
  },
  orchestration: {
    maxCycles: 5,
    cycleDelayMs: 5000,
    autoTrigger: false,
  },
  logging: {
    correlationIdFormat: "coord-{timestamp}-{agent}",
    retainDays: 30,
  },
  traceability: {
    idFormat: "req:{category}:{name}#{date}",
    requireInGapIssues: true,
  },
};

/**
 * Deep merge two objects
 *
 * @param target - Base object
 * @param source - Object to merge into target
 * @returns Merged object
 */
// deno-lint-ignore no-explicit-any
function deepMerge(target: any, source: any): any {
  if (!source) return target;

  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Load coordination configuration
 *
 * Merges default config with bundled config and optional overrides.
 * Priority: overrides > bundled config > defaults
 *
 * @param overrides - Local override settings
 * @returns Merged coordination configuration
 */
export function loadCoordinationConfig(
  overrides?: Partial<CoordinationConfig>,
): CoordinationConfig {
  const bundled = COORDINATION_CONFIG as unknown as CoordinationConfig;

  return deepMerge(deepMerge(DEFAULT_COORDINATION, bundled), overrides ?? {});
}

/**
 * Get label name by key
 *
 * @param config - Coordination configuration
 * @param key - Label key
 * @returns Label name string
 */
export function getLabel(
  config: CoordinationConfig,
  key: keyof LabelConfig,
): string {
  return config.labels[key];
}

/**
 * Render handoff comment from template
 *
 * Replaces {variable} placeholders with provided values.
 *
 * @param template - Comment template string
 * @param variables - Key-value pairs for replacement
 * @returns Rendered comment string
 */
export function renderHandoffComment(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

/**
 * Generate correlation ID for logging
 *
 * Creates a unique ID based on the config format, timestamp, and agent name.
 *
 * @param config - Coordination configuration
 * @param agent - Agent identifier ("iterator" or "reviewer")
 * @returns Correlation ID string
 */
export function generateCorrelationId(
  config: CoordinationConfig,
  agent: "iterator" | "reviewer",
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return config.logging.correlationIdFormat
    .replace("{timestamp}", timestamp)
    .replace("{agent}", agent);
}
