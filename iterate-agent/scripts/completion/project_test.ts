/**
 * ProjectCompletionHandler Tests
 *
 * Tests for the ProjectCompletionHandler class, focusing on:
 * - completedIssueNumbers filter functionality
 * - Issue tracking and state management
 * - API cache staleness handling
 */

import { assertEquals, assertExists } from "jsr:@std/assert@^1";

// =============================================================================
// Test Helpers - Simulating ProjectCompletionHandler Logic
// =============================================================================

/**
 * Simulates the completedIssueNumbers filter behavior
 * This mirrors the filter logic in ProjectCompletionHandler.isComplete()
 */
function filterCompletedIssues(
  openIssues: Array<{ issueNumber: number; title: string }>,
  completedIssueNumbers: Set<number>,
): Array<{ issueNumber: number; title: string }> {
  return openIssues.filter(
    (issue) => !completedIssueNumbers.has(issue.issueNumber),
  );
}

/**
 * Simulates the ProjectCompletionHandler state
 */
class MockProjectCompletionHandler {
  private remainingIssues: Array<{ issueNumber: number; title: string }> = [];
  private currentIssue: { issueNumber: number; title: string } | null = null;
  private issuesCompleted = 0;
  private completedIssueNumbers: Set<number> = new Set();

  constructor(initialIssues: Array<{ issueNumber: number; title: string }>) {
    this.remainingIssues = [...initialIssues];
    if (this.remainingIssues.length > 0) {
      this.currentIssue = this.remainingIssues.shift()!;
    }
  }

  getCurrentIssue(): { issueNumber: number; title: string } | null {
    return this.currentIssue;
  }

  getCompletedCount(): number {
    return this.issuesCompleted;
  }

  getCompletedIssueNumbers(): Set<number> {
    return new Set(this.completedIssueNumbers);
  }

  getRemainingCount(): number {
    return this.remainingIssues.length + (this.currentIssue ? 1 : 0);
  }

  /**
   * Mark current issue as completed and advance to next
   */
  markCurrentIssueCompleted(): void {
    if (this.currentIssue) {
      this.issuesCompleted++;
      this.completedIssueNumbers.add(this.currentIssue.issueNumber);
      if (this.remainingIssues.length > 0) {
        this.currentIssue = this.remainingIssues.shift()!;
      } else {
        this.currentIssue = null;
      }
    }
  }

  /**
   * Simulates re-fetching issues from API and filtering out completed ones
   * This tests the core fix - filtering stale API data using completedIssueNumbers
   */
  handleStaleApiData(
    staleOpenIssues: Array<{ issueNumber: number; title: string }>,
  ): boolean {
    // Filter out issues we've already completed (API cache may be stale)
    const filteredIssues = staleOpenIssues.filter(
      (issue) => !this.completedIssueNumbers.has(issue.issueNumber),
    );

    if (filteredIssues.length === 0) {
      this.currentIssue = null;
      return true; // All complete
    }

    // More issues found, continue
    this.remainingIssues = filteredIssues;
    this.currentIssue = this.remainingIssues.shift()!;
    return false;
  }
}

// =============================================================================
// Tests for completedIssueNumbers Filter
// =============================================================================

Deno.test("filterCompletedIssues - filters out completed issues", () => {
  const openIssues = [
    { issueNumber: 1, title: "Issue 1" },
    { issueNumber: 2, title: "Issue 2" },
    { issueNumber: 3, title: "Issue 3" },
  ];
  const completedIssueNumbers = new Set([1, 3]);

  const result = filterCompletedIssues(openIssues, completedIssueNumbers);

  assertEquals(result.length, 1);
  assertEquals(result[0].issueNumber, 2);
  assertEquals(result[0].title, "Issue 2");
});

Deno.test("filterCompletedIssues - returns all when none completed", () => {
  const openIssues = [
    { issueNumber: 1, title: "Issue 1" },
    { issueNumber: 2, title: "Issue 2" },
  ];
  const completedIssueNumbers = new Set<number>();

  const result = filterCompletedIssues(openIssues, completedIssueNumbers);

  assertEquals(result.length, 2);
});

Deno.test("filterCompletedIssues - returns empty when all completed", () => {
  const openIssues = [
    { issueNumber: 1, title: "Issue 1" },
    { issueNumber: 2, title: "Issue 2" },
  ];
  const completedIssueNumbers = new Set([1, 2]);

  const result = filterCompletedIssues(openIssues, completedIssueNumbers);

  assertEquals(result.length, 0);
});

Deno.test("filterCompletedIssues - handles empty input", () => {
  const openIssues: Array<{ issueNumber: number; title: string }> = [];
  const completedIssueNumbers = new Set([1, 2, 3]);

  const result = filterCompletedIssues(openIssues, completedIssueNumbers);

  assertEquals(result.length, 0);
});

// =============================================================================
// Tests for MockProjectCompletionHandler
// =============================================================================

Deno.test("MockProjectCompletionHandler - initializes with first issue as current", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 1, title: "First" },
    { issueNumber: 2, title: "Second" },
  ]);

  const current = handler.getCurrentIssue();
  assertExists(current);
  assertEquals(current.issueNumber, 1);
  assertEquals(handler.getRemainingCount(), 2);
});

Deno.test("MockProjectCompletionHandler - markCurrentIssueCompleted advances to next", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 1, title: "First" },
    { issueNumber: 2, title: "Second" },
    { issueNumber: 3, title: "Third" },
  ]);

  // Complete first issue
  handler.markCurrentIssueCompleted();

  const current = handler.getCurrentIssue();
  assertExists(current);
  assertEquals(current.issueNumber, 2);
  assertEquals(handler.getCompletedCount(), 1);
  assertEquals(handler.getCompletedIssueNumbers().has(1), true);
});

