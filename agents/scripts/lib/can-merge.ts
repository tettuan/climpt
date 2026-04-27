/**
 * Pure gate evaluator for the PR merger CLI.
 *
 * Spec (source of truth):
 *   - docs/internal/pr-merger-design/03-data-flow.md § 3.B
 *   - tmp/pr-merger-impl/investigation/design-requirements.md § 5.2, 5.5
 *
 * This module intentionally has **no** I/O: no file access, no subprocess,
 * no network. Its inputs are already-materialised `PrData` (from `gh pr view`)
 * and a validated `Verdict` object. The caller (`merge-pr.ts` wrapper) is
 * responsible for acquiring those inputs and mapping the returned reason to
 * a canonical outcome + label mutation + exit code.
 *
 * Evaluation order is fixed: the first failing gate short-circuits. The order
 * encodes the "fail fastest on the most broken state" principle described in
 * 03-data-flow.md.
 *
 * @module
 */

// -----------------------------------------------------------------------------
// Result helper (local; not re-exported project-wide to keep the surface small)
// -----------------------------------------------------------------------------

export type Result<T, E> = { ok: true; value?: T } | { ok: false; error: E };

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

/**
 * PR state obtained from `gh pr view <n> --json mergeable,reviewDecision,
 * statusCheckRollup,baseRefName,headRefName`.
 *
 * Nullable fields reflect GitHub's async evaluation (e.g. `mergeable=null`
 * while the merge-commit probe is in flight).
 */
export interface PrData {
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  reviewDecision:
    | "APPROVED"
    | "REVIEW_REQUIRED"
    | "CHANGES_REQUESTED"
    | null;
  statusCheckRollup: Array<{
    status: "QUEUED" | "IN_PROGRESS" | "PENDING" | "COMPLETED";
    conclusion:
      | "SUCCESS"
      | "FAILURE"
      | "NEUTRAL"
      | "SKIPPED"
      | "CANCELLED"
      | "TIMED_OUT"
      | null;
  }>;
  baseRefName: string;
  headRefName: string;
  /**
   * PR body (markdown). Used by the merge-pr wrapper to extract
   * `Closes #N` references after a successful merge so the parent's
   * MergeCloseAdapter can publish `IssueClosedEvent(M)` for the
   * server-auto-closed issue (PR4-4 T4.5, design 44 §B
   * `Skip_NoClosesInBody`). Optional because pre-PR4-4 callers and
   * test fixtures may omit it; the merge gates do not depend on it.
   */
  body?: string;
}

// Verdict type is authored in agents/verdict/pr-merger-verdict.ts.
// We import once for local use and re-export so that direct callers of
// can-merge.ts (tests, merger-cli) continue to see `Verdict` without having
// to reach into the verdict layer. This keeps the source of truth single.
import type { Verdict } from "../../verdict/pr-merger-verdict.ts";
export type { Verdict } from "../../verdict/pr-merger-verdict.ts";

// -----------------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------------

/**
 * Reasons produced by the pure evaluator.
 *
 * Not included here: `verdict-missing`, `pr-number-mismatch`. Those are
 * wrapper-layer concerns (03-data-flow.md § 3 "責務分担"); exposing them in
 * the pure gate would invert the layering.
 */
export type CanMergeReason =
  | "schema-mismatch"
  | "rejected-by-reviewer"
  | "unknown-mergeable"
  | "conflicts"
  | "approvals-missing"
  | "ci-pending"
  | "ci-failed"
  | "base-branch-mismatch";

// -----------------------------------------------------------------------------
// Evaluator
// -----------------------------------------------------------------------------

const SUPPORTED_SCHEMA_MAJOR = 1;

/**
 * Extracts the semver major component of `schema_version`.
 *
 * Returns `null` when the string is not a well-formed `MAJOR.MINOR.PATCH`
 * sequence of non-negative integers. This is intentionally strict: any
 * ambiguity maps to `schema-mismatch`.
 */
function schemaMajor(raw: string): number | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(raw);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isFinite(major) ? major : null;
}

/**
 * Evaluates the merger gates in fixed order. On the first failure, returns
 * `{ ok: false, error: <reason> }`. When every gate passes, returns
 * `{ ok: true }`.
 *
 * The evaluation order is normative (03-data-flow.md § 3.B):
 *   0. schema_version major === 1
 *   1. verdict.verdict === "approved"
 *   2. prData.mergeable === "MERGEABLE"
 *   3. prData.reviewDecision === "APPROVED"
 *   4. CI rollup (skipped iff verdict.ci_required === false)
 *   5. verdict.base_branch === prData.baseRefName
 */
export function canMerge(
  prData: PrData,
  verdict: Verdict,
): Result<void, CanMergeReason> {
  // Step 0: schema safety guard. The wrapper performs full JSON Schema
  // validation; this re-check exists for direct callers (tests, alternate
  // pipelines) that bypass the wrapper.
  const major = schemaMajor(verdict.schema_version);
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    return { ok: false, error: "schema-mismatch" };
  }

  // Step 1: reviewer explicit verdict.
  if (verdict.verdict !== "approved") {
    return { ok: false, error: "rejected-by-reviewer" };
  }

  // Step 2: GitHub mergeable tri-state.
  switch (prData.mergeable) {
    case "MERGEABLE":
      break;
    case "CONFLICTING":
      return { ok: false, error: "conflicts" };
    case "UNKNOWN":
    case null:
      return { ok: false, error: "unknown-mergeable" };
  }

  // Step 3: GitHub review decision.
  if (prData.reviewDecision !== "APPROVED") {
    return { ok: false, error: "approvals-missing" };
  }

  // Step 4: CI rollup (optional).
  // Default for `ci_required` is true (03-data-flow.md § 2 schema default).
  const ciRequired = verdict.ci_required !== false;
  if (ciRequired) {
    // First pass: any hard failure short-circuits as `ci-failed`.
    // This ordering is normative — failures outrank pending.
    for (const check of prData.statusCheckRollup) {
      if (
        check.conclusion === "FAILURE" ||
        check.conclusion === "CANCELLED" ||
        check.conclusion === "TIMED_OUT"
      ) {
        return { ok: false, error: "ci-failed" };
      }
    }
    // Second pass: any still-running check surfaces as `ci-pending`.
    for (const check of prData.statusCheckRollup) {
      if (
        check.status === "QUEUED" ||
        check.status === "IN_PROGRESS" ||
        check.status === "PENDING"
      ) {
        return { ok: false, error: "ci-pending" };
      }
    }
    // SUCCESS / SKIPPED / NEUTRAL / null-with-COMPLETED are treated as
    // passing (03-data-flow.md § 3 step 4).
  }

  // Step 5: base branch match. Runs even when CI is skipped.
  if (verdict.base_branch !== prData.baseRefName) {
    return { ok: false, error: "base-branch-mismatch" };
  }

  return { ok: true };
}
