import { assertEquals, assertNotEquals } from "@std/assert";
import { CycleTracker } from "./cycle-tracker.ts";
import type { IssueWorkflowState } from "./workflow-types.ts";

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

// === toState / fromState ===

Deno.test("toState serializes tracker state correctly", () => {
  const tracker = new CycleTracker(5);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(1, "review", "complete", "reviewer", "approved");

  const state = tracker.toState(1, "complete");

  assertEquals(state.issueNumber, 1);
  assertEquals(state.currentPhase, "complete");
  assertEquals(state.cycleCount, 2);
  assertEquals(state.history.length, 2);
  assertEquals(state.history[0].from, "implementation");
  assertEquals(state.history[0].to, "review");
  assertEquals(state.history[1].from, "review");
  assertEquals(state.history[1].to, "complete");
  assertEquals(typeof state.correlationId, "string");
  assertEquals(state.correlationId.startsWith("wf-"), true);
});

Deno.test("toState for unknown issue returns empty state", () => {
  const tracker = new CycleTracker(5);
  const state = tracker.toState(999, "unknown");

  assertEquals(state.issueNumber, 999);
  assertEquals(state.currentPhase, "unknown");
  assertEquals(state.cycleCount, 0);
  assertEquals(state.history.length, 0);
});

Deno.test("fromState reconstructs tracker with existing history", () => {
  const tracker = new CycleTracker(5);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(1, "review", "revision", "reviewer", "rejected");

  const state = tracker.toState(1, "revision");
  const restored = CycleTracker.fromState(state, 5);

  assertEquals(restored.getCount(1), 2);
  assertEquals(restored.isExceeded(1), false);
  const history = restored.getHistory(1);
  assertEquals(history.length, 2);
  assertEquals(history[0].from, "implementation");
  assertEquals(history[1].from, "review");
});

Deno.test("fromState respects maxCycles for exceeded check", () => {
  const tracker = new CycleTracker(10);
  tracker.record(1, "implementation", "review", "iterator", "success");
  tracker.record(1, "review", "revision", "reviewer", "rejected");
  tracker.record(1, "revision", "review", "iterator", "success");

  const state = tracker.toState(1, "review");
  // Restore with lower maxCycles => should be exceeded
  const restored = CycleTracker.fromState(state, 3);

  assertEquals(restored.getCount(1), 3);
  assertEquals(restored.isExceeded(1), true);
});

Deno.test("fromState preserves persisted timestamps byte-for-byte", () => {
  const fixedTs1 = "2026-01-01T00:00:00.000Z";
  const fixedTs2 = "2026-01-01T00:01:00.000Z";
  const state: IssueWorkflowState = {
    issueNumber: 999,
    currentPhase: "implementation",
    cycleCount: 2,
    correlationId: "test-corr",
    history: [
      {
        from: "ready",
        to: "implementation",
        agent: "iterator",
        outcome: "in_progress",
        timestamp: fixedTs1,
      },
      {
        from: "implementation",
        to: "revision",
        agent: "reviewer",
        outcome: "needs-revision",
        timestamp: fixedTs2,
      },
    ],
  };
  const tracker = CycleTracker.fromState(state, 5);
  const history = tracker.getHistory(999);
  assertEquals(history.length, 2); // non-vacuity
  assertEquals(history[0].timestamp, fixedTs1);
  assertEquals(history[1].timestamp, fixedTs2);
});

Deno.test("fromState allows continued recording", () => {
  const tracker = new CycleTracker(5);
  tracker.record(1, "implementation", "review", "iterator", "success");

  const state = tracker.toState(1, "review");
  const restored = CycleTracker.fromState(state, 5);
  restored.record(1, "review", "complete", "reviewer", "approved");

  assertEquals(restored.getCount(1), 2);
  const history = restored.getHistory(1);
  assertEquals(history.length, 2);
  assertEquals(history[0].from, "implementation");
  assertEquals(history[1].from, "review");
  assertEquals(history[1].to, "complete");
});

// === L3: phase repetition limit ===

Deno.test("isPhaseRepetitionExceeded is disabled when maxConsecutivePhases is 0", () => {
  const tracker = new CycleTracker(100, 0);
  for (let i = 0; i < 10; i++) {
    tracker.record(1, "review", "revision", "iterator", "needs-revision");
  }
  assertEquals(tracker.isPhaseRepetitionExceeded(1), false);
  assertEquals(tracker.getConsecutiveCount(1), 10);
});

Deno.test(
  "isPhaseRepetitionExceeded trips exactly at limit with same consecutive to-phase",
  () => {
    const tracker = new CycleTracker(100, 3);
    tracker.record(
      1,
      "implementation",
      "revision",
      "iterator",
      "needs-revision",
    );
    tracker.record(1, "revision", "revision", "iterator", "needs-revision");
    tracker.record(1, "revision", "revision", "iterator", "needs-revision");
    assertEquals(tracker.isPhaseRepetitionExceeded(1), true);
    assertEquals(tracker.getConsecutiveCount(1), 3);
  },
);

Deno.test(
  "isPhaseRepetitionExceeded stays false when consecutive count is under the limit",
  () => {
    const tracker = new CycleTracker(100, 3);
    tracker.record(
      1,
      "implementation",
      "revision",
      "iterator",
      "needs-revision",
    );
    tracker.record(1, "revision", "revision", "iterator", "needs-revision");
    assertEquals(tracker.isPhaseRepetitionExceeded(1), false);
    assertEquals(tracker.getConsecutiveCount(1), 2);
  },
);

Deno.test(
  "isPhaseRepetitionExceeded resets when a different to-phase breaks the streak",
  () => {
    const tracker = new CycleTracker(100, 3);
    // Sequence of `to` values: revision, revision, triage, revision, revision
    tracker.record(
      1,
      "implementation",
      "revision",
      "iterator",
      "needs-revision",
    );
    tracker.record(1, "revision", "revision", "iterator", "needs-revision");
    tracker.record(1, "revision", "triage", "reviewer", "needs-triage");
    tracker.record(1, "triage", "revision", "iterator", "needs-revision");
    tracker.record(1, "revision", "revision", "iterator", "needs-revision");
    assertEquals(tracker.isPhaseRepetitionExceeded(1), false);
    assertEquals(tracker.getConsecutiveCount(1), 2);
  },
);

Deno.test(
  "isPhaseRepetitionExceeded evaluates restored history via fromState",
  () => {
    const seed = new CycleTracker(100, 3);
    seed.record(1, "implementation", "revision", "iterator", "needs-revision");
    seed.record(1, "revision", "revision", "iterator", "needs-revision");
    seed.record(1, "revision", "revision", "iterator", "needs-revision");
    const state = seed.toState(1, "revision");

    const restored = CycleTracker.fromState(state, 100, 3);
    assertEquals(restored.isPhaseRepetitionExceeded(1), true);
    assertEquals(restored.getConsecutiveCount(1), 3);

    // Same history but limit 0 (disabled) must not trip.
    const disabled = CycleTracker.fromState(state, 100, 0);
    assertEquals(disabled.isPhaseRepetitionExceeded(1), false);
  },
);
