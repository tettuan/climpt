/**
 * GitHub Integration Tests
 *
 * Tests for the GitHub project fetching functionality.
 * Uses mocks to avoid actual API calls.
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import type { GitHubProject } from "./types.ts";

// =============================================================================
// Type Definitions for gh CLI output variations
// =============================================================================

/**
 * Actual gh project view --format json output structure
 * (may differ from our internal GitHubProject type)
 */
interface GhProjectViewOutput {
  number?: number;
  title?: string;
  shortDescription?: string;
  readme?: string;
  url?: string;
  closed?: boolean;
  items?: GhProjectItem[] | null;
  // fields etc...
}

interface GhProjectItem {
  id?: string;
  type?: string;
  title?: string;
  body?: string;
  status?: string;
  assignees?: string[];
  labels?: string[];
  linkedBranches?: string[];
  milestone?: string;
  repository?: string;
  content?: {
    number?: number;
    title?: string;
    state?: string;
  };
}

// =============================================================================
// Responsibility 1: GitHub CLI Executor (mock)
// =============================================================================

/**
 * Mock GitHub CLI executor for testing
 */
class MockGhCliExecutor {
  private responses: Map<string, { stdout: string; code: number }> = new Map();

  setResponse(command: string, stdout: string, code = 0): void {
    this.responses.set(command, { stdout, code });
  }

  execute(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const key = args.join(" ");
    const response = this.responses.get(key);
    if (!response) {
      return Promise.resolve({
        code: 1,
        stdout: "",
        stderr: `Unknown command: ${key}`,
      });
    }
    return Promise.resolve({ ...response, stderr: "" });
  }
}

// =============================================================================
// Responsibility 2: Project Response Parser
// =============================================================================

/**
 * Parse and validate gh project view JSON output
 * Handles different output formats and provides defaults
 */
function parseProjectResponse(jsonString: string): GhProjectViewOutput {
  const data = JSON.parse(jsonString);

  // Handle case where items might not be an array
  if (data.items !== undefined && !Array.isArray(data.items)) {
    console.warn("items is not an array, defaulting to empty array");
    data.items = [];
  }

  return data as GhProjectViewOutput;
}

// =============================================================================
// Responsibility 3: Project Data Mapper
// =============================================================================

/**
 * Map gh CLI output to internal GitHubProject format
 */
function mapToGitHubProject(
  output: GhProjectViewOutput,
  projectNumber: number,
): GitHubProject {
  const items = output.items ?? [];

  return {
    number: output.number ?? projectNumber,
    title: output.title ?? "Untitled",
    description: output.shortDescription ?? output.readme ?? null,
    items: items.map((item) => ({
      content: item.content
        ? {
          number: item.content.number,
          title: item.content.title ?? item.title,
          state: item.content.state as "OPEN" | "CLOSED" | undefined,
        }
        : undefined,
      status: item.status,
    })),
  };
}

// =============================================================================
// Responsibility 4: Requirement Formatter
// =============================================================================

/**
 * Format GitHubProject for LLM prompt
 */
function formatProjectRequirements(project: GitHubProject): string {
  const itemsList = project.items
    .map(
      (item) =>
        `- [${item.status || "No status"}] #${item.content?.number || "N/A"}: ${
          item.content?.title || "Untitled"
        }`,
    )
    .join("\n");

  return `
# Project #${project.number}: ${project.title}

## Description
${project.description || "(No description)"}

## Items
${itemsList || "(No items)"}

## Status
Total items: ${project.items.length}
  `.trim();
}

// =============================================================================
// Responsibility 5: Completion Checker
// =============================================================================

/**
 * Check if all project items are complete
 */
function isProjectComplete(project: GitHubProject): boolean {
  if (project.items.length === 0) {
    return true; // Empty project is considered complete
  }

  return project.items.every(
    (item) => item.content?.state === "CLOSED" || item.status === "Done",
  );
}

// =============================================================================
// Tests
// =============================================================================

Deno.test("parseProjectResponse - handles valid JSON with items array", () => {
  const json = JSON.stringify({
    title: "Test Project",
    items: [
      { id: "1", title: "Task 1", status: "Todo" },
      { id: "2", title: "Task 2", status: "Done" },
    ],
  });

  const result = parseProjectResponse(json);

  assertEquals(result.title, "Test Project");
  assertEquals(Array.isArray(result.items), true);
  assertEquals(result.items?.length, 2);
});

Deno.test("parseProjectResponse - handles missing items", () => {
  const json = JSON.stringify({
    title: "Empty Project",
  });

  const result = parseProjectResponse(json);

  assertEquals(result.title, "Empty Project");
  assertEquals(result.items, undefined);
});

Deno.test("parseProjectResponse - handles items as null", () => {
  const json = JSON.stringify({
    title: "Null Items Project",
    items: null,
  });

  const result = parseProjectResponse(json);

  assertEquals(result.title, "Null Items Project");
  // null is preserved, mapper will handle it
});

Deno.test("parseProjectResponse - throws on invalid JSON", () => {
  assertThrows(() => {
    parseProjectResponse("not valid json");
  });
});

