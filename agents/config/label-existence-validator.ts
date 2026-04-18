/**
 * Label Existence Validator
 *
 * Verifies that every label referenced by an agent definition or workflow
 * configuration is present on the GitHub repository. Prevents runtime
 * failure where the orchestrator attempts to apply a label that does not
 * exist on the remote.
 *
 * The validator is a Conformance check: two peer configurations (declared
 * labels vs. labels actually present on the repository) must agree. The
 * fix direction is fixed — `gh label create <name>`. The config is the
 * declared intent; GitHub must match it.
 *
 * Responsibility: Cross-check declared labels against the repository's
 * label set (single network read via GitHubClient).
 * Side effects: One call to `client.listLabels()`.
 *
 * @module
 */

import type { AgentDefinition, ValidationResult } from "../src_common/types.ts";
import type { GitHubLabelsConfig } from "../src_common/types/agent-definition.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import type { WorkflowConfig } from "../orchestrator/workflow-types.ts";

// ---------------------------------------------------------------------------
// Message constants (exported for test assertions — single source of truth)
// ---------------------------------------------------------------------------

/** Prefix for label existence errors. */
export const MSG_LABEL = "[LABEL]";

/** Error fragment: declared label missing on GitHub. */
export const MSG_LABEL_MISSING =
  "is declared but does not exist on the repository";

/** Warning fragment: no labels declared anywhere. */
export const MSG_LABEL_EMPTY = "No labels declared to validate";

/** Warning fragment: GitHubClient unavailable / network failure. */
export const MSG_LABEL_CLIENT_UNAVAILABLE = "Label existence check skipped";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Extract every string label name from a {@link GitHubLabelsConfig} slot.
 *
 * Walks all enumerable keys. String values are collected directly. Object
 * values with shape `{ add?: string[], remove?: string[] }` contribute
 * every entry of both arrays. `undefined` and unrecognised shapes are
 * skipped silently (schema validation catches those upstream).
 *
 * Exported so tests can exercise the derivation rule in isolation.
 */
export function extractLabelsFromGitHubConfig(
  cfg: GitHubLabelsConfig | undefined,
): Set<string> {
  const out = new Set<string>();
  if (cfg === undefined) return out;
  for (const value of Object.values(cfg)) {
    if (typeof value === "string") {
      out.add(value);
      continue;
    }
    if (value !== undefined && typeof value === "object") {
      const obj = value as { add?: unknown; remove?: unknown };
      if (Array.isArray(obj.add)) {
        for (const v of obj.add) {
          if (typeof v === "string") out.add(v);
        }
      }
      if (Array.isArray(obj.remove)) {
        for (const v of obj.remove) {
          if (typeof v === "string") out.add(v);
        }
      }
    }
  }
  return out;
}

/** Apply workflow labelPrefix to a bare labelMapping key (mirrors label-resolver). */
function applyPrefix(bare: string, prefix: string | undefined): string {
  if (!prefix) return bare;
  return `${prefix}:${bare}`;
}

/** Declaration site annotation for diagnostic error messages. */
type DeclarationSite = "labelMapping" | "GitHubLabelsConfig";

/**
 * Build the merged declaration map:
 *   label name → set of sites that declared it
 *
 * Kept internal but returned from the validator to make the error shape
 * data-driven (no string-keyed site lookup in the message builder).
 */
function collectDeclarations(
  definition: AgentDefinition,
  workflowConfig: WorkflowConfig,
): Map<string, Set<DeclarationSite>> {
  const declarations = new Map<string, Set<DeclarationSite>>();

  const add = (label: string, site: DeclarationSite): void => {
    let sites = declarations.get(label);
    if (sites === undefined) {
      sites = new Set();
      declarations.set(label, sites);
    }
    sites.add(site);
  };

  const prefix = workflowConfig.labelPrefix;
  for (const bare of Object.keys(workflowConfig.labelMapping)) {
    add(applyPrefix(bare, prefix), "labelMapping");
  }

  const ghLabels = definition.runner.integrations?.github?.labels;
  for (const label of extractLabelsFromGitHubConfig(ghLabels)) {
    add(label, "GitHubLabelsConfig");
  }

  return declarations;
}

/** Join a declaration site set as a stable, human-readable list. */
function formatSites(sites: Set<DeclarationSite>): string {
  const ordered: DeclarationSite[] = [];
  if (sites.has("labelMapping")) ordered.push("labelMapping");
  if (sites.has("GitHubLabelsConfig")) ordered.push("GitHubLabelsConfig");
  return ordered.join(" + ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that every declared label exists on the GitHub repository.
 *
 * - declaredLabels = (labelMapping keys, with labelPrefix applied) ∪
 *                    (strings extracted from runner.integrations.github.labels)
 * - One call to `client.listLabels()` produces the repository peer set.
 * - Each declared label missing from the peer set produces one error.
 * - Empty declared set produces a single warning (non-vacuity guard).
 * - Client failures produce a single warning; `valid` stays true (skip
 *   semantics — validator is online-only by design).
 *
 * @param definition - Parsed agent definition
 * @param workflowConfig - Loaded workflow configuration
 * @param client - GitHub client abstraction; injected for testability
 * @returns Validation result (errors for missing labels, warnings for skips)
 */
export async function validateLabelExistence(
  definition: AgentDefinition,
  workflowConfig: WorkflowConfig,
  client: GitHubClient,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const declarations = collectDeclarations(definition, workflowConfig);

  if (declarations.size === 0) {
    return {
      valid: true,
      errors: [],
      warnings: [`${MSG_LABEL} ${MSG_LABEL_EMPTY}`],
    };
  }

  let existing: Set<string>;
  try {
    const labels = await client.listLabels();
    existing = new Set(labels);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      valid: true,
      errors: [],
      warnings: [
        `${MSG_LABEL} ${MSG_LABEL_CLIENT_UNAVAILABLE}: ${msg}`,
      ],
    };
  }

  for (const [label, sites] of declarations) {
    if (existing.has(label)) continue;
    const site = formatSites(sites);
    errors.push(
      `${MSG_LABEL} label '${label}' ${MSG_LABEL_MISSING} ` +
        `(declared in ${site}). ` +
        `How-to-fix: Run 'gh label create ${JSON.stringify(label)}'`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
