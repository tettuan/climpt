/**
 * Unit tests for GhCliClient project v2 methods.
 *
 * Stubs Deno.Command to return canned stdout fixtures from gh CLI.
 * All tests run without network access.
 *
 * Fixtures: ./fixtures/gh-projects/README.md
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { GhCliClient } from "./github-client.ts";

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURE_DIR = new URL("./fixtures/gh-projects/", import.meta.url);

async function loadFixture(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(name, FIXTURE_DIR));
}

// ---------------------------------------------------------------------------
// Deno.Command stub
// ---------------------------------------------------------------------------

interface StubResponse {
  stdout?: string;
  stderr?: string;
  success?: boolean;
}

type ArgsMatcher = (args: string[]) => boolean;

interface StubRule {
  match: ArgsMatcher;
  response: StubResponse;
}

/**
 * Replace Deno.Command with a mock that matches args against rules.
 * Returns a restore function and a log of all captured arg arrays.
 */
function stubDenoCommand(
  rules: StubRule[],
): { restore: () => void; calls: string[][] } {
  const Original = Deno.Command;
  const calls: string[][] = [];

  // deno-lint-ignore no-explicit-any
  (Deno as any).Command = class MockCommand {
    #args: string[];
    // deno-lint-ignore no-explicit-any
    constructor(_cmd: string | URL, opts?: Record<string, any>) {
      this.#args = [...((opts?.args as string[]) ?? [])];
    }
    output(): Promise<Deno.CommandOutput> {
      calls.push(this.#args);
      const rule = rules.find((r) => r.match(this.#args));
      if (!rule) {
        throw new Error(
          `Unexpected Deno.Command call: gh ${this.#args.join(" ")}`,
        );
      }
      const enc = new TextEncoder();
      const { stdout = "", stderr = "", success = true } = rule.response;
      return Promise.resolve({
        success,
        code: success ? 0 : 1,
        signal: null,
        stdout: enc.encode(stdout),
        stderr: enc.encode(stderr),
      } as Deno.CommandOutput);
    }
  };

  return {
    restore: () => {
      // deno-lint-ignore no-explicit-any
      (Deno as any).Command = Original;
    },
    calls,
  };
}

/** Match when every pattern string appears somewhere in args. */
function argsContain(...patterns: string[]): ArgsMatcher {
  return (args) => patterns.every((p) => args.includes(p));
}

/** Fresh client for each test (empty cache). */
function newClient(): GhCliClient {
  return new GhCliClient("/tmp/test-repo");
}

// ===========================================================================
// addIssueToProject
// ===========================================================================

Deno.test("addIssueToProject returns project item ID on success", async () => {
  const fixture = await loadFixture("project-item-add.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-add"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const id = await newClient().addIssueToProject(
      { owner: "tettuan", number: 1 },
      42,
    );
    assertEquals(id, "PVTI_lADOABC123DEF456");
    assert(id.startsWith("PVTI_"), `Expected PVTI_ prefix, got: ${id}`);
  } finally {
    restore();
  }
});

Deno.test("addIssueToProject is idempotent for already-added issue", async () => {
  const fixture = await loadFixture("project-item-add.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-add"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const client = newClient();
    const first = await client.addIssueToProject(
      { owner: "tettuan", number: 1 },
      42,
    );
    const second = await client.addIssueToProject(
      { owner: "tettuan", number: 1 },
      42,
    );
    assertEquals(first, second);
  } finally {
    restore();
  }
});

Deno.test("addIssueToProject throws on auth error", async () => {
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-add"),
      response: {
        success: false,
        stderr: "HTTP 403: Must have admin rights to Resource: project",
      },
    },
  ]);
  try {
    await assertRejects(
      () => newClient().addIssueToProject({ owner: "tettuan", number: 1 }, 42),
      Error,
      "Failed to add issue",
    );
  } finally {
    restore();
  }
});

// ===========================================================================
// closeProject
// ===========================================================================

Deno.test("closeProject succeeds without error", async () => {
  const { restore, calls } = stubDenoCommand([
    {
      match: argsContain("project", "close"),
      response: { stdout: "" },
    },
  ]);
  try {
    await newClient().closeProject({ owner: "tettuan", number: 1 });
    assertEquals(calls.length, 1);
    assert(calls[0].includes("close"), "Expected close subcommand");
  } finally {
    restore();
  }
});

Deno.test("closeProject throws on auth error", async () => {
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "close"),
      response: {
        success: false,
        stderr: "HTTP 403: Resource not accessible by personal access token",
      },
    },
  ]);
  try {
    await assertRejects(
      () => newClient().closeProject({ owner: "tettuan", number: 1 }),
      Error,
      "Failed to close project",
    );
  } finally {
    restore();
  }
});

