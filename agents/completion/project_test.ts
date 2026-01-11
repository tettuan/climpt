/**
 * Project Completion Handler Tests
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  ProjectCompletionHandler,
  type ProjectPlan,
  type ReviewResult,
} from "./project.ts";

// ============================================================
// Phase Tests
// ============================================================

Deno.test("ProjectCompletionHandler - initial phase is preparation", () => {
  const handler = new ProjectCompletionHandler(1);
  assertEquals(handler.getPhase(), "preparation");
});

Deno.test("ProjectCompletionHandler - advances from preparation to processing", () => {
  const handler = new ProjectCompletionHandler(1);
  handler.advancePhase();
  assertEquals(handler.getPhase(), "processing");
});

Deno.test("ProjectCompletionHandler - advances from processing to review", () => {
  const handler = new ProjectCompletionHandler(1);
  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review
  assertEquals(handler.getPhase(), "review");
});

Deno.test("ProjectCompletionHandler - advances from review to complete when reviewResult is pass", () => {
  const handler = new ProjectCompletionHandler(1);
  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review

  // Set review result to pass
  handler.setReviewResult({ result: "pass", summary: "All issues completed" });

  handler.advancePhase(); // review -> complete
  assertEquals(handler.getPhase(), "complete");
});

Deno.test("ProjectCompletionHandler - advances from review to again when reviewResult is fail", () => {
  const handler = new ProjectCompletionHandler(1);
  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review

  // Set review result to fail
  handler.setReviewResult({
    result: "fail",
    summary: "Some issues need attention",
    issues: [{ number: 1, reason: "Not done" }],
  });

  handler.advancePhase(); // review -> again
  assertEquals(handler.getPhase(), "again");
});

Deno.test("ProjectCompletionHandler - advances from again to review", () => {
  const handler = new ProjectCompletionHandler(1);
  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review

  // Set review result to fail to go to again
  handler.setReviewResult({ result: "fail", summary: "Needs work" });
  handler.advancePhase(); // review -> again

  handler.advancePhase(); // again -> review
  assertEquals(handler.getPhase(), "review");
});

Deno.test("ProjectCompletionHandler - complete phase does not advance further", () => {
  const handler = new ProjectCompletionHandler(1);
  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review
  handler.setReviewResult({ result: "pass", summary: "Done" });
  handler.advancePhase(); // review -> complete

  handler.advancePhase(); // should stay at complete
  assertEquals(handler.getPhase(), "complete");
});

// ============================================================
// Project Plan Tests
// ============================================================

Deno.test("ProjectCompletionHandler - getProjectPlan returns null initially", () => {
  const handler = new ProjectCompletionHandler(1);
  assertEquals(handler.getProjectPlan(), null);
});

Deno.test("ProjectCompletionHandler - setProjectPlan and getProjectPlan", () => {
  const handler = new ProjectCompletionHandler(1);

  const plan: ProjectPlan = {
    totalIssues: 5,
    estimatedComplexity: "medium",
    skillsNeeded: ["typescript", "testing"],
    executionOrder: [
      { issue: 1, reason: "Foundation" },
      { issue: 2, reason: "Core feature" },
    ],
    notes: "Test notes",
  };

  handler.setProjectPlan(plan);

  const result = handler.getProjectPlan();
  assertExists(result);
  assertEquals(result.totalIssues, 5);
  assertEquals(result.estimatedComplexity, "medium");
  assertEquals(result.skillsNeeded.length, 2);
  assertEquals(result.executionOrder.length, 2);
  assertEquals(result.notes, "Test notes");
});

// ============================================================
// Review Result Tests
// ============================================================

Deno.test("ProjectCompletionHandler - getReviewResult returns null initially", () => {
  const handler = new ProjectCompletionHandler(1);
  assertEquals(handler.getReviewResult(), null);
});

Deno.test("ProjectCompletionHandler - setReviewResult and getReviewResult with pass", () => {
  const handler = new ProjectCompletionHandler(1);

  const result: ReviewResult = {
    result: "pass",
    summary: "All issues completed successfully",
  };

  handler.setReviewResult(result);

  const retrieved = handler.getReviewResult();
  assertExists(retrieved);
  assertEquals(retrieved.result, "pass");
  assertEquals(retrieved.summary, "All issues completed successfully");
});

Deno.test("ProjectCompletionHandler - setReviewResult and getReviewResult with fail and issues", () => {
  const handler = new ProjectCompletionHandler(1);

  const result: ReviewResult = {
    result: "fail",
    summary: "2 issues need attention",
    issues: [
      { number: 10, reason: "Not fully implemented" },
      { number: 15, reason: "Missing tests" },
    ],
  };

  handler.setReviewResult(result);

  const retrieved = handler.getReviewResult();
  assertExists(retrieved);
  assertEquals(retrieved.result, "fail");
  assertEquals(retrieved.issues?.length, 2);
  assertEquals(retrieved.issues?.[0].number, 10);
  assertEquals(retrieved.issues?.[1].reason, "Missing tests");
});

// ============================================================
// Issue Completed Tests
// ============================================================

Deno.test("ProjectCompletionHandler - getCompletedCount returns 0 initially", () => {
  const handler = new ProjectCompletionHandler(1);
  assertEquals(handler.getCompletedCount(), 0);
});

Deno.test("ProjectCompletionHandler - getCurrentIssueNumber returns null when no current issue", () => {
  const handler = new ProjectCompletionHandler(1);
  assertEquals(handler.getCurrentIssueNumber(), null);
});

// ============================================================
// Completion Criteria Tests
// ============================================================

Deno.test("ProjectCompletionHandler - buildCompletionCriteria", () => {
  const handler = new ProjectCompletionHandler(42);
  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.short, "Complete project #42");
  assertEquals(criteria.detailed.includes("42"), true);
  assertEquals(criteria.detailed.includes("GitHub Project"), true);
});

Deno.test("ProjectCompletionHandler - buildCompletionCriteria with label filter", () => {
  const handler = new ProjectCompletionHandler(10, "priority");
  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.short, "Complete project #10");
  assertEquals(criteria.detailed.includes("priority"), true);
});

// ============================================================
// Constructor Tests
// ============================================================

Deno.test("ProjectCompletionHandler - type is project", () => {
  const handler = new ProjectCompletionHandler(1);
  assertEquals(handler.type, "project");
});

Deno.test("ProjectCompletionHandler - constructor with all parameters", () => {
  const handler = new ProjectCompletionHandler(
    5,
    "enhancement",
    "owner123",
    true,
  );
  assertEquals(handler.type, "project");
  assertEquals(handler.getPhase(), "preparation");
});

// ============================================================
// Phase Transition Edge Cases
// ============================================================

Deno.test("ProjectCompletionHandler - review to again without explicit reviewResult defaults to again", () => {
  const handler = new ProjectCompletionHandler(1);
  handler.advancePhase(); // preparation -> processing
  handler.advancePhase(); // processing -> review

  // Do not set reviewResult (it's null)
  handler.advancePhase(); // review -> again (because reviewResult?.result !== "pass")
  assertEquals(handler.getPhase(), "again");
});

Deno.test("ProjectCompletionHandler - full workflow: preparation -> processing -> review -> complete", () => {
  const handler = new ProjectCompletionHandler(1);

  assertEquals(handler.getPhase(), "preparation");

  handler.advancePhase();
  assertEquals(handler.getPhase(), "processing");

  handler.advancePhase();
  assertEquals(handler.getPhase(), "review");

  handler.setReviewResult({ result: "pass", summary: "Done" });
  handler.advancePhase();
  assertEquals(handler.getPhase(), "complete");
});

Deno.test("ProjectCompletionHandler - full workflow with retry: preparation -> processing -> review -> again -> review -> complete", () => {
  const handler = new ProjectCompletionHandler(1);

  handler.advancePhase(); // processing
  handler.advancePhase(); // review

  handler.setReviewResult({ result: "fail", summary: "Needs work" });
  handler.advancePhase(); // again
  assertEquals(handler.getPhase(), "again");

  handler.advancePhase(); // review
  assertEquals(handler.getPhase(), "review");

  handler.setReviewResult({ result: "pass", summary: "Fixed" });
  handler.advancePhase(); // complete
  assertEquals(handler.getPhase(), "complete");
});
