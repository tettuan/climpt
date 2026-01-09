/**
 * Facilitator Completion Handler Tests
 */

import { assertEquals } from "@std/assert";
import {
  type BlockerInfo,
  FacilitatorCompletionHandler,
  type ProjectStatus,
} from "./facilitator.ts";

Deno.test("FacilitatorCompletionHandler - initial phase is monitoring", () => {
  const handler = new FacilitatorCompletionHandler(1);
  assertEquals(handler.getPhase(), "monitoring");
});

Deno.test("FacilitatorCompletionHandler - type is facilitator", () => {
  const handler = new FacilitatorCompletionHandler(1);
  assertEquals(handler.type, "facilitator");
});

Deno.test("FacilitatorCompletionHandler - advancePhase with no blockers", () => {
  const handler = new FacilitatorCompletionHandler(1);

  // monitoring -> reporting (no blockers)
  handler.advancePhase();
  assertEquals(handler.getPhase(), "reporting");

  // reporting -> complete
  handler.advancePhase();
  assertEquals(handler.getPhase(), "complete");
});

Deno.test("FacilitatorCompletionHandler - advancePhase with blockers", () => {
  const handler = new FacilitatorCompletionHandler(1);

  // Add a blocker
  handler.addBlocker({
    issueNumber: 123,
    title: "Blocked Issue",
    reason: "Waiting for dependency",
  });

  // monitoring -> intervention (has blockers)
  handler.advancePhase();
  assertEquals(handler.getPhase(), "intervention");

  // intervention -> reporting
  handler.advancePhase();
  assertEquals(handler.getPhase(), "reporting");

  // reporting -> complete
  handler.advancePhase();
  assertEquals(handler.getPhase(), "complete");
});

Deno.test("FacilitatorCompletionHandler - resetToMonitoring", () => {
  const handler = new FacilitatorCompletionHandler(1);

  handler.addBlocker({
    issueNumber: 1,
    title: "Test",
    reason: "Test reason",
  });
  handler.advancePhase(); // intervention

  handler.resetToMonitoring();
  assertEquals(handler.getPhase(), "monitoring");
  assertEquals(handler.getBlockers().length, 0);
});

Deno.test("FacilitatorCompletionHandler - blocker management", () => {
  const handler = new FacilitatorCompletionHandler(1);

  assertEquals(handler.getBlockers().length, 0);

  const blocker: BlockerInfo = {
    issueNumber: 42,
    title: "Stuck Issue",
    reason: "Needs review",
    suggestedAction: "Request code review",
  };

  handler.addBlocker(blocker);
  assertEquals(handler.getBlockers().length, 1);
  assertEquals(handler.getBlockers()[0].issueNumber, 42);

  handler.clearBlockers();
  assertEquals(handler.getBlockers().length, 0);
});

Deno.test("FacilitatorCompletionHandler - buildCompletionCriteria", () => {
  const handler = new FacilitatorCompletionHandler(42);
  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.short, "Facilitate project #42");
  assertEquals(criteria.detailed.includes("42"), true);
  assertEquals(criteria.detailed.includes("Monitor"), true);
});

Deno.test("FacilitatorCompletionHandler - isComplete when phase is complete", async () => {
  const handler = new FacilitatorCompletionHandler(1);

  // Set phase directly to complete for testing
  handler.advancePhase(); // reporting
  handler.advancePhase(); // complete

  const isComplete = await handler.isComplete();
  assertEquals(isComplete, true);
});

Deno.test("FacilitatorCompletionHandler - getCompletionDescription", async () => {
  const handler = new FacilitatorCompletionHandler(99);
  const description = await handler.getCompletionDescription();

  assertEquals(description.includes("99"), true);
  assertEquals(description.includes("monitoring"), true);
});

Deno.test("FacilitatorCompletionHandler - project status is null initially", () => {
  const handler = new FacilitatorCompletionHandler(1);
  assertEquals(handler.getProjectStatus(), null);
});

Deno.test("FacilitatorCompletionHandler - report management", () => {
  const handler = new FacilitatorCompletionHandler(1);

  assertEquals(handler.getReport(), null);

  const report = {
    timestamp: new Date().toISOString(),
    projectNumber: 1,
    status: {
      totalIssues: 10,
      openIssues: 5,
      closedIssues: 5,
      inProgressIssues: 2,
      blockedIssues: 1,
      staleIssues: 0,
    },
    blockers: [],
    recommendations: ["Keep going!"],
    healthScore: 85,
  };

  handler.setReport(report);
  assertEquals(handler.getReport()?.healthScore, 85);
});

Deno.test("FacilitatorCompletionHandler - constructor with owner", () => {
  const handler = new FacilitatorCompletionHandler(1, "testowner");
  assertEquals(handler.type, "facilitator");
});
