/**
 * OutboxProcessor inter-action state container tests (issue #510).
 *
 * Validates `prevResultByFamily: Map<string, ActionResult>` behaviour:
 * - Same family: second action reads first action's result.
 * - Cross-family: isolated (no cross-family reads).
 * - Container cleared between process() calls.
 * - Legacy (v1.13.x) file format uses global #lastCreatedIssueNumber.
 * - Multiple independent families process correctly.
 */

import { assertEquals } from "jsr:@std/assert";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  LabelDetail,
  Project,
  ProjectField,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { SubjectStore } from "./subject-store.ts";

// ---------------------------------------------------------------------------
// Spy GitHub client
// ---------------------------------------------------------------------------
class SpyGitHubClient implements GitHubClient {
  calls: { method: string; args: unknown[] }[] = [];
  #nextIssueNumber = 100;

  async getIssueLabels(_subjectId: number): Promise<string[]> {
    return await Promise.resolve([]);
  }
  async updateIssueLabels(
    subjectId: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.calls.push({
      method: "updateIssueLabels",
      args: [subjectId, labelsToRemove, labelsToAdd],
    });
    await Promise.resolve();
  }
  async addIssueComment(subjectId: number, comment: string): Promise<void> {
    this.calls.push({
      method: "addIssueComment",
      args: [subjectId, comment],
    });
    await Promise.resolve();
  }
  async createIssue(
    title: string,
    labels: string[],
    body: string,
  ): Promise<number> {
    const num = this.#nextIssueNumber++;
    this.calls.push({ method: "createIssue", args: [title, labels, body] });
    return await Promise.resolve(num);
  }
  async closeIssue(subjectId: number): Promise<void> {
    this.calls.push({ method: "closeIssue", args: [subjectId] });
    await Promise.resolve();
  }
  reopenIssue(_subjectId: number): Promise<void> {
    return Promise.reject(new Error("not implemented"));
  }
  getRecentComments(
    _subjectId: number,
    _limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }
  async listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return await Promise.resolve([]);
  }
  async getIssueDetail(_subjectId: number): Promise<IssueDetail> {
    return await Promise.resolve({
      number: 0,
      title: "",
      body: "",
      labels: [],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });
  }
  async listLabels(): Promise<string[]> {
    return await Promise.resolve([]);
  }
  async listLabelsDetailed(): Promise<LabelDetail[]> {
    return await Promise.resolve([]);
  }
  async createLabel(
    _name: string,
    _color: string,
    _description: string,
  ): Promise<void> {
    await Promise.resolve();
  }
  async updateLabel(
    _name: string,
    _color: string,
    _description: string,
  ): Promise<void> {
    await Promise.resolve();
  }
  async addIssueToProject(
    project: ProjectRef,
    issueNumber: number,
  ): Promise<string> {
    this.calls.push({
      method: "addIssueToProject",
      args: [project, issueNumber],
    });
    return await Promise.resolve(`PVTI_${issueNumber}`);
  }
  async updateProjectItemField(
    project: ProjectRef,
    itemId: string,
    fieldId: string,
    value: ProjectFieldValue,
  ): Promise<void> {
    this.calls.push({
      method: "updateProjectItemField",
      args: [project, itemId, fieldId, value],
    });
    await Promise.resolve();
  }
  async closeProject(project: ProjectRef): Promise<void> {
    this.calls.push({ method: "closeProject", args: [project] });
    await Promise.resolve();
  }
  async getProjectItemIdForIssue(
    project: ProjectRef,
    issueNumber: number,
  ): Promise<string | null> {
    this.calls.push({
      method: "getProjectItemIdForIssue",
      args: [project, issueNumber],
    });
    return await Promise.resolve(`PVTI_${issueNumber}`);
  }
  async listProjectItems(
    project: ProjectRef,
  ): Promise<{ id: string; issueNumber: number }[]> {
    this.calls.push({
      method: "listProjectItems",
      args: [project],
    });
    return await Promise.resolve([]);
  }
  async createProjectFieldOption(
    project: ProjectRef,
    fieldId: string,
    name: string,
    _color?: string,
  ): Promise<{ id: string; name: string }> {
    this.calls.push({
      method: "createProjectFieldOption",
      args: [project, fieldId, name],
    });
    return await Promise.resolve({ id: `OPT_${name}`, name });
  }
  getIssueProjects(
    _issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>> {
    return Promise.resolve([]);
  }
  async listUserProjects(_owner: string): Promise<Project[]> {
    return await Promise.resolve([]);
  }
  async getProject(_project: ProjectRef): Promise<Project> {
    return await Promise.resolve({
      id: "PVT_stub",
      number: 0,
      owner: "",
      title: "",
      readme: "",
      shortDescription: null,
      closed: false,
    });
  }
  async getProjectFields(_project: ProjectRef): Promise<ProjectField[]> {
    return await Promise.resolve([]);
  }
  async removeProjectItem(
    _project: ProjectRef,
    _itemId: string,
  ): Promise<void> {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function setupStore(
  subjectId: number,
): Promise<{ store: SubjectStore; tmp: string }> {
  const tmp = await Deno.makeTempDir();
  const store = new SubjectStore(tmp);
  const outboxDir = store.getOutboxPath(subjectId);
  await Deno.mkdir(outboxDir, { recursive: true });
  return { store, tmp };
}

async function writeAction(
  store: SubjectStore,
  subjectId: number,
  filename: string,
  action: Record<string, unknown>,
): Promise<void> {
  const outboxDir = store.getOutboxPath(subjectId);
  await Deno.writeTextFile(
    `${outboxDir}/${filename}`,
    JSON.stringify(action),
  );
}

// ===========================================================================
// Same-family: second action reads first's result
// ===========================================================================

Deno.test("family state: add-to-project reads create-issue result in same family", async () => {
  const { store, tmp } = await setupStore(500);
  try {
    // Family "000": create-issue followed by add-to-project
    await writeAction(store, 500, "000-deferred-000-0-create-issue.json", {
      action: "create-issue",
      title: "Family child",
      labels: ["kind:impl"],
      body: "body",
    });
    await writeAction(store, 500, "000-deferred-000-1-add-to-project.json", {
      action: "add-to-project",
      project: { owner: "testorg", number: 1 },
      // issueNumber absent — should resolve from family "000" map
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(500);

    assertEquals(results.length, 2);
    assertEquals(results[0].action, "create-issue");
    assertEquals(results[0].success, true);
    assertEquals(results[1].action, "add-to-project");
    assertEquals(results[1].success, true);

    // Verify addIssueToProject received the newly created issue number
    const addCall = github.calls.find((c) => c.method === "addIssueToProject");
    assertEquals(
      addCall !== undefined,
      true,
      "addIssueToProject should be called",
    );
    assertEquals(
      addCall!.args[1],
      100,
      "should use issue number from same-family create-issue",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ===========================================================================
// Cross-family: isolated (no cross-family reads)
// ===========================================================================

Deno.test("family state: cross-family add-to-project cannot read other family's result", async () => {
  const { store, tmp } = await setupStore(501);
  try {
    // Family "000": create-issue
    await writeAction(store, 501, "000-deferred-000-0-create-issue.json", {
      action: "create-issue",
      title: "Family A child",
      labels: [],
      body: "a",
    });
    // Family "001": add-to-project (no create-issue in this family)
    await writeAction(store, 501, "000-deferred-001-1-add-to-project.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
      // issueNumber absent — family "001" has no create-issue, should fail
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(501);

    assertEquals(results.length, 2);
    assertEquals(results[0].action, "create-issue");
    assertEquals(results[0].success, true);
    assertEquals(results[1].action, "add-to-project");
    assertEquals(
      results[1].success,
      false,
      "cross-family add-to-project should fail",
    );
    assertEquals(
      results[1].error!.includes("late-binding"),
      true,
      "error should mention late-binding",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ===========================================================================
// Container cleared between process() calls
// ===========================================================================

Deno.test("family state: container cleared between process() calls", async () => {
  const { store, tmp } = await setupStore(502);
  try {
    // First cycle: create-issue in family "000"
    await writeAction(store, 502, "000-deferred-000-0-create-issue.json", {
      action: "create-issue",
      title: "First cycle",
      labels: [],
      body: "body",
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    await processor.process(502);

    // Second cycle: add-to-project in family "000" (create-issue was consumed)
    await writeAction(store, 502, "000-deferred-000-1-add-to-project.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
    });

    const results = await processor.process(502);

    assertEquals(results.length, 1);
    assertEquals(
      results[0].success,
      false,
      "family map should be cleared between cycles",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ===========================================================================
// Legacy (v1.13.x) file format: uses global #lastCreatedIssueNumber
// ===========================================================================

Deno.test("family state: legacy format (no suffix) uses global late-binding", async () => {
  const { store, tmp } = await setupStore(503);
  try {
    // v1.13.x naming: 000-deferred-NNN.json (no family suffix)
    await writeAction(store, 503, "000-deferred-000.json", {
      action: "create-issue",
      title: "Legacy child",
      labels: [],
      body: "body",
    });
    await writeAction(store, 503, "000-deferred-001.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
      // issueNumber absent — legacy mode uses global #lastCreatedIssueNumber
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(503);

    assertEquals(results.length, 2);
    assertEquals(results[0].success, true);
    assertEquals(
      results[1].success,
      true,
      "legacy format should use global late-binding",
    );

    const addCall = github.calls.find((c) => c.method === "addIssueToProject");
    assertEquals(
      addCall!.args[1],
      100,
      "should use issue number from global state",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ===========================================================================
// Multiple independent families
// ===========================================================================

Deno.test("family state: multiple families independently resolve", async () => {
  const { store, tmp } = await setupStore(504);
  try {
    // Family "000": create + bind
    await writeAction(store, 504, "000-deferred-000-0-create-issue.json", {
      action: "create-issue",
      title: "Family A",
      labels: [],
      body: "a",
    });
    await writeAction(store, 504, "000-deferred-000-1-add-to-project.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
    });
    // Family "001": create + bind
    await writeAction(store, 504, "000-deferred-001-0-create-issue.json", {
      action: "create-issue",
      title: "Family B",
      labels: [],
      body: "b",
    });
    await writeAction(store, 504, "000-deferred-001-1-add-to-project.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(504);

    assertEquals(results.length, 4);
    assertEquals(
      results.every((r) => r.success),
      true,
      "all 4 actions should succeed",
    );

    // Verify each family got the correct issue number
    const addCalls = github.calls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(addCalls.length, 2);
    assertEquals(addCalls[0].args[1], 100, "family 000 should use issue 100");
    assertEquals(addCalls[1].args[1], 101, "family 001 should use issue 101");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ===========================================================================
// Explicit issueNumber still overrides family lookup
// ===========================================================================

Deno.test("family state: explicit issueNumber overrides family lookup", async () => {
  const { store, tmp } = await setupStore(505);
  try {
    await writeAction(store, 505, "000-deferred-000-0-create-issue.json", {
      action: "create-issue",
      title: "Child",
      labels: [],
      body: "body",
    });
    await writeAction(store, 505, "000-deferred-000-1-add-to-project.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
      issueNumber: 42, // explicit — should NOT use family map
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(505);

    assertEquals(results.length, 2);
    assertEquals(results.every((r) => r.success), true);

    const addCall = github.calls.find((c) => c.method === "addIssueToProject");
    assertEquals(
      addCall!.args[1],
      42,
      "explicit issueNumber overrides family lookup",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
