import { assertEquals, assertNotEquals } from "@std/assert";
import { CycleTracker } from "./cycle-tracker.ts";

Deno.test("record adds a transition", () => {
  const tracker = new CycleTracker(5);
  tracker.record(1, "implementation", "review", "iterator", "success");
  assertEquals(tracker.getCount(1), 1);
});

Deno.test("getCount returns correct count", () => {
  const tracker = new CycleTracker(5);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(1, "review", "revision", "reviewer", "rejected");
  tracker.record(1, "revision", "review", "iterator", "success");
  assertEquals(tracker.getCount(1), 3);
});

Deno.test("getCount returns 0 for unknown issue", () => {
  const tracker = new CycleTracker(5);
  assertEquals(tracker.getCount(999), 0);
});

Deno.test("isExceeded returns false under limit", () => {
  const tracker = new CycleTracker(3);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(1, "review", "revision", "reviewer", "rejected");
  assertEquals(tracker.isExceeded(1), false);
});

Deno.test("isExceeded returns true at limit", () => {
  const tracker = new CycleTracker(2);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(1, "review", "revision", "reviewer", "rejected");
  assertEquals(tracker.isExceeded(1), true);
});

Deno.test("isExceeded returns true over limit", () => {
  const tracker = new CycleTracker(2);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(1, "review", "revision", "reviewer", "rejected");
  tracker.record(1, "revision", "review", "iterator", "success");
  assertEquals(tracker.isExceeded(1), true);
});

Deno.test("getHistory returns records in order", () => {
  const tracker = new CycleTracker(5);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(1, "review", "revision", "reviewer", "rejected");
  const history = tracker.getHistory(1);
  assertEquals(history.length, 2);
  assertEquals(history[0].from, "implementation");
  assertEquals(history[0].to, "review");
  assertEquals(history[1].from, "review");
  assertEquals(history[1].to, "revision");
});

Deno.test("getHistory returns empty array for unknown issue", () => {
  const tracker = new CycleTracker(5);
  assertEquals(tracker.getHistory(999), []);
});

Deno.test("getHistory returns a copy - mutations do not affect internal state", () => {
  const tracker = new CycleTracker(5);
  tracker.record(1, "implementation", "review", "iterator", "success");

  const history = tracker.getHistory(1);
  history[0].from = "mutated";
  history.push({
    from: "fake",
    to: "fake",
    agent: "fake",
    outcome: "fake",
    timestamp: "fake",
  });

  const historyAgain = tracker.getHistory(1);
  assertEquals(historyAgain.length, 1);
  assertEquals(historyAgain[0].from, "implementation");
});

Deno.test("multiple issues tracked independently", () => {
  const tracker = new CycleTracker(5);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(2, "review", "revision", "reviewer", "rejected");
  tracker.record(1, "review", "revision", "reviewer", "rejected");

  assertEquals(tracker.getCount(1), 2);
  assertEquals(tracker.getCount(2), 1);

  const history1 = tracker.getHistory(1);
  assertEquals(history1[0].from, "implementation");
  assertEquals(history1[1].from, "review");

  const history2 = tracker.getHistory(2);
  assertEquals(history2.length, 1);
  assertEquals(history2[0].from, "review");
});

Deno.test("generateCorrelationId format matches pattern", () => {
  const tracker = new CycleTracker(5);
  const id = tracker.generateCorrelationId("iterator");
  const pattern = /^wf-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-iterator$/;
  assertEquals(
    pattern.test(id),
    true,
    `ID "${id}" does not match expected pattern`,
  );
});

Deno.test("generateCorrelationId includes agent name", () => {
  const tracker = new CycleTracker(5);
  const id = tracker.generateCorrelationId("reviewer");
  assertEquals(id.endsWith("-reviewer"), true);
});

Deno.test("generateCorrelationId is unique across calls", async () => {
  const tracker = new CycleTracker(5);
  const id1 = tracker.generateCorrelationId("iterator");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const id2 = tracker.generateCorrelationId("iterator");
  assertNotEquals(id1, id2);
});
