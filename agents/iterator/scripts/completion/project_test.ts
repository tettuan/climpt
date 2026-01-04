/**
 * ProjectCompletionHandler Tests
 *
 * Tests for the ProjectCompletionHandler class:
 * - Phase state machine transitions
 * - Plan and review result management
 * - Completion criteria building
 *
 * Note: Tests that require GitHub API calls are integration tests
 * and should be run separately with proper mocking.
 */

import { assertEquals, assertExists } from "@std/assert";

import { ProjectCompletionHandler } from "./project.ts";

// =============================================================================
// Phase State Machine Tests
// =============================================================================

Deno.test("ProjectCompletionHandler - initial phase is preparation", () => {
  const handler = new ProjectCompletionHandler(1);

  assertEquals(handler.getPhase(), "preparation");
});

Deno.test("ProjectCompletionHandler - advancePhase: preparation -> processing", () => {
  const handler = new ProjectCompletionHandler(1);

  assertEquals(handler.getPhase(), "preparation");
  handler.advancePhase();
  assertEquals(handler.getPhase(), "processing");
});

Deno.test("ProjectCompletionHandler - advancePhase: processing -> review", () => {
  const handler = new ProjectCompletionHandler(1);

  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review
  assertEquals(handler.getPhase(), "review");
});

Deno.test("ProjectCompletionHandler - advancePhase: review -> again (when no review result)", () => {
  const handler = new ProjectCompletionHandler(1);

  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review
  handler.advancePhase(); // review -> again (no result set, defaults to fail)
  assertEquals(handler.getPhase(), "again");
});

Deno.test("ProjectCompletionHandler - advancePhase: review -> complete (when review passes)", () => {
  const handler = new ProjectCompletionHandler(1);

  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review

  // Set passing review result
  handler.setReviewResult({ result: "pass", summary: "All good" });

  handler.advancePhase(); // review -> complete
  assertEquals(handler.getPhase(), "complete");
});

Deno.test("ProjectCompletionHandler - advancePhase: review -> again (when review fails)", () => {
  const handler = new ProjectCompletionHandler(1);

  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review

  // Set failing review result
  handler.setReviewResult({
    result: "fail",
    summary: "Issues found",
    issues: [{ number: 1, reason: "Not complete" }],
  });

  handler.advancePhase(); // review -> again
  assertEquals(handler.getPhase(), "again");
});

Deno.test("ProjectCompletionHandler - advancePhase: again -> review", () => {
  const handler = new ProjectCompletionHandler(1);

  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review
  handler.advancePhase(); // review -> again
  handler.advancePhase(); // again -> review
  assertEquals(handler.getPhase(), "review");
});

Deno.test("ProjectCompletionHandler - advancePhase: complete stays complete", () => {
  const handler = new ProjectCompletionHandler(1);

  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review
  handler.setReviewResult({ result: "pass", summary: "Done" });
  handler.advancePhase(); // review -> complete

  // Try to advance past complete
  handler.advancePhase();
  assertEquals(handler.getPhase(), "complete");
});

// =============================================================================
// Plan and Review Result Management Tests
// =============================================================================

Deno.test("ProjectCompletionHandler - setProjectPlan and getProjectPlan", () => {
  const handler = new ProjectCompletionHandler(1);

  assertEquals(handler.getProjectPlan(), null);

  const plan = {
    totalIssues: 3,
    estimatedComplexity: "medium" as const,
    skillsNeeded: ["skill1", "skill2"],
    skillsToDisable: [],
    executionOrder: [
      { issue: 1, reason: "First issue" },
      { issue: 2, reason: "Second issue" },
      { issue: 3, reason: "Third issue" },
    ],
    notes: "Test plan notes",
  };
  handler.setProjectPlan(plan);

  assertEquals(handler.getProjectPlan(), plan);
});

Deno.test("ProjectCompletionHandler - setReviewResult and getReviewResult", () => {
  const handler = new ProjectCompletionHandler(1);

  assertEquals(handler.getReviewResult(), null);

  const result = {
    result: "fail" as const,
    summary: "Found issues",
    issues: [{ number: 123, reason: "Not implemented" }],
  };
  handler.setReviewResult(result);

  assertEquals(handler.getReviewResult(), result);
});

// =============================================================================
// Completion Criteria Tests
// =============================================================================

Deno.test("ProjectCompletionHandler - buildCompletionCriteria without label filter", () => {
  const handler = new ProjectCompletionHandler(42);

  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.criteria, "completing all open issues in Project #42");
  assertExists(criteria.detail);
  assertEquals(criteria.detail.includes("Project #42"), true);
});

Deno.test("ProjectCompletionHandler - buildCompletionCriteria with label filter", () => {
  const handler = new ProjectCompletionHandler(42, "docs");

  const criteria = handler.buildCompletionCriteria();

  assertEquals(
    criteria.criteria,
    'completing all open issues with "docs" label in Project #42',
  );
  assertExists(criteria.detail);
  assertEquals(criteria.detail.includes("docs"), true);
});

// =============================================================================
// Initial State Tests
// =============================================================================

Deno.test("ProjectCompletionHandler - getCompletedCount returns 0 initially", () => {
  const handler = new ProjectCompletionHandler(1);

  assertEquals(handler.getCompletedCount(), 0);
});

Deno.test("ProjectCompletionHandler - getCurrentIssueNumber returns null before initialization", () => {
  const handler = new ProjectCompletionHandler(1);

  // Before initialize() is called, there's no current issue
  assertEquals(handler.getCurrentIssueNumber(), null);
});

Deno.test("ProjectCompletionHandler - getCurrentIssueHandler returns null before initialization", () => {
  const handler = new ProjectCompletionHandler(1);

  assertEquals(handler.getCurrentIssueHandler(), null);
});

// =============================================================================
// Type Property Tests
// =============================================================================

Deno.test("ProjectCompletionHandler - type is 'project'", () => {
  const handler = new ProjectCompletionHandler(1);

  assertEquals(handler.type, "project");
});

// =============================================================================
// Full Phase Cycle Test
// =============================================================================

Deno.test("ProjectCompletionHandler - full phase cycle with pass", () => {
  const handler = new ProjectCompletionHandler(5, "feature");

  // Initial state
  assertEquals(handler.getPhase(), "preparation");

  // Preparation -> Processing
  handler.advancePhase();
  assertEquals(handler.getPhase(), "processing");

  // Processing -> Review
  handler.advancePhase();
  assertEquals(handler.getPhase(), "review");

  // Review -> Complete (pass)
  handler.setReviewResult({ result: "pass", summary: "All issues resolved" });
  handler.advancePhase();
  assertEquals(handler.getPhase(), "complete");
});

Deno.test("ProjectCompletionHandler - full phase cycle with fail and retry", () => {
  const handler = new ProjectCompletionHandler(5);

  handler.advancePhase(); // -> processing
  handler.advancePhase(); // -> review

  // First review fails
  handler.setReviewResult({
    result: "fail",
    summary: "Issues remain",
    issues: [{ number: 10, reason: "Not done" }],
  });
  handler.advancePhase(); // -> again
  assertEquals(handler.getPhase(), "again");

  // Re-execute and go back to review
  handler.advancePhase(); // -> review
  assertEquals(handler.getPhase(), "review");

  // Second review passes
  handler.setReviewResult({ result: "pass", summary: "Fixed" });
  handler.advancePhase(); // -> complete
  assertEquals(handler.getPhase(), "complete");
});
