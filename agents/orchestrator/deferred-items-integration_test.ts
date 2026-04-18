/**
 * Integration tests for issue #480: `deferred_items → create-issue → close`.
 *
 * Scope: Orchestrator + OutboxProcessor + Saga (T6) end-to-end, with a spy
 * GitHub client as the only boundary.
 *
 * Test pattern: **Invariant Test** (see test-design skill). Each assertion
 * expresses a *property* of the trace, not a positional equality. Positional
 * assertions (`log[0].kind === "createIssue"`) were removed because:
 *   1. They hide the intent (the real invariant is "every createIssue
 *      precedes closeIssue", not "createIssue happens to be index 0").
 *   2. They break silently when the orchestrator adds an unrelated call
 *      (e.g. an extra label update) — the test would report "wrong kind"
 *      instead of "ordering violated".
 *
 * Invariants verified:
 *   INV-ORDER    : max(index of createIssue) < index of closeIssue
 *   INV-COUNT    : createCalls.length === deferred_items.length
 *   INV-FORWARD  : ∀ item ∈ deferred_items ∃! createCall with
 *                  {title, body, labels} === item (verbatim, order-stable)
 *   INV-TARGET   : closeIssue is called with the original subjectId
 *   INV-NOOP     : deferred_items=[] ∨ absent ⇒ createCalls.length === 0
 *                  and closeIssue still fires exactly once
 *   INV-CLEANUP  : outbox is empty after successful processing
 */

import { assert, assertEquals } from "jsr:@std/assert";
import type { WorkflowConfig } from "./workflow-types.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";
import { StubDispatcher } from "./dispatcher.ts";
import { Orchestrator } from "./orchestrator.ts";
import { SubjectStore } from "./subject-store.ts";

// =============================================================================
// Spy GitHub client — records order of createIssue and closeIssue calls.
// Non-ordering operations are inert stubs.
// =============================================================================

type CallLog =
  | { kind: "createIssue"; title: string; labels: string[]; body: string }
  | { kind: "closeIssue"; subjectId: number };

class OrderingStubGitHubClient implements GitHubClient {
  readonly log: CallLog[] = [];
  readonly labelUpdates: {
    subjectId: number;
    removed: string[];
    added: string[];
  }[] = [];
  readonly createdIssueNumbers: number[] = [];

  #labelSequence: string[][];
  #callIndex = 0;
  #nextCreatedIssueNumber = 100;

  constructor(labelSequence: string[][]) {
    this.#labelSequence = labelSequence;
  }