// ===========================================================================
// getProjectItemIdForIssue
// ===========================================================================

Deno.test("getProjectItemIdForIssue returns item ID for existing issue", async () => {
  const fixture = await loadFixture("project-item-list.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-list"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const id = await newClient().getProjectItemIdForIssue(
      { owner: "tettuan", number: 1 },
      42,
    );
    assertEquals(id, "PVTI_lADOABC123DEF456");
    assert(
      id !== null && id.startsWith("PVTI_"),
      `Expected PVTI_ prefix, got: ${id}`,
    );
  } finally {
    restore();
  }
});

Deno.test("getProjectItemIdForIssue returns null when issue not in project", async () => {
  const fixture = await loadFixture("project-item-list.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-list"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const id = await newClient().getProjectItemIdForIssue(
      { owner: "tettuan", number: 1 },
      999,
    );
    assertEquals(id, null);
  } finally {
    restore();
  }
});

Deno.test("getProjectItemIdForIssue returns null for empty project", async () => {
  const fixture = await loadFixture("project-item-list-empty.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-list"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const id = await newClient().getProjectItemIdForIssue(
      { owner: "tettuan", number: 1 },
      42,
    );
    assertEquals(id, null);
  } finally {
    restore();
  }
});

// ===========================================================================
// listProjectItems
// ===========================================================================

Deno.test("listProjectItems returns issue items filtering non-Issue types", async () => {
  const fixture = await loadFixture("project-item-list.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-list"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const items = await newClient().listProjectItems({
      owner: "tettuan",
      number: 1,
    });
    // Fixture has 3 items: 2 Issues + 1 DraftIssue; only Issues returned
    assertEquals(items.length, 2);
    assertEquals(items[0], { id: "PVTI_lADOABC123DEF456", issueNumber: 42 });
    assertEquals(items[1], { id: "PVTI_lADOABC123DEF789", issueNumber: 99 });
    for (const item of items) {
      assert(
        item.id.startsWith("PVTI_"),
        `Expected PVTI_ prefix, got: ${item.id}`,
      );
    }
  } finally {
    restore();
  }
});

Deno.test("listProjectItems returns empty array for project with no items", async () => {
  const fixture = await loadFixture("project-item-list-empty.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-list"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const items = await newClient().listProjectItems({
      owner: "tettuan",
      number: 1,
    });
    assertEquals(items, []);
  } finally {
    restore();
  }
});

// ===========================================================================
// getIssueProjects (listProjectsForIssue)
// ===========================================================================

Deno.test("getIssueProjects returns project refs from line-delimited JSON", async () => {
  const fixture = await loadFixture("issue-view-projects.jsonl");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("issue", "view"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const projects = await newClient().getIssueProjects(42);
    assertEquals(projects.length, 2);
    assertEquals(projects[0], { owner: "tettuan", number: 1 });
    assertEquals(projects[1], { owner: "tettuan", number: 3 });
  } finally {
    restore();
  }
});

Deno.test("getIssueProjects returns empty array when issue has no projects", async () => {
  const { restore } = stubDenoCommand([
    {
      match: argsContain("issue", "view"),
      response: { stdout: "" },
    },
  ]);
  try {
    const projects = await newClient().getIssueProjects(42);
    assertEquals(projects, []);
  } finally {
    restore();
  }
});

// ===========================================================================
// createProjectFieldOption
// ===========================================================================

Deno.test("createProjectFieldOption returns created option with ID and name", async () => {
  const viewFixture = await loadFixture("project-view.json");
  const gqlFixture = await loadFixture("graphql-create-field-option.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "view"),
      response: { stdout: viewFixture },
    },
    {
      match: argsContain("api", "graphql"),
      response: { stdout: gqlFixture },
    },
  ]);
  try {
    const option = await newClient().createProjectFieldOption(
      { owner: "tettuan", number: 1 },
      "PVTF_lADOField001",
      "Blocked",
      "RED",
    );
    assertEquals(option, { id: "PVTSSFO_newopt001", name: "Blocked" });
  } finally {
    restore();
  }
});

Deno.test("createProjectFieldOption throws on auth error", async () => {
  const viewFixture = await loadFixture("project-view.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "view"),
      response: { stdout: viewFixture },
    },
    {
      match: argsContain("api", "graphql"),
      response: {
        success: false,
        stderr: 'gh: Your token does not have the required scopes: ["project"]',
      },
    },
  ]);
  try {
    await assertRejects(
      () =>
        newClient().createProjectFieldOption(
          { owner: "tettuan", number: 1 },
          "PVTF_lADOField001",
          "Blocked",
        ),
      Error,
      "Failed to create project field option",
    );
  } finally {
    restore();
  }
});

// ===========================================================================
// listUserProjects
// ===========================================================================

