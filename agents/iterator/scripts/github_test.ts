/**
 * GitHub Integration Tests
 *
 * Tests for the GitHub integration module.
 * These tests focus on:
 * - Type exports and interfaces
 * - Function signatures
 * - Logic that can be unit tested without gh CLI
 *
 * Note: Tests requiring actual gh CLI calls should use mocking or be run
 * as integration tests with proper GitHub authentication.
 */

import { assertEquals, assertExists } from "@std/assert";

// Import actual exports from github.ts
import type {
  GetProjectIssuesOptions,
  IssueActionResult,
  ProjectIssueInfo,
} from "./github.ts";
import { executeIssueAction } from "./github.ts";

// =============================================================================
// Type Definition Tests
// =============================================================================

Deno.test("ProjectIssueInfo - type structure is correct", () => {
  // Verify the type structure compiles correctly
  const issue: ProjectIssueInfo = {
    issueNumber: 123,
    title: "Test Issue",
    state: "OPEN",
    status: "Todo",
    labels: ["bug", "priority"],
    repository: "owner/repo",
  };

  assertEquals(issue.issueNumber, 123);
  assertEquals(issue.title, "Test Issue");
  assertEquals(issue.state, "OPEN");
  assertEquals(issue.status, "Todo");
  assertEquals(issue.labels?.length, 2);
  assertEquals(issue.repository, "owner/repo");
});

Deno.test("ProjectIssueInfo - minimal required fields", () => {
  // Verify minimal required fields
  const minimalIssue: ProjectIssueInfo = {
    issueNumber: 1,
    title: "Minimal",
    state: "CLOSED",
  };

  assertEquals(minimalIssue.issueNumber, 1);
  assertEquals(minimalIssue.title, "Minimal");
  assertEquals(minimalIssue.state, "CLOSED");
  assertEquals(minimalIssue.status, undefined);
  assertEquals(minimalIssue.labels, undefined);
  assertEquals(minimalIssue.repository, undefined);
});

Deno.test("GetProjectIssuesOptions - all options are optional", () => {
  // Verify options interface allows empty object
  const emptyOptions: GetProjectIssuesOptions = {};

  assertEquals(emptyOptions.labelFilter, undefined);
  assertEquals(emptyOptions.includeCompleted, undefined);
  assertEquals(emptyOptions.owner, undefined);
});

Deno.test("GetProjectIssuesOptions - with all options", () => {
  const fullOptions: GetProjectIssuesOptions = {
    labelFilter: "docs",
    includeCompleted: true,
    owner: "@me",
  };

  assertEquals(fullOptions.labelFilter, "docs");
  assertEquals(fullOptions.includeCompleted, true);
  assertEquals(fullOptions.owner, "@me");
});

Deno.test("IssueActionResult - success result structure", () => {
  const result: IssueActionResult = {
    success: true,
    action: "progress",
    issue: 42,
    shouldStop: false,
    isClosed: false,
  };

  assertEquals(result.success, true);
  assertEquals(result.action, "progress");
  assertEquals(result.issue, 42);
  assertEquals(result.shouldStop, false);
  assertEquals(result.isClosed, false);
  assertEquals(result.error, undefined);
});

Deno.test("IssueActionResult - error result structure", () => {
  const result: IssueActionResult = {
    success: false,
    action: "close",
    issue: 42,
    shouldStop: false,
    isClosed: false,
    error: "gh command failed",
  };

  assertEquals(result.success, false);
  assertEquals(result.error, "gh command failed");
});

Deno.test("IssueActionResult - close action sets shouldStop and isClosed", () => {
  const result: IssueActionResult = {
    success: true,
    action: "close",
    issue: 100,
    shouldStop: true,
    isClosed: true,
  };

  assertEquals(result.shouldStop, true);
  assertEquals(result.isClosed, true);
});

Deno.test("IssueActionResult - blocked action sets shouldStop", () => {
  const result: IssueActionResult = {
    success: true,
    action: "blocked",
    issue: 100,
    shouldStop: true,
    isClosed: false,
  };

  assertEquals(result.shouldStop, true);
  assertEquals(result.isClosed, false);
});

// =============================================================================
// executeIssueAction Logic Tests (unknown action type)
// =============================================================================

Deno.test("executeIssueAction - unknown action returns error", async () => {
  const action = {
    action: "unknown_action_type",
    issue: 123,
    body: "Test body",
  };

  const result = await executeIssueAction(action);

  assertEquals(result.success, false);
  assertEquals(result.action, "unknown_action_type");
  assertEquals(result.issue, 123);
  assertExists(result.error);
  assertEquals(result.error?.includes("Unknown action type"), true);
  assertEquals(result.shouldStop, false);
  assertEquals(result.isClosed, false);
});

// =============================================================================
// State Value Tests
// =============================================================================

Deno.test("ProjectIssueInfo - state values are OPEN or CLOSED", () => {
  const openIssue: ProjectIssueInfo = {
    issueNumber: 1,
    title: "Open",
    state: "OPEN",
  };

  const closedIssue: ProjectIssueInfo = {
    issueNumber: 2,
    title: "Closed",
    state: "CLOSED",
  };

  assertEquals(openIssue.state, "OPEN");
  assertEquals(closedIssue.state, "CLOSED");
});

// =============================================================================
// Label Filtering Logic Tests
// =============================================================================

Deno.test("ProjectIssueInfo - labels array handling", () => {
  // Empty labels array
  const noLabels: ProjectIssueInfo = {
    issueNumber: 1,
    title: "No labels",
    state: "OPEN",
    labels: [],
  };
  assertEquals(noLabels.labels?.length, 0);

  // Multiple labels
  const multiLabels: ProjectIssueInfo = {
    issueNumber: 2,
    title: "Multi labels",
    state: "OPEN",
    labels: ["bug", "critical", "needs-triage"],
  };
  assertEquals(multiLabels.labels?.length, 3);
  assertEquals(multiLabels.labels?.includes("bug"), true);
  assertEquals(multiLabels.labels?.includes("critical"), true);
});

// =============================================================================
// Repository Field Tests
// =============================================================================

Deno.test("ProjectIssueInfo - repository format is owner/repo", () => {
  const crossRepoIssue: ProjectIssueInfo = {
    issueNumber: 42,
    title: "Cross repo issue",
    state: "OPEN",
    repository: "octocat/hello-world",
  };

  assertEquals(crossRepoIssue.repository, "octocat/hello-world");
  assertEquals(crossRepoIssue.repository?.split("/").length, 2);
});

Deno.test("ProjectIssueInfo - repository is optional for same-repo issues", () => {
  const sameRepoIssue: ProjectIssueInfo = {
    issueNumber: 42,
    title: "Same repo issue",
    state: "OPEN",
  };

  assertEquals(sameRepoIssue.repository, undefined);
});

// =============================================================================
// Action Type Enumeration Tests
// =============================================================================

Deno.test("IssueActionResult - action types match expected values", () => {
  const actionTypes = ["progress", "question", "blocked", "close"];

  for (const actionType of actionTypes) {
    const result: IssueActionResult = {
      success: true,
      action: actionType,
      issue: 1,
      shouldStop: actionType === "blocked" || actionType === "close",
      isClosed: actionType === "close",
    };

    assertEquals(result.action, actionType);
  }
});
