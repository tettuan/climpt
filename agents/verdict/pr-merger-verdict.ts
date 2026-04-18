/**
 * PR Merger Verdict type definitions.
 *
 * Authoritative source: docs/internal/pr-merger-design/03-data-flow.md § 2
 * (JSON Schema verdict-1.0.0) and
 * tmp/pr-merger-impl/investigation/design-requirements.md § 5.6.
 *
 * This type represents the verdict JSON written by reviewer-agent to
 * `tmp/climpt/orchestrator/emits/<pr-number>.json` and consumed by the deterministic
 * merger-cli (`agents/scripts/merge-pr.ts`) and the pure `canMerge()`
 * gate evaluator (`agents/scripts/lib/can-merge.ts`).
 *
 * Contract guarantees:
 * - schema_version major version MUST be 1 (checked by canMerge step 0)
 * - verdict="approved" MUST be accompanied by merge_method (JSON Schema allOf)
 * - additionalProperties is false at the JSON Schema layer; the TypeScript
 *   interface declares the full authoritative field set
 *
 * This module contains zero runtime dependencies (pure types + guards) so it
 * can be imported from any layer (merger-cli, canMerge, tests).
 */

/**
 * Current verdict schema version (semver).
 *
 * canMerge() enforces major-version match (1.x.x). Bumping to 2.x.x constitutes
 * a breaking change and MUST be coordinated across reviewer-agent and merger-cli.
 */
export const VERDICT_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Merge method (passed to `gh pr merge --<method>`).
 *
 * Only meaningful when `verdict === "approved"`; ignored for rejected verdicts.
 */
export type MergeMethod = "squash" | "merge" | "rebase";

/**
 * Reviewer-agent final judgment.
 */
export type VerdictDecision = "approved" | "rejected";

/**
 * PR Merger verdict record.
 *
 * Field-level semantics mirror the JSON Schema in 03-data-flow.md § 2.
 */
export interface Verdict {
  /** Schema semver. Major must match `VERDICT_SCHEMA_VERSION`. */
  "schema_version": string;
  /** GitHub PR number (>= 1). */
  "pr_number": number;
  /** Base branch at evaluation time. Must equal prData.baseRefName. */
  "base_branch": string;
  /** Reviewer final decision. */
  "verdict": VerdictDecision;
  /** Merge method. Required when `verdict === "approved"`. */
  "merge_method"?: MergeMethod;
  /** Delete head branch after merge. Defaults to `true` at JSON Schema layer. */
  "delete_branch"?: boolean;
  /** Human-readable reviewer summary (1..4000 chars). */
  "reviewer_summary": string;
  /** ISO 8601 UTC timestamp of evaluation. */
  "evaluated_at": string;
  /** reviewer-agent semver at evaluation time. */
  "reviewer_agent_version": string;
  /** If `false`, CI incompleteness does not block merge (emergency escape). */
  "ci_required"?: boolean;
}

/**
 * Type guard for the `Verdict` shape.
 *
 * This is a shallow structural check — it validates presence and primitive
 * types of the required fields and the enum-like string fields. Deep
 * constraints (schema_version major=1, approved ⇒ merge_method, date-time
 * format, length bounds) are enforced by `canMerge()` and by JSON Schema
 * validation in merger-cli, not by this guard.
 *
 * @param value - candidate parsed JSON
 * @returns true iff `value` conforms to the `Verdict` structural contract
 */
export function isVerdict(value: unknown): value is Verdict {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;

  if (typeof v.schema_version !== "string") return false;
  if (typeof v.pr_number !== "number" || !Number.isInteger(v.pr_number)) {
    return false;
  }
  if (typeof v.base_branch !== "string") return false;
  if (v.verdict !== "approved" && v.verdict !== "rejected") return false;
  if (typeof v.reviewer_summary !== "string") return false;
  if (typeof v.evaluated_at !== "string") return false;
  if (typeof v.reviewer_agent_version !== "string") return false;

  if (v.merge_method !== undefined) {
    if (
      v.merge_method !== "squash" &&
      v.merge_method !== "merge" &&
      v.merge_method !== "rebase"
    ) {
      return false;
    }
  }
  if (v.delete_branch !== undefined && typeof v.delete_branch !== "boolean") {
    return false;
  }
  if (v.ci_required !== undefined && typeof v.ci_required !== "boolean") {
    return false;
  }

  // approved verdicts must carry a merge_method (JSON Schema allOf).
  if (v.verdict === "approved" && v.merge_method === undefined) {
    return false;
  }

  return true;
}