Deno.test("listUserProjects returns projects with PVT_ IDs", async () => {
  const fixture = await loadFixture("project-list.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "list"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const projects = await newClient().listUserProjects("tettuan");
    assertEquals(projects.length, 2);
    assertEquals(projects[0].id, "PVT_kwDOABC123");
    assertEquals(projects[0].title, "v1.14.0 Roadmap");
    assertEquals(projects[0].owner, "tettuan");
    assertEquals(projects[0].closed, false);
    assertEquals(projects[1].id, "PVT_kwDOABC456");
    assertEquals(projects[1].closed, true);
    for (const p of projects) {
      assert(p.id.startsWith("PVT_"), `Expected PVT_ prefix, got: ${p.id}`);
    }
  } finally {
    restore();
  }
});

Deno.test("listUserProjects returns empty array when no projects", async () => {
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "list"),
      response: { stdout: "" },
    },
  ]);
  try {
    const projects = await newClient().listUserProjects("tettuan");
    assertEquals(projects, []);
  } finally {
    restore();
  }
});

// ===========================================================================
// getProject
// ===========================================================================

Deno.test("getProject returns project metadata", async () => {
  const fixture = await loadFixture("project-view.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "view"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const project = await newClient().getProject({
      owner: "tettuan",
      number: 1,
    });
    assertEquals(project.id, "PVT_kwDOABC123");
    assertEquals(project.number, 1);
    assertEquals(project.owner, "tettuan");
    assertEquals(project.title, "v1.14.0 Roadmap");
    assertEquals(project.readme, "Project readme content");
    assertEquals(project.shortDescription, "Feature tracking");
    assertEquals(project.closed, false);
    assert(
      project.id.startsWith("PVT_"),
      `Expected PVT_ prefix, got: ${project.id}`,
    );
  } finally {
    restore();
  }
});

Deno.test("getProject throws on not found", async () => {
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "view"),
      response: {
        success: false,
        stderr: "Could not resolve to a ProjectV2 with the number 999.",
      },
    },
  ]);
  try {
    await assertRejects(
      () => newClient().getProject({ owner: "tettuan", number: 999 }),
      Error,
      "Failed to get project",
    );
  } finally {
    restore();
  }
});

// ===========================================================================
// getProjectFields
// ===========================================================================

Deno.test("getProjectFields returns fields with options for single_select", async () => {
  const fixture = await loadFixture("project-field-list.json");
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "field-list"),
      response: { stdout: fixture },
    },
  ]);
  try {
    const fields = await newClient().getProjectFields({
      owner: "tettuan",
      number: 1,
    });
    assertEquals(fields.length, 3);
    // single_select has options
    assertEquals(fields[0].id, "PVTF_lADOField001");
    assertEquals(fields[0].name, "Status");
    assertEquals(fields[0].type, "single_select");
    assertEquals(fields[0].options?.length, 3);
    assertEquals(fields[0].options?.[0], {
      id: "PVTSSFO_opt001",
      name: "Todo",
    });
    // number type has no options
    assertEquals(fields[1].type, "number");
    assertEquals(fields[1].options, undefined);
  } finally {
    restore();
  }
});

Deno.test("getProjectFields returns empty array when stdout is empty", async () => {
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "field-list"),
      response: { stdout: "" },
    },
  ]);
  try {
    const fields = await newClient().getProjectFields({
      owner: "tettuan",
      number: 1,
    });
    assertEquals(fields, []);
  } finally {
    restore();
  }
});

// ===========================================================================
// removeProjectItem
// ===========================================================================

Deno.test("removeProjectItem succeeds without error", async () => {
  const { restore, calls } = stubDenoCommand([
    {
      match: argsContain("project", "item-delete"),
      response: { stdout: "" },
    },
  ]);
  try {
    await newClient().removeProjectItem(
      { owner: "tettuan", number: 1 },
      "PVTI_lADOABC123DEF456",
    );
    assertEquals(calls.length, 1);
    assert(calls[0].includes("item-delete"), "Expected item-delete subcommand");
    assert(
      calls[0].includes("PVTI_lADOABC123DEF456"),
      "Expected item ID in args",
    );
  } finally {
    restore();
  }
});

Deno.test("removeProjectItem throws on auth error", async () => {
  const { restore } = stubDenoCommand([
    {
      match: argsContain("project", "item-delete"),
      response: {
        success: false,
        stderr: "HTTP 403: Resource not accessible by personal access token",
      },
    },
  ]);
  try {
    await assertRejects(
      () =>
        newClient().removeProjectItem(
          { owner: "tettuan", number: 1 },
          "PVTI_lADOABC123DEF456",
        ),
      Error,
      "Failed to remove item",
    );
  } finally {
    restore();
  }
});
