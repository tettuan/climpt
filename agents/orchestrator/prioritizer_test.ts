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

// === Tests ===

Deno.test("run dispatches correct agent", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const dispatcher = new StubDispatcher();
    const config = makeConfig();

    await writePrioritiesFile(tmp, []);

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
