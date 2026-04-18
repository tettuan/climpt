/**
 * Unit tests for the pure `canMerge` gate evaluator.
 *
 * Design source of truth:
 *   - docs/internal/pr-merger-design/03-data-flow.md § 3.B
 *     (evaluation steps 0..6, in order)
 *   - tmp/pr-merger-impl/investigation/design-requirements.md § 5.2, 5.5
 *
 * Tests are written in English per project convention (feedback_test_language.md).
 * Expected values are derived from the reason literals declared in the design
 * document, not invented here (feedback test-design rule).
 */

import { assertEquals } from "@std/assert";
import { canMerge, type PrData, type Verdict } from "./can-merge.ts";

/**
 * Factory helpers.
 *
 * These return a fully valid baseline that passes every gate. Individual tests
 * perturb a single field so the assertion failure points directly at the gate
 * under test (diagnosability principle).
 */
function validPrData(overrides: Partial<PrData> = {}): PrData {
  return {
    mergeable: "MERGEABLE",
    reviewDecision: "APPROVED",
    statusCheckRollup: [
      { status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    baseRefName: "develop",
    headRefName: "feature/x",
    ...overrides,
  };
}

function validVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    schema_version: "1.0.0",
    pr_number: 123,
    base_branch: "develop",
    verdict: "approved",
    merge_method: "squash",
    delete_branch: true,
    reviewer_summary: "All acceptance criteria met.",
    evaluated_at: "2026-04-13T00:00:00Z",
    reviewer_agent_version: "1.13.26",
    ci_required: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

Deno.test("canMerge returns Ok when all gates pass", () => {
  const result = canMerge(validPrData(), validVerdict());
  assertEquals(result.ok, true);
});

// ---------------------------------------------------------------------------
// Step 0: schema_version major must be 1
// ---------------------------------------------------------------------------

Deno.test("canMerge rejects schema_version with non-1 major (2.0.0)", () => {
  const result = canMerge(
    validPrData(),
    validVerdict({ schema_version: "2.0.0" }),
  );
  assertEquals(result, { ok: false, error: "schema-mismatch" });
});

Deno.test("canMerge rejects schema_version with non-1 major (0.9.0)", () => {
  const result = canMerge(
    validPrData(),
    validVerdict({ schema_version: "0.9.0" }),
  );
  assertEquals(result, { ok: false, error: "schema-mismatch" });
});

Deno.test("canMerge rejects malformed schema_version string", () => {
  const result = canMerge(
    validPrData(),
    validVerdict({ schema_version: "not-a-version" }),
  );
  assertEquals(result, { ok: false, error: "schema-mismatch" });
});

Deno.test("canMerge accepts schema_version with minor/patch bumps within major 1", () => {
  const result = canMerge(
    validPrData(),
    validVerdict({ schema_version: "1.3.7" }),
  );
  assertEquals(result.ok, true);
});

// ---------------------------------------------------------------------------
// Step 1: verdict.verdict === "approved"
// ---------------------------------------------------------------------------

Deno.test("canMerge rejects when reviewer verdict is 'rejected'", () => {
  const result = canMerge(
    validPrData(),
    validVerdict({ verdict: "rejected" }),
  );
  assertEquals(result, { ok: false, error: "rejected-by-reviewer" });
});

// ---------------------------------------------------------------------------
// Step 2: mergeable gate
// ---------------------------------------------------------------------------

Deno.test("canMerge returns 'conflicts' when mergeable is CONFLICTING", () => {
  const result = canMerge(
    validPrData({ mergeable: "CONFLICTING" }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "conflicts" });
});

Deno.test("canMerge returns 'unknown-mergeable' when mergeable is UNKNOWN", () => {
  const result = canMerge(
    validPrData({ mergeable: "UNKNOWN" }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "unknown-mergeable" });
});

Deno.test("canMerge returns 'unknown-mergeable' when mergeable is null", () => {
  const result = canMerge(
    validPrData({ mergeable: null }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "unknown-mergeable" });
});

// ---------------------------------------------------------------------------
// Step 3: reviewDecision gate
// ---------------------------------------------------------------------------

Deno.test("canMerge returns 'approvals-missing' when reviewDecision is REVIEW_REQUIRED", () => {
  const result = canMerge(
    validPrData({ reviewDecision: "REVIEW_REQUIRED" }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "approvals-missing" });
});

Deno.test("canMerge returns 'approvals-missing' when reviewDecision is CHANGES_REQUESTED", () => {
  const result = canMerge(
    validPrData({ reviewDecision: "CHANGES_REQUESTED" }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "approvals-missing" });
});

Deno.test("canMerge returns 'approvals-missing' when reviewDecision is null", () => {
  const result = canMerge(
    validPrData({ reviewDecision: null }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "approvals-missing" });
});

// ---------------------------------------------------------------------------
// Step 4: CI gate (verdict.ci_required = true)
// ---------------------------------------------------------------------------

Deno.test("canMerge returns 'ci-failed' when any check has conclusion FAILURE", () => {
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ],
    }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "ci-failed" });
});

