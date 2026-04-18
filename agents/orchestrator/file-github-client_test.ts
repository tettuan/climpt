/**
 * Unit tests for FileGitHubClient
 *
 * Verifies that FileGitHubClient correctly reads/writes issue data
 * via SubjectStore, matching the GitHubClient interface contract.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { FileGitHubClient } from "./file-github-client.ts";
import { SubjectStore } from "./subject-store.ts";

async function withTempStore(
  fn: (store: SubjectStore, client: FileGitHubClient) => Promise<void>,
): Promise<void> {
  const tmp = await Deno.makeTempDir();
  const store = new SubjectStore(`${tmp}/issues`);
  const client = new FileGitHubClient(store);
  try {
    await fn(store, client);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function seedIssue(
  store: SubjectStore,
  num: number,
  labels: string[],
  state = "open",
): Promise<void> {
  await store.writeIssue({
    meta: {
      number: num,
      title: `Issue ${num}`,
      labels,
      state,
      assignees: [],
      milestone: null,
    },
    body: `Body of issue ${num}`,
    comments: [],
  });
}

Deno.test("getIssueLabels reads labels from meta.json", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready", "P1"]);
    const labels = await client.getIssueLabels(1);
    assertEquals(labels, ["ready", "P1"]);
  });
});

Deno.test("updateIssueLabels removes and adds labels", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready", "P1"]);
    await client.updateIssueLabels(1, ["ready"], ["review"]);
    const labels = await client.getIssueLabels(1);
    assertEquals(labels, ["P1", "review"]);
  });
});

Deno.test("updateIssueLabels no-op when empty arrays", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"]);
    await client.updateIssueLabels(1, [], []);
    const labels = await client.getIssueLabels(1);
    assertEquals(labels, ["ready"]);
  });
});

Deno.test("updateIssueLabels does not add duplicates", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"]);
    await client.updateIssueLabels(1, [], ["ready"]);
    const labels = await client.getIssueLabels(1);
    assertEquals(labels, ["ready"]);
  });
});

Deno.test("listIssues returns all open issues by default", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"], "open");
    await seedIssue(store, 2, ["done"], "open");
    await seedIssue(store, 3, ["archived"], "closed");
    const items = await client.listIssues({});
    assertEquals(items.length, 2);
    assertEquals(items[0].number, 1);
    assertEquals(items[1].number, 2);
  });
});

Deno.test("listIssues filters by state", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"], "open");
    await seedIssue(store, 2, ["done"], "closed");
    const closed = await client.listIssues({ state: "closed" });
    assertEquals(closed.length, 1);
    assertEquals(closed[0].number, 2);

    const all = await client.listIssues({ state: "all" });
    assertEquals(all.length, 2);
  });
});

Deno.test("listIssues filters by labels", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready", "P1"]);
    await seedIssue(store, 2, ["ready", "P2"]);
    await seedIssue(store, 3, ["done"]);
    const items = await client.listIssues({ labels: ["ready"] });
    assertEquals(items.length, 2);

    const p1Only = await client.listIssues({ labels: ["ready", "P1"] });
    assertEquals(p1Only.length, 1);
    assertEquals(p1Only[0].number, 1);
  });
});

Deno.test("listIssues respects limit", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"]);
    await seedIssue(store, 2, ["ready"]);
    await seedIssue(store, 3, ["ready"]);
    const items = await client.listIssues({ limit: 2 });
    assertEquals(items.length, 2);
  });
});

Deno.test("createIssue auto-numbers from max existing + 1", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 5, ["ready"]);
    await seedIssue(store, 10, ["ready"]);
    const num = await client.createIssue("New issue", ["bug"], "Body text");
    assertEquals(num, 11);
    const labels = await client.getIssueLabels(11);
    assertEquals(labels, ["bug"]);
  });
});

Deno.test("createIssue starts at 1 when store is empty", async () => {
  await withTempStore(async (_store, client) => {
    const num = await client.createIssue("First", [], "Body");
    assertEquals(num, 1);
  });
});

Deno.test("closeIssue updates state to closed", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"], "open");
    await client.closeIssue(1);
    const meta = await store.readMeta(1);
    assertEquals(meta.state, "closed");
  });
});

Deno.test("addIssueComment creates a comment file", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"]);
    await client.addIssueComment(1, "Test comment");
    const comments = await store.readComments(1);
    assertEquals(comments.length, 1);
    assertEquals(comments[0].body, "Test comment");
  });
});

Deno.test("getIssueDetail assembles full issue data", async () => {
  await withTempStore(async (store, client) => {
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["ready"],
        state: "open",
        assignees: ["alice"],
        milestone: "v1",
      },
      body: "Issue body",
      comments: [{ id: "001", body: "Comment 1" }],
    });
    const detail = await client.getIssueDetail(1);
    assertEquals(detail.number, 1);
    assertEquals(detail.title, "Test");
    assertEquals(detail.body, "Issue body");
    assertEquals(detail.labels, ["ready"]);
    assertEquals(detail.assignees, ["alice"]);
    assertEquals(detail.milestone, "v1");
    assertEquals(detail.comments.length, 1);
    assertEquals(detail.comments[0].body, "Comment 1");
  });
});

Deno.test("getIssueDetail handles missing comments dir", async () => {
  await withTempStore(async (_store, client) => {
    const tmp = await Deno.makeTempDir();
    const store2 = new SubjectStore(`${tmp}/issues`);
    const client2 = new FileGitHubClient(store2);
    // Write meta and body manually without comments dir
    await Deno.mkdir(`${tmp}/issues/1`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/issues/1/meta.json`,
      JSON.stringify({
        number: 1,
        title: "No comments",
        labels: [],
        state: "open",
        assignees: [],
        milestone: null,
      }),
    );
    await Deno.writeTextFile(`${tmp}/issues/1/body.md`, "Body");
    const detail = await client2.getIssueDetail(1);
    assertEquals(detail.comments, []);
    await Deno.remove(tmp, { recursive: true });
  });
});

Deno.test("getIssueLabels rejects for missing issue", async () => {
  await withTempStore(async (_store, client) => {
    await assertRejects(
      () => client.getIssueLabels(999),
      Deno.errors.NotFound,
    );
  });
});

// ---------------------------------------------------------------------------
// getProjectItemIdForIssue
// ---------------------------------------------------------------------------

Deno.test("getProjectItemIdForIssue returns item ID for existing issue", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    // Add an issue to project first
    const itemId = await client.addIssueToProject(project, 42);
    // Resolve it back
    const resolved = await client.getProjectItemIdForIssue(project, 42);
    assertEquals(resolved, itemId);
  });
});

Deno.test("getProjectItemIdForIssue returns null for non-member issue", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    // Add a different issue
    await client.addIssueToProject(project, 10);
    // Query for issue not in project
    const resolved = await client.getProjectItemIdForIssue(project, 99);
    assertEquals(resolved, null);
  });
});

Deno.test("getProjectItemIdForIssue returns null for empty project", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 5 };
    const resolved = await client.getProjectItemIdForIssue(project, 1);
    assertEquals(resolved, null);
  });
});

// ---------------------------------------------------------------------------
// listProjectItems
// ---------------------------------------------------------------------------

Deno.test("listProjectItems returns all items in project", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    await client.addIssueToProject(project, 10);
    await client.addIssueToProject(project, 20);
    await client.addIssueToProject(project, 30);
    const items = await client.listProjectItems(project);
    assertEquals(items.length, 3);
    const issueNumbers = items.map((i) => i.issueNumber).sort((a, b) => a - b);
    assertEquals(issueNumbers, [10, 20, 30]);
    // Each item has an id
    for (const item of items) {
      assertEquals(typeof item.id, "string");
    }
  });
});

Deno.test("listProjectItems returns empty array for empty project", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 99 };
    const items = await client.listProjectItems(project);
    assertEquals(items, []);
  });
});

Deno.test("listProjectItems isolates items between projects", async () => {
  await withTempStore(async (_store, client) => {
    const projectA = { owner: "org", number: 1 };
    const projectB = { owner: "org", number: 2 };
    await client.addIssueToProject(projectA, 10);
    await client.addIssueToProject(projectB, 20);
    const itemsA = await client.listProjectItems(projectA);
    assertEquals(itemsA.length, 1);
    assertEquals(itemsA[0].issueNumber, 10);
    const itemsB = await client.listProjectItems(projectB);
    assertEquals(itemsB.length, 1);
    assertEquals(itemsB[0].issueNumber, 20);
  });
});

// ---------------------------------------------------------------------------
// getIssueProjects
// ---------------------------------------------------------------------------

Deno.test("getIssueProjects returns empty array when no projects exist", async () => {
  await withTempStore(async (_store, client) => {
    const projects = await client.getIssueProjects(1);
    assertEquals(projects, []);
  });
});

Deno.test("getIssueProjects returns project when issue is a member", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    await client.addIssueToProject(project, 10);
    const projects = await client.getIssueProjects(10);
    assertEquals(projects.length, 1);
    assertEquals(projects[0].owner, "org");
    assertEquals(projects[0].number, 1);
  });
});

Deno.test("getIssueProjects returns multiple projects", async () => {
  await withTempStore(async (_store, client) => {
    const projectA = { owner: "org", number: 1 };
    const projectB = { owner: "org", number: 2 };
    await client.addIssueToProject(projectA, 10);
    await client.addIssueToProject(projectB, 10);
    const projects = await client.getIssueProjects(10);
    assertEquals(projects.length, 2);
    const numbers = projects.map((p) => p.number).sort((a, b) => a - b);
    assertEquals(numbers, [1, 2]);
  });
});

Deno.test("getIssueProjects excludes projects where issue is not a member", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    await client.addIssueToProject(project, 10);
    const projects = await client.getIssueProjects(20);
    assertEquals(projects, []);
  });
});

// ---------------------------------------------------------------------------
// createProjectFieldOption
// ---------------------------------------------------------------------------

Deno.test("createProjectFieldOption creates and returns new option", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    const result = await client.createProjectFieldOption(
      project,
      "FIELD_1",
      "Blocked",
      "RED",
    );
    assertEquals(result.name, "Blocked");
    assertEquals(typeof result.id, "string");
  });
});

Deno.test("createProjectFieldOption is idempotent for same name", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    const first = await client.createProjectFieldOption(
      project,
      "FIELD_1",
      "Blocked",
    );
    const second = await client.createProjectFieldOption(
      project,
      "FIELD_1",
      "Blocked",
    );
    assertEquals(first.id, second.id);
    assertEquals(first.name, second.name);
  });
});

Deno.test("createProjectFieldOption stores distinct options for different names", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    const blocked = await client.createProjectFieldOption(
      project,
      "FIELD_1",
      "Blocked",
    );
    const review = await client.createProjectFieldOption(
      project,
      "FIELD_1",
      "In Review",
    );
    assertEquals(blocked.name, "Blocked");
    assertEquals(review.name, "In Review");
    // Different IDs
    assertEquals(blocked.id !== review.id, true);
  });
});

// ---------------------------------------------------------------------------
// listUserProjects
// ---------------------------------------------------------------------------

Deno.test("listUserProjects returns empty when no projects exist", async () => {
  await withTempStore(async (_store, client) => {
    const projects = await client.listUserProjects("org");
    assertEquals(projects, []);
  });
});

Deno.test("listUserProjects returns projects for matching owner", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    await client.addIssueToProject(project, 10);
    const projects = await client.listUserProjects("org");
    assertEquals(projects.length, 1);
    assertEquals(projects[0].owner, "org");
    assertEquals(projects[0].number, 1);
    assertEquals(projects[0].closed, false);
  });
});

Deno.test("listUserProjects excludes other owners", async () => {
  await withTempStore(async (_store, client) => {
    await client.addIssueToProject({ owner: "org", number: 1 }, 10);
    await client.addIssueToProject({ owner: "other", number: 2 }, 20);
    const projects = await client.listUserProjects("org");
    assertEquals(projects.length, 1);
    assertEquals(projects[0].owner, "org");
  });
});

Deno.test("listUserProjects detects closed projects", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 3 };
    await client.addIssueToProject(project, 10);
    await client.closeProject(project);
    const projects = await client.listUserProjects("org");
    assertEquals(projects.length, 1);
    assertEquals(projects[0].closed, true);
  });
});

// ---------------------------------------------------------------------------
// getProject
// ---------------------------------------------------------------------------

Deno.test("getProject returns project metadata", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    await client.addIssueToProject(project, 10);
    const result = await client.getProject(project);
    assertEquals(result.owner, "org");
    assertEquals(result.number, 1);
    assertEquals(result.closed, false);
    assertEquals(result.readme, "");
  });
});

Deno.test("getProject reads readme when present", async () => {
  await withTempStore(async (store, client) => {
    const project = { owner: "org", number: 1 };
    await client.addIssueToProject(project, 10);
    const projectDir = `${store.storePath}/projects/org_1`;
    await Deno.writeTextFile(`${projectDir}/readme.md`, "Project goals");
    const result = await client.getProject(project);
    assertEquals(result.readme, "Project goals");
  });
});

Deno.test("getProject detects closed state", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    await client.addIssueToProject(project, 10);
    await client.closeProject(project);
    const result = await client.getProject(project);
    assertEquals(result.closed, true);
  });
});

// ---------------------------------------------------------------------------
// getProjectFields
// ---------------------------------------------------------------------------

Deno.test("getProjectFields returns empty when no fields file exists", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    const fields = await client.getProjectFields(project);
    assertEquals(fields, []);
  });
});

Deno.test("getProjectFields reads fields from fields.json", async () => {
  await withTempStore(async (store, client) => {
    const project = { owner: "org", number: 1 };
    const projectDir = `${store.storePath}/projects/org_1`;
    await Deno.mkdir(projectDir, { recursive: true });
    const fieldsData = [
      {
        id: "F1",
        name: "Status",
        type: "single_select",
        options: [{ id: "O1", name: "Todo" }],
      },
      { id: "F2", name: "Priority", type: "number" },
    ];
    await Deno.writeTextFile(
      `${projectDir}/fields.json`,
      JSON.stringify(fieldsData),
    );
    const fields = await client.getProjectFields(project);
    assertEquals(fields.length, 2);
    assertEquals(fields[0].name, "Status");
    assertEquals(fields[0].type, "single_select");
    assertEquals(fields[0].options?.length, 1);
    assertEquals(fields[0].options?.[0].name, "Todo");
    assertEquals(fields[1].name, "Priority");
    assertEquals(fields[1].options, undefined);
  });
});

// ---------------------------------------------------------------------------
// removeProjectItem
// ---------------------------------------------------------------------------

Deno.test("removeProjectItem removes item from project", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    const itemId = await client.addIssueToProject(project, 10);
    await client.addIssueToProject(project, 20);
    await client.removeProjectItem(project, itemId);
    const items = await client.listProjectItems(project);
    assertEquals(items.length, 1);
    assertEquals(items[0].issueNumber, 20);
  });
});

Deno.test("removeProjectItem throws for non-existent item", async () => {
  await withTempStore(async (_store, client) => {
    const project = { owner: "org", number: 1 };
    await client.addIssueToProject(project, 10);
    await assertRejects(
      () => client.removeProjectItem(project, "PVTI_nonexistent"),
      Error,
      "Project item PVTI_nonexistent not found",
    );
  });
});