Deno.test("MockProjectCompletionHandler - tracks all completed issue numbers", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 10, title: "First" },
    { issueNumber: 20, title: "Second" },
    { issueNumber: 30, title: "Third" },
  ]);

  handler.markCurrentIssueCompleted();
  handler.markCurrentIssueCompleted();

  const completed = handler.getCompletedIssueNumbers();
  assertEquals(completed.size, 2);
  assertEquals(completed.has(10), true);
  assertEquals(completed.has(20), true);
  assertEquals(completed.has(30), false);
});

Deno.test("MockProjectCompletionHandler - currentIssue becomes null when all done", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 1, title: "Only" },
  ]);

  handler.markCurrentIssueCompleted();

  assertEquals(handler.getCurrentIssue(), null);
  assertEquals(handler.getCompletedCount(), 1);
});

// =============================================================================
// Tests for Stale API Data Handling (the core fix being tested)
// =============================================================================

Deno.test("handleStaleApiData - filters out already completed issues from stale data", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 100, title: "First Issue" },
  ]);

  // Complete the first issue
  handler.markCurrentIssueCompleted();
  assertEquals(handler.getCompletedCount(), 1);

  // Simulate stale API returning the "closed" issue as still open
  const staleApiData = [
    { issueNumber: 100, title: "First Issue" }, // Already completed, should be filtered
    { issueNumber: 200, title: "New Issue" }, // Actually new, should be picked up
  ];

  const isComplete = handler.handleStaleApiData(staleApiData);

  assertEquals(isComplete, false); // Not complete, we have issue 200
  const current = handler.getCurrentIssue();
  assertExists(current);
  assertEquals(current.issueNumber, 200);
  assertEquals(current.title, "New Issue");
});

Deno.test("handleStaleApiData - returns true when all stale issues are already completed", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 1, title: "Issue 1" },
    { issueNumber: 2, title: "Issue 2" },
  ]);

  // Complete both issues
  handler.markCurrentIssueCompleted();
  handler.markCurrentIssueCompleted();

  // Simulate stale API still returning both as open
  const staleApiData = [
    { issueNumber: 1, title: "Issue 1" },
    { issueNumber: 2, title: "Issue 2" },
  ];

  const isComplete = handler.handleStaleApiData(staleApiData);

  assertEquals(isComplete, true); // All complete
  assertEquals(handler.getCurrentIssue(), null);
});

Deno.test("handleStaleApiData - handles multiple completed issues in stale data", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 1, title: "First" },
    { issueNumber: 2, title: "Second" },
    { issueNumber: 3, title: "Third" },
  ]);

  // Complete first two
  handler.markCurrentIssueCompleted();
  handler.markCurrentIssueCompleted();

  // Stale API returns all three as open
  const staleApiData = [
    { issueNumber: 1, title: "First" },
    { issueNumber: 2, title: "Second" },
    { issueNumber: 3, title: "Third" },
  ];

  const isComplete = handler.handleStaleApiData(staleApiData);

  assertEquals(isComplete, false);
  const current = handler.getCurrentIssue();
  assertExists(current);
  assertEquals(current.issueNumber, 3);
});

Deno.test("handleStaleApiData - handles empty stale data", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 1, title: "First" },
  ]);

  handler.markCurrentIssueCompleted();

  const isComplete = handler.handleStaleApiData([]);

  assertEquals(isComplete, true);
  assertEquals(handler.getCurrentIssue(), null);
});

// =============================================================================
// Edge Case Tests
// =============================================================================

Deno.test("completedIssueNumbers - preserves issue numbers across multiple re-fetches", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 100, title: "First" },
  ]);

  handler.markCurrentIssueCompleted();

  // First re-fetch with stale data
  handler.handleStaleApiData([
    { issueNumber: 100, title: "First" },
    { issueNumber: 200, title: "Second" },
  ]);

  // Complete second issue
  handler.markCurrentIssueCompleted();

  // Second re-fetch with stale data (both issues)
  const isComplete = handler.handleStaleApiData([
    { issueNumber: 100, title: "First" },
    { issueNumber: 200, title: "Second" },
  ]);

  assertEquals(isComplete, true);
  assertEquals(handler.getCompletedCount(), 2);
  assertEquals(handler.getCompletedIssueNumbers().has(100), true);
  assertEquals(handler.getCompletedIssueNumbers().has(200), true);
});

Deno.test("completedIssueNumbers - correctly handles interleaved new and stale issues", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 1, title: "Issue 1" },
  ]);

  handler.markCurrentIssueCompleted();

  // Re-fetch returns stale issue 1 plus new issues 2 and 3
  handler.handleStaleApiData([
    { issueNumber: 3, title: "Issue 3" },
    { issueNumber: 1, title: "Issue 1" }, // Stale
    { issueNumber: 2, title: "Issue 2" },
  ]);

  const current = handler.getCurrentIssue();
  assertExists(current);
  // Should pick up issue 3 (first non-completed in filtered list)
  assertEquals(current.issueNumber, 3);
  assertEquals(handler.getRemainingCount(), 2); // Issues 3 and 2
});

Deno.test("completedIssueNumbers - prevents double counting", () => {
  const handler = new MockProjectCompletionHandler([
    { issueNumber: 1, title: "Issue 1" },
  ]);

  // Complete the issue
  handler.markCurrentIssueCompleted();
  assertEquals(handler.getCompletedCount(), 1);

  // Try to complete again via stale data handling
  // (simulates the bug this fix prevents)
  handler.handleStaleApiData([{ issueNumber: 1, title: "Issue 1" }]);

  // Should still be 1, not 2
  assertEquals(handler.getCompletedCount(), 1);
});