Deno.test("mapToGitHubProject - maps complete output", () => {
  const output: GhProjectViewOutput = {
    number: 25,
    title: "My Project",
    shortDescription: "Project description",
    items: [
      {
        id: "1",
        title: "Task 1",
        status: "Todo",
        content: { number: 100, title: "Issue 100", state: "OPEN" },
      },
      {
        id: "2",
        title: "Task 2",
        status: "Done",
        content: { number: 101, title: "Issue 101", state: "CLOSED" },
      },
    ],
  };

  const project = mapToGitHubProject(output, 25);

  assertEquals(project.number, 25);
  assertEquals(project.title, "My Project");
  assertEquals(project.description, "Project description");
  assertEquals(project.items.length, 2);
  assertEquals(project.items[0].status, "Todo");
  assertEquals(project.items[0].content?.number, 100);
  assertEquals(project.items[1].status, "Done");
});

Deno.test("mapToGitHubProject - handles missing items", () => {
  const output: GhProjectViewOutput = {
    title: "Empty Project",
  };

  const project = mapToGitHubProject(output, 10);

  assertEquals(project.number, 10);
  assertEquals(project.items.length, 0);
});

Deno.test("mapToGitHubProject - handles null items", () => {
  const output: GhProjectViewOutput = {
    title: "Null Project",
    items: null,
  };

  const project = mapToGitHubProject(output, 5);

  assertEquals(project.items.length, 0);
});

Deno.test("formatProjectRequirements - formats with items", () => {
  const project: GitHubProject = {
    number: 25,
    title: "Test Project",
    description: "A test project",
    items: [
      {
        content: { number: 1, title: "Task 1", state: "OPEN" },
        status: "Todo",
      },
      {
        content: { number: 2, title: "Task 2", state: "CLOSED" },
        status: "Done",
      },
    ],
  };

  const result = formatProjectRequirements(project);

  assertEquals(result.includes("# Project #25: Test Project"), true);
  assertEquals(result.includes("[Todo] #1: Task 1"), true);
  assertEquals(result.includes("[Done] #2: Task 2"), true);
  assertEquals(result.includes("Total items: 2"), true);
});

Deno.test("formatProjectRequirements - formats empty project", () => {
  const project: GitHubProject = {
    number: 1,
    title: "Empty",
    description: null,
    items: [],
  };

  const result = formatProjectRequirements(project);

  assertEquals(result.includes("(No description)"), true);
  assertEquals(result.includes("(No items)"), true);
  assertEquals(result.includes("Total items: 0"), true);
});

Deno.test("isProjectComplete - returns true when all items done", () => {
  const project: GitHubProject = {
    number: 1,
    title: "Complete",
    description: null,
    items: [
      {
        content: { number: 1, title: "Task 1", state: "CLOSED" },
        status: "Done",
      },
      {
        content: { number: 2, title: "Task 2", state: "CLOSED" },
        status: "Done",
      },
    ],
  };

  assertEquals(isProjectComplete(project), true);
});

Deno.test("isProjectComplete - returns true when status is Done", () => {
  const project: GitHubProject = {
    number: 1,
    title: "Done Status",
    description: null,
    items: [
      {
        content: { number: 1, title: "Task 1", state: "OPEN" },
        status: "Done",
      },
    ],
  };

  assertEquals(isProjectComplete(project), true);
});

Deno.test("isProjectComplete - returns false with incomplete items", () => {
  const project: GitHubProject = {
    number: 1,
    title: "Incomplete",
    description: null,
    items: [
      {
        content: { number: 1, title: "Task 1", state: "OPEN" },
        status: "Todo",
      },
      {
        content: { number: 2, title: "Task 2", state: "CLOSED" },
        status: "Done",
      },
    ],
  };

  assertEquals(isProjectComplete(project), false);
});

Deno.test("isProjectComplete - empty project is complete", () => {
  const project: GitHubProject = {
    number: 1,
    title: "Empty",
    description: null,
    items: [],
  };

  assertEquals(isProjectComplete(project), true);
});

// =============================================================================
// Integration test with mock CLI
// =============================================================================

Deno.test("Integration - full flow with mock CLI", async () => {
  const mockCli = new MockGhCliExecutor();

  // Set up mock responses
  mockCli.setResponse(
    "repo view --json owner -q .owner.login",
    "testowner",
  );

  mockCli.setResponse(
    "project view 25 --owner testowner --format json",
    JSON.stringify({
      number: 25,
      title: "Integration Test Project",
      shortDescription: "Test description",
      items: [
        {
          id: "item1",
          title: "Task 1",
          status: "In Progress",
          content: { number: 100, title: "Issue #100", state: "OPEN" },
        },
      ],
    }),
  );

  // Execute flow
  const ownerResult = await mockCli.execute([
    "repo",
    "view",
    "--json",
    "owner",
    "-q",
    ".owner.login",
  ]);
  assertEquals(ownerResult.code, 0);

  const projectResult = await mockCli.execute([
    "project",
    "view",
    "25",
    "--owner",
    "testowner",
    "--format",
    "json",
  ]);
  assertEquals(projectResult.code, 0);

  const parsed = parseProjectResponse(projectResult.stdout);
  const project = mapToGitHubProject(parsed, 25);
  const requirements = formatProjectRequirements(project);
  const complete = isProjectComplete(project);

  assertEquals(project.title, "Integration Test Project");
  assertEquals(project.items.length, 1);
  assertEquals(requirements.includes("Issue #100"), true);
  assertEquals(complete, false);
});