Deno.test("canMerge returns 'ci-failed' when any check has conclusion CANCELLED", () => {
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "CANCELLED" },
      ],
    }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "ci-failed" });
});

Deno.test("canMerge returns 'ci-failed' when any check has conclusion TIMED_OUT", () => {
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "TIMED_OUT" },
      ],
    }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "ci-failed" });
});

Deno.test("canMerge returns 'ci-pending' when any check has status PENDING (no failures)", () => {
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "PENDING", conclusion: null },
      ],
    }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "ci-pending" });
});

Deno.test("canMerge returns 'ci-pending' when any check has status IN_PROGRESS", () => {
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "IN_PROGRESS", conclusion: null },
      ],
    }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "ci-pending" });
});

Deno.test("canMerge returns 'ci-pending' when any check has status QUEUED", () => {
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "QUEUED", conclusion: null },
      ],
    }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "ci-pending" });
});

Deno.test("canMerge prefers 'ci-failed' over 'ci-pending' when both present", () => {
  // Evaluation order: failures are checked before pending (design 03, step 4).
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "PENDING", conclusion: null },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ],
    }),
    validVerdict(),
  );
  assertEquals(result, { ok: false, error: "ci-failed" });
});

Deno.test("canMerge treats empty statusCheckRollup as passing", () => {
  const result = canMerge(
    validPrData({ statusCheckRollup: [] }),
    validVerdict(),
  );
  assertEquals(result.ok, true);
});

Deno.test("canMerge treats SKIPPED-only checks as passing", () => {
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "SKIPPED" },
        { status: "COMPLETED", conclusion: "NEUTRAL" },
      ],
    }),
    validVerdict(),
  );
  assertEquals(result.ok, true);
});

// ---------------------------------------------------------------------------
// Step 4 bypass: verdict.ci_required === false
// ---------------------------------------------------------------------------

Deno.test("canMerge skips CI evaluation when verdict.ci_required is false", () => {
  const result = canMerge(
    validPrData({
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "FAILURE" },
      ],
    }),
    validVerdict({ ci_required: false }),
  );
  assertEquals(result.ok, true);
});

Deno.test("canMerge still checks base_branch when verdict.ci_required is false", () => {
  // CI bypass does not suppress step 5 (base branch mismatch).
  const result = canMerge(
    validPrData({
      baseRefName: "main",
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "FAILURE" },
      ],
    }),
    validVerdict({ ci_required: false, base_branch: "develop" }),
  );
  assertEquals(result, { ok: false, error: "base-branch-mismatch" });
});

// ---------------------------------------------------------------------------
// Step 5: base_branch mismatch
// ---------------------------------------------------------------------------

Deno.test("canMerge returns 'base-branch-mismatch' when base branches differ", () => {
  const result = canMerge(
    validPrData({ baseRefName: "main" }),
    validVerdict({ base_branch: "develop" }),
  );
  assertEquals(result, { ok: false, error: "base-branch-mismatch" });
});