  getIssueLabels(_subjectId: number): Promise<string[]> {
    const idx = Math.min(this.#callIndex, this.#labelSequence.length - 1);
    const labels = this.#labelSequence[idx];
    this.#callIndex++;
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(
    subjectId: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.labelUpdates.push({
      subjectId,
      removed: labelsToRemove,
      added: labelsToAdd,
    });
    return Promise.resolve();
  }

  addIssueComment(_subjectId: number, _comment: string): Promise<void> {
    return Promise.resolve();
  }

  createIssue(
    title: string,
    labels: string[],
    body: string,
  ): Promise<number> {
    this.log.push({ kind: "createIssue", title, labels: [...labels], body });
    const id = this.#nextCreatedIssueNumber++;
    this.createdIssueNumbers.push(id);
    return Promise.resolve(id);
  }

  closeIssue(subjectId: number): Promise<void> {
    this.log.push({ kind: "closeIssue", subjectId });
    return Promise.resolve();
  }

  reopenIssue(_subjectId: number): Promise<void> {
    return Promise.reject(new Error("reopenIssue not implemented"));
  }

  getRecentComments(
    _subjectId: number,
    _limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }

  listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return Promise.resolve([]);
  }

  getIssueDetail(_subjectId: number): Promise<IssueDetail> {
    return Promise.resolve({
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

  listLabels(): Promise<string[]> {
    return Promise.resolve([]);
  }

  listLabelsDetailed(): Promise<
    { name: string; color: string; description: string }[]
  > {
    return Promise.resolve([]);
  }

  createLabel(
    _name: string,
    _color: string,
    _description: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  updateLabel(
    _name: string,
    _color: string,
    _description: string,
  ): Promise<void> {
    return Promise.resolve();
  }
}

// =============================================================================
// Config: modeled after considerer (validator with closeOnComplete).
// Source of truth: considerer's config contract (done → complete → close).
// =============================================================================

function createConsidererLikeConfig(): WorkflowConfig {
  return {
    version: "1.0.0",
    phases: {
      consider: { type: "actionable", priority: 1, agent: "considerer" },
      complete: { type: "terminal" },
      blocked: { type: "blocking" },
    },
    labelMapping: {
      "kind:consider": "consider",
      done: "complete",
      blocked: "blocked",
    },
    agents: {
      considerer: {
        role: "validator",
        directory: "considerer",
        outputPhases: {
          done: "complete",
          "handoff-detail": "complete",
        },
        fallbackPhase: "blocked",
        closeOnComplete: true,
        closeCondition: "done",
      },
    },
    rules: { maxCycles: 2, cycleDelayMs: 0 },
  };
}

// =============================================================================
// Property helpers — each expresses a single invariant as a pure predicate
// over the call log. Tests compose these so invariants stay named in failure
// messages rather than hidden behind positional indices.
// =============================================================================

function indicesOfKind<K extends CallLog["kind"]>(
  log: readonly CallLog[],
  kind: K,
): number[] {
  return log.flatMap((entry, i) => (entry.kind === kind ? [i] : []));
}

function createCallsInOrder(
  log: readonly CallLog[],
): Extract<CallLog, { kind: "createIssue" }>[] {
  return log.filter(
    (e): e is Extract<CallLog, { kind: "createIssue" }> =>
      e.kind === "createIssue",
  );
}

/** INV-ORDER: every createIssue index is less than every closeIssue index. */
function assertCreateBeforeClose(log: readonly CallLog[]) {
  const creates = indicesOfKind(log, "createIssue");
  const closes = indicesOfKind(log, "closeIssue");
  assertEquals(
    closes.length,
    1,
    `INV-ORDER premise violated: exactly one closeIssue expected, got ${closes.length}. ` +
      `Log kinds: [${log.map((e) => e.kind).join(", ")}]. ` +
      `Fix: saga T6 should close exactly once per run; check orchestrator cycle exit.`,
  );
  const closeIndex = closes[0];
  for (const ci of creates) {
    assert(
      ci < closeIndex,
      `INV-ORDER violated: createIssue at index ${ci} must precede closeIssue at index ${closeIndex}. ` +
        `Full kinds: [${log.map((e) => e.kind).join(", ")}]. ` +
        `Fix: outbox processing (Step 7b) must run before T6 closeIssue.`,
    );
  }
}

/** INV-FORWARD: deferred_items[i].{title,body,labels} appears verbatim and in-order among createIssue calls. */
function assertItemsForwardedVerbatim(
  log: readonly CallLog[],
  items: readonly { title: string; body: string; labels: readonly string[] }[],
) {
  const creates = createCallsInOrder(log);
  // INV-COUNT is a precondition for INV-FORWARD; diagnose it first.
  assertEquals(
    creates.length,
    items.length,
    `INV-COUNT violated: expected ${items.length} createIssue call(s), got ${creates.length}. ` +
      `Titles observed: [${
        creates.map((c) => JSON.stringify(c.title)).join(", ")
      }]. ` +
      `Fix: check extractDeferredItems filter and OutboxProcessor dispatch.`,
  );
  for (let i = 0; i < items.length; i++) {
    const expected = items[i];
    const actual = creates[i];
    assertEquals(
      actual.title,
      expected.title,
      `INV-FORWARD (title) violated at deferred_items[${i}]: expected ${
        JSON.stringify(expected.title)
      }, got ${JSON.stringify(actual.title)}. ` +
        `Fix: verify payload.title passthrough in DeferredItemsEmitter.emit.`,
    );
    assertEquals(
      actual.body,
      expected.body,
      `INV-FORWARD (body) violated at deferred_items[${i}]. ` +
        `Fix: verify payload.body passthrough in DeferredItemsEmitter.emit.`,
    );
    assertEquals(
      actual.labels,
      [...expected.labels],
      `INV-FORWARD (labels) violated at deferred_items[${i}]: expected ${
        JSON.stringify(expected.labels)
      }, got ${JSON.stringify(actual.labels)}. ` +
        `Fix: verify payload.labels passthrough (check for stripping/sorting).`,
    );
  }
}

/** INV-TARGET: single closeIssue call targets the given subjectId. */
function assertCloseTargets(log: readonly CallLog[], subjectId: number) {
  const closes = log.filter(
    (e): e is Extract<CallLog, { kind: "closeIssue" }> =>
      e.kind === "closeIssue",
  );
  assertEquals(
    closes.length,
    1,
    `INV-TARGET: expected exactly one closeIssue, got ${closes.length}.`,
  );
  assertEquals(
    closes[0].subjectId,
    subjectId,
    `INV-TARGET violated: closeIssue subjectId expected=${subjectId}, got=${
      closes[0].subjectId
    }. ` +
      `Fix: saga T6 must close the original subject, not a created follow-up.`,
  );
}

/** INV-CLEANUP: outbox directory contains no leftover action files. */
async function assertOutboxEmpty(outboxDir: string) {
  const leftover: string[] = [];
  try {
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) leftover.push(entry.name);
    }
  } catch {
    // Directory absent is acceptable — clearOutbox removes entries but may
    // leave the directory itself.
    return;
  }
  assertEquals(
    leftover,
    [],
    `INV-CLEANUP violated: outbox at ${outboxDir} still contains ${
      JSON.stringify(leftover)
    }. ` +
      `Fix: OutboxProcessor must clear files after successful dispatch.`,
  );
}

// =============================================================================
// Tests — each names the invariant(s) it verifies.
// =============================================================================

const ROADMAP_ITEMS = [
  {
    title: "Phase 2: extract module",
    body: "Body for phase 2",
    labels: ["kind:impl"] as const,
  },
  {
    title: "Phase 3: wire runner",
    body: "Body for phase 3",
    labels: ["kind:impl"] as const,
  },
  {
    title: "Phase 4: document",
    body: "Body for phase 4",
    labels: ["kind:consider"] as const,
  },
] as const;

Deno.test(
  "INV-ORDER + INV-COUNT + INV-FORWARD + INV-TARGET + INV-CLEANUP: populated deferred_items expand before close",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createConsidererLikeConfig();
      const store = new SubjectStore(`${tmpDir}/store`);
      const SUBJECT_ID = 1;
      await store.writeIssue({
        meta: {
          number: SUBJECT_ID,
          title: "Roadmap-scale request",
          labels: ["kind:consider"],
          state: "open",
          assignees: [],
          milestone: null,
        },
        body: "multi-phase request",
        comments: [],
      });

      // Cycle 1: kind:consider → considerer → done → complete (+ close).
      // Cycle 2: done label → terminal → break.
      const github = new OrderingStubGitHubClient([
        ["kind:consider"],
        ["done"],
      ]);

      const structuredOutput = {
        stepId: "consider",
        status: "completed",
        summary: "Roadmap decomposed",
        next_action: { action: "closing" },
        verdict: "done",
        final_summary: "Phase 1 handed off; phases 2-4 deferred",
        deferred_items: ROADMAP_ITEMS.map((i) => ({
          ...i,
          labels: [...i.labels],
        })),
      };

      const dispatcher = new StubDispatcher(
        { considerer: "done" },
        undefined,
        undefined,
        structuredOutput,
      );
      const orchestrator = new Orchestrator(config, github, dispatcher);

      const result = await orchestrator.run(SUBJECT_ID, {}, store);

      // Cycle outcome — preconditions for invariant checks.
      assertEquals(result.status, "completed");
      assertEquals(result.finalPhase, "complete");
      assertEquals(result.issueClosed, true);
      assertEquals(result.cycleCount, 1);

      // Invariant checks — each property independently diagnosable.
      assertCreateBeforeClose(github.log);
      assertItemsForwardedVerbatim(github.log, ROADMAP_ITEMS);
      assertCloseTargets(github.log, SUBJECT_ID);
      await assertOutboxEmpty(store.getOutboxPath(SUBJECT_ID));
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "INV-NOOP (empty): deferred_items=[] yields zero createIssue calls and single closeIssue",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createConsidererLikeConfig();
      const store = new SubjectStore(`${tmpDir}/store`);
      const SUBJECT_ID = 2;
      await store.writeIssue({
        meta: {
          number: SUBJECT_ID,
          title: "Atomic request",
          labels: ["kind:consider"],
          state: "open",
          assignees: [],
          milestone: null,
        },
        body: "atomic",
        comments: [],
      });

      const github = new OrderingStubGitHubClient([
        ["kind:consider"],
        ["done"],
      ]);

      const structuredOutput = {
        stepId: "consider",
        status: "completed",
        summary: "Answered",
        next_action: { action: "closing" },
        verdict: "done",
        deferred_items: [],
      };

      const dispatcher = new StubDispatcher(
        { considerer: "done" },
        undefined,
        undefined,
        structuredOutput,
      );
      const orchestrator = new Orchestrator(config, github, dispatcher);

      const result = await orchestrator.run(SUBJECT_ID, {}, store);

      assertEquals(result.issueClosed, true);
      assertEquals(
        indicesOfKind(github.log, "createIssue").length,
        0,
        `INV-NOOP violated: empty deferred_items must not produce createIssue. ` +
          `Log kinds: [${github.log.map((e) => e.kind).join(", ")}].`,
      );
      assertCloseTargets(github.log, SUBJECT_ID);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "INV-NOOP (absent): omitted deferred_items key is treated identically to empty array",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createConsidererLikeConfig();
      const store = new SubjectStore(`${tmpDir}/store`);
      const SUBJECT_ID = 3;
      await store.writeIssue({
        meta: {
          number: SUBJECT_ID,
          title: "No deferred_items key",
          labels: ["kind:consider"],
          state: "open",
          assignees: [],
          milestone: null,
        },
        body: "no deferred",
        comments: [],
      });

      const github = new OrderingStubGitHubClient([
        ["kind:consider"],
        ["done"],
      ]);

      // Note: deferred_items key omitted — schema declares it optional.
      const structuredOutput = {
        stepId: "consider",
        status: "completed",
        summary: "Answered",
        next_action: { action: "closing" },
        verdict: "done",
      };

      const dispatcher = new StubDispatcher(
        { considerer: "done" },
        undefined,
        undefined,
        structuredOutput,
      );
      const orchestrator = new Orchestrator(config, github, dispatcher);

      const result = await orchestrator.run(SUBJECT_ID, {}, store);

      assertEquals(result.issueClosed, true);
      assertEquals(
        github.createdIssueNumbers.length,
        0,
        `INV-NOOP (absent) violated: missing deferred_items must not produce createIssue. ` +
          `Observed createdIssueNumbers=${
            JSON.stringify(github.createdIssueNumbers)
          }.`,
      );
      assertCloseTargets(github.log, SUBJECT_ID);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);
