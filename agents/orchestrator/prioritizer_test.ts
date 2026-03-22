import { assertEquals, assertRejects } from "jsr:@std/assert";
import { Prioritizer } from "./prioritizer.ts";
import type { PrioritizerConfig } from "./prioritizer.ts";
import { IssueStore } from "./issue-store.ts";
import { StubDispatcher } from "./dispatcher.ts";

// === Helpers ===

function makeConfig(
  overrides?: Partial<PrioritizerConfig>,
): PrioritizerConfig {
  return {
    agent: "prioritizer-agent",
    labels: ["P1", "P2", "P3"],
    ...overrides,
  };
}

async function writePrioritiesFile(
  storePath: string,
  data: Array<{ issue: number; priority: string }>,
): Promise<void> {
  await Deno.writeTextFile(
    `${storePath}/priorities.json`,
    JSON.stringify(data),
  );
}

function makeIssueData(number: number): {
  meta: {
    number: number;
    title: string;
    labels: string[];
    state: string;
    assignees: string[];
    milestone: null;
  };
  body: string;
  comments: [];
} {
  return {
    meta: {
      number,
      title: `Issue ${number}`,
      labels: ["ready"],
      state: "open",
      assignees: [],
      milestone: null,
    },
    body: "test",
    comments: [],
  };
}

// === Tests ===

Deno.test("run dispatches correct agent", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig();

    await store.writeIssue(makeIssueData(1));
    await writePrioritiesFile(tmp, [{ issue: 1, priority: "P1" }]);

    const prioritizer = new Prioritizer(config, store, dispatcher);
    await prioritizer.run();

    assertEquals(dispatcher.callCount, 1);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("run reads and parses priorities.json", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig();

    await store.writeIssue(makeIssueData(1));
    await store.writeIssue(makeIssueData(2));
    await writePrioritiesFile(tmp, [
      { issue: 1, priority: "P1" },
      { issue: 2, priority: "P3" },
    ]);

    const prioritizer = new Prioritizer(config, store, dispatcher);
    const result = await prioritizer.run();

    assertEquals(result.assignments.length, 2);
    assertEquals(result.assignments[0], { issue: 1, priority: "P1" });
    assertEquals(result.assignments[1], { issue: 2, priority: "P3" });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("run validates priority labels", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig();

    await store.writeIssue(makeIssueData(1));
    await writePrioritiesFile(tmp, [
      { issue: 1, priority: "P2" },
    ]);

    const prioritizer = new Prioritizer(config, store, dispatcher);
    const result = await prioritizer.run();

    assertEquals(result.assignments.length, 1);
    assertEquals(result.assignments[0].priority, "P2");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("run rejects invalid priority label", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig();

    await store.writeIssue(makeIssueData(5));
    await writePrioritiesFile(tmp, [
      { issue: 5, priority: "CRITICAL" },
    ]);

    const prioritizer = new Prioritizer(config, store, dispatcher);
    await assertRejects(
      () => prioritizer.run(),
      Error,
      'Invalid priority "CRITICAL"',
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("run applies defaultLabel for invalid priority", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig({ defaultLabel: "P3" });

    await store.writeIssue(makeIssueData(7));
    await writePrioritiesFile(tmp, [
      { issue: 7, priority: "UNKNOWN" },
    ]);

    const prioritizer = new Prioritizer(config, store, dispatcher);
    const result = await prioritizer.run();

    assertEquals(result.assignments.length, 1);
    assertEquals(result.assignments[0], { issue: 7, priority: "P3" });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("run with empty store returns empty without dispatch", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig();

    // Store is empty - no issues written
    const prioritizer = new Prioritizer(config, store, dispatcher);
    const result = await prioritizer.run();

    assertEquals(result.assignments.length, 0);
    assertEquals(dispatcher.callCount, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("run throws descriptive error when priorities.json not found", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig();

    // Write an issue so store is not empty, but don't create priorities.json
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Issue 1",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    const prioritizer = new Prioritizer(config, store, dispatcher);
    await assertRejects(
      () => prioritizer.run(),
      Error,
      "did not produce",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("run writes issue-list.json before dispatch", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig();

    // Write issues to store
    await store.writeIssue({
      meta: {
        number: 5,
        title: "Issue 5",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });
    await store.writeIssue({
      meta: {
        number: 10,
        title: "Issue 10",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    // Write priorities.json so run() completes
    await writePrioritiesFile(tmp, [
      { issue: 5, priority: "P1" },
      { issue: 10, priority: "P2" },
    ]);

    const prioritizer = new Prioritizer(config, store, dispatcher);
    await prioritizer.run();

    // Verify issue-list.json was written
    const issueListText = await Deno.readTextFile(`${tmp}/issue-list.json`);
    const issueList = JSON.parse(issueListText) as number[];
    assertEquals(issueList.includes(5), true);
    assertEquals(issueList.includes(10), true);
    assertEquals(issueList.length, 2);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
