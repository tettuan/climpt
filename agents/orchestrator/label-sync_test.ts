/**
 * Tests for agents/orchestrator/label-sync.ts
 *
 * Covers decideLabelAction (pure decision), syncLabels (create /
 * update / nochange / failed), dryRun behaviour, and summarizeSync.
 *
 * Design: a stub GitHubClient implements only the subset of methods
 * label-sync touches (`listLabelsDetailed`, `createLabel`,
 * `updateLabel`). Every other method throws to make leaks surface
 * loudly.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  decideLabelAction,
  summarizeSync,
  syncLabels,
  type SyncResult,
} from "./label-sync.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  LabelDetail,
} from "./github-client.ts";
import type { LabelSpec } from "./workflow-types.ts";

// =============================================================================
// Stub GitHubClient
// =============================================================================

interface StubOptions {
  initial: LabelDetail[];
  createFailures?: Set<string>;
  updateFailures?: Set<string>;
  listFails?: string;
}

function makeStub(options: StubOptions): {
  github: GitHubClient;
  creates: string[];
  updates: string[];
} {
  const state = new Map<string, LabelDetail>();
  for (const l of options.initial) {
    state.set(l.name, { ...l });
  }
  const creates: string[] = [];
  const updates: string[] = [];

  const github: GitHubClient = {
    async listLabelsDetailed(): Promise<LabelDetail[]> {
      if (options.listFails !== undefined) {
        throw new Error(options.listFails);
      }
      return await Promise.resolve([...state.values()]);
    },
    createLabel(name, color, description): Promise<void> {
      if (options.createFailures?.has(name)) {
        return Promise.reject(new Error(`create refused for ${name}`));
      }
      state.set(name, { name, color, description });
      creates.push(name);
      return Promise.resolve();
    },
    updateLabel(name, color, description): Promise<void> {
      if (options.updateFailures?.has(name)) {
        return Promise.reject(new Error(`update refused for ${name}`));
      }
      state.set(name, { name, color, description });
      updates.push(name);
      return Promise.resolve();
    },
    // Unused methods — throw on any accidental call.
    getIssueLabels(): Promise<string[]> {
      throw new Error("unexpected: getIssueLabels");
    },
    updateIssueLabels(): Promise<void> {
      throw new Error("unexpected: updateIssueLabels");
    },
    addIssueComment(): Promise<void> {
      throw new Error("unexpected: addIssueComment");
    },
    createIssue(): Promise<number> {
      throw new Error("unexpected: createIssue");
    },
    closeIssue(): Promise<void> {
      throw new Error("unexpected: closeIssue");
    },
    reopenIssue(): Promise<void> {
      throw new Error("unexpected: reopenIssue");
    },
    listIssues(_: IssueCriteria): Promise<IssueListItem[]> {
      throw new Error("unexpected: listIssues");
    },
    getIssueDetail(): Promise<IssueDetail> {
      throw new Error("unexpected: getIssueDetail");
    },
    getRecentComments(): Promise<{ body: string; createdAt: string }[]> {
      throw new Error("unexpected: getRecentComments");
    },
    listLabels(): Promise<string[]> {
      throw new Error("unexpected: listLabels");
    },
  };

  return { github, creates, updates };
}

// =============================================================================
// decideLabelAction
// =============================================================================

Deno.test("decideLabelAction: missing -> created", () => {
  const spec: LabelSpec = { color: "a2eeef", description: "d" };
  assertEquals(decideLabelAction(spec, undefined), "created");
});

Deno.test("decideLabelAction: exact match -> nochange", () => {
  const spec: LabelSpec = { color: "a2eeef", description: "d" };
  assertEquals(
    decideLabelAction(spec, { name: "x", color: "a2eeef", description: "d" }),
    "nochange",
  );
});

Deno.test("decideLabelAction: color differs -> updated", () => {
  const spec: LabelSpec = { color: "a2eeef", description: "d" };
  assertEquals(
    decideLabelAction(spec, { name: "x", color: "ffffff", description: "d" }),
    "updated",
  );
});

Deno.test("decideLabelAction: description differs -> updated", () => {
  const spec: LabelSpec = { color: "a2eeef", description: "new" };
  assertEquals(
    decideLabelAction(spec, { name: "x", color: "a2eeef", description: "old" }),
    "updated",
  );
});

Deno.test("decideLabelAction: color case-insensitive match -> nochange", () => {
  const spec: LabelSpec = { color: "A2EEEF", description: "d" };
  assertEquals(
    decideLabelAction(spec, { name: "x", color: "a2eeef", description: "d" }),
    "nochange",
  );
});

// =============================================================================
// syncLabels: per-label paths
// =============================================================================

Deno.test("syncLabels: creates missing labels", async () => {
  const { github, creates, updates } = makeStub({ initial: [] });
  const results = await syncLabels(github, {
    "kind:impl": { color: "a2eeef", description: "impl" },
  });
  assertEquals(results, [{ name: "kind:impl", action: "created" }]);
  assertEquals(creates, ["kind:impl"]);
  assertEquals(updates, []);
});

Deno.test("syncLabels: updates labels whose color or description drifted", async () => {
  const { github, creates, updates } = makeStub({
    initial: [{ name: "kind:impl", color: "ffffff", description: "old" }],
  });
  const results = await syncLabels(github, {
    "kind:impl": { color: "a2eeef", description: "impl" },
  });
  assertEquals(results, [{ name: "kind:impl", action: "updated" }]);
  assertEquals(creates, []);
  assertEquals(updates, ["kind:impl"]);
});

Deno.test("syncLabels: nochange when spec matches exactly", async () => {
  const { github, creates, updates } = makeStub({
    initial: [{ name: "kind:impl", color: "a2eeef", description: "impl" }],
  });
  const results = await syncLabels(github, {
    "kind:impl": { color: "a2eeef", description: "impl" },
  });
  assertEquals(results, [{ name: "kind:impl", action: "nochange" }]);
  assertEquals(creates, []);
  assertEquals(updates, []);
});

Deno.test("syncLabels: failed create is isolated, other labels continue", async () => {
  const { github, creates, updates } = makeStub({
    initial: [],
    createFailures: new Set(["kind:impl"]),
  });
  const results = await syncLabels(github, {
    "kind:impl": { color: "a2eeef", description: "impl" },
    "done": { color: "0e8a16", description: "done" },
  });
  assertEquals(results.length, 2);
  assertEquals(results[0].name, "kind:impl");
  assertEquals(results[0].action, "failed");
  assertStringIncludes(results[0].error ?? "", "create refused");
  assertEquals(results[1], { name: "done", action: "created" });
  // "done" still got created despite "kind:impl" failing.
  assertEquals(creates, ["done"]);
  assertEquals(updates, []);
});

Deno.test("syncLabels: failed update is isolated", async () => {
  const { github } = makeStub({
    initial: [{ name: "kind:impl", color: "ffffff", description: "old" }],
    updateFailures: new Set(["kind:impl"]),
  });
  const results = await syncLabels(github, {
    "kind:impl": { color: "a2eeef", description: "impl" },
  });
  assertEquals(results.length, 1);
  assertEquals(results[0].action, "failed");
  assertStringIncludes(results[0].error ?? "", "update refused");
});

Deno.test("syncLabels: preserves declaration order in results", async () => {
  const { github } = makeStub({ initial: [] });
  const results = await syncLabels(github, {
    "zeta": { color: "a2eeef", description: "z" },
    "alpha": { color: "a2eeef", description: "a" },
    "middle": { color: "a2eeef", description: "m" },
  });
  assertEquals(
    results.map((r) => r.name),
    ["zeta", "alpha", "middle"],
    "Results must follow insertion order, not sorted — tests depend on predictable output.",
  );
});

// =============================================================================
// syncLabels: dryRun
// =============================================================================

Deno.test("syncLabels: dryRun skips create and update calls", async () => {
  const { github, creates, updates } = makeStub({
    initial: [{ name: "stale", color: "ffffff", description: "old" }],
  });
  const results = await syncLabels(
    github,
    {
      "missing": { color: "a2eeef", description: "m" },
      "stale": { color: "a2eeef", description: "new" },
      "ok": { color: "a2eeef", description: "o" },
    },
    { dryRun: true },
  );

  assertEquals(results.length, 3);
  assertEquals(
    results.map((r) => r.action),
    ["created", "updated", "created"],
    "dryRun must still classify the intended action without actually applying it.",
  );
  // No side effects.
  assertEquals(creates, []);
  assertEquals(updates, []);
});

// =============================================================================
// syncLabels: baseline read failure propagates
// =============================================================================

Deno.test("syncLabels: listLabelsDetailed failure propagates to caller", async () => {
  const { github } = makeStub({
    initial: [],
    listFails: "token missing repo scope",
  });
  let caught: unknown;
  try {
    await syncLabels(github, {
      "any": { color: "a2eeef", description: "a" },
    });
  } catch (e) {
    caught = e;
  }
  if (!(caught instanceof Error)) {
    throw new Error("Expected Error, got: " + String(caught));
  }
  assertStringIncludes(caught.message, "token missing repo scope");
});

// =============================================================================
// summarizeSync
// =============================================================================

Deno.test("summarizeSync: reports all four action counts", () => {
  const results: SyncResult[] = [
    { name: "a", action: "created" },
    { name: "b", action: "created" },
    { name: "c", action: "updated" },
    { name: "d", action: "nochange" },
    { name: "e", action: "failed", error: "boom" },
  ];
  const summary = summarizeSync(results);
  assertStringIncludes(summary, "5 total");
  assertStringIncludes(summary, "created=2");
  assertStringIncludes(summary, "updated=1");
  assertStringIncludes(summary, "nochange=1");
  assertStringIncludes(summary, "failed=1");
});

Deno.test("summarizeSync: all-zero when empty", () => {
  const summary = summarizeSync([]);
  assertStringIncludes(summary, "0 total");
  assertStringIncludes(summary, "created=0");
});
