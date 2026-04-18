import { assertEquals } from "jsr:@std/assert";
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
// Integration: deferred_items → new issue(s) → close order
//
// Verifies issue #480 acceptance criterion:
//   "deferred_items 付き close → 新 issue 作成 → 元 issue close の順序確認"
//
// Contract under test (from "validator + closeOnComplete" path):
//   1. Dispatcher emits structuredOutput with verdict="done" and
//      deferred_items=[N entries].
//   2. Orchestrator writes N outbox create-issue files (Step 7a.5).
//   3. OutboxProcessor invokes github.createIssue() N times (Step 7b).
//   4. Saga T6 invokes github.closeIssue() exactly once (after Step 7b).
//   5. Outbox is cleared.
// =============================================================================

/** Event type recorded by the ordering stub. */
type CallLog =
  | { kind: "createIssue"; title: string; labels: string[] }
  | { kind: "closeIssue"; subjectId: number };

/**
 * Stub GitHub client that records the *order* of createIssue and closeIssue
 * invocations. Non-ordering methods (labels, comments) are inert stubs.
 */
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
    _body: string,
  ): Promise<number> {
    this.log.push({ kind: "createIssue", title, labels: [...labels] });
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

/** Config modeled after the considerer: validator with closeOnComplete. */
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

Deno.test(
  "integration: deferred_items expand into create-issue actions before close",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createConsidererLikeConfig();
      const store = new SubjectStore(`${tmpDir}/store`);
      await store.writeIssue({
        meta: {
          number: 1,
          title: "Roadmap-scale request",
          labels: ["kind:consider"],
          state: "open",
          assignees: [],
          milestone: null,
        },
        body: "multi-phase request",
        comments: [],
      });

      // Cycle 1: kind:consider -> considerer runs -> done -> complete (+ close).
      // Cycle 2: done label -> terminal -> break.
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
        deferred_items: [
          {
            title: "Phase 2: extract module",
            body: "Body for phase 2",
            labels: ["kind:impl"],
          },
          {
            title: "Phase 3: wire runner",
            body: "Body for phase 3",
            labels: ["kind:impl"],
          },
          {
            title: "Phase 4: document",
            body: "Body for phase 4",
            labels: ["kind:consider"],
          },
        ],
      };

      const dispatcher = new StubDispatcher(
        { considerer: "done" },
        undefined,
        undefined,
        structuredOutput,
      );
      const orchestrator = new Orchestrator(config, github, dispatcher);

      const result = await orchestrator.run(1, {}, store);

      // --- Phase / cycle outcome ---
      assertEquals(result.status, "completed");
      assertEquals(result.finalPhase, "complete");
      assertEquals(result.issueClosed, true);
      assertEquals(result.cycleCount, 1);

      // --- Ordering: 3 createIssue calls BEFORE 1 closeIssue call ---
      assertEquals(github.log.length, 4);
      assertEquals(github.log[0].kind, "createIssue");
      assertEquals(github.log[1].kind, "createIssue");
      assertEquals(github.log[2].kind, "createIssue");
      assertEquals(github.log[3].kind, "closeIssue");

      // Titles forwarded verbatim in declaration order
      const createCalls = github.log.filter(
        (e): e is Extract<CallLog, { kind: "createIssue" }> =>
          e.kind === "createIssue",
      );
      assertEquals(createCalls[0].title, "Phase 2: extract module");
      assertEquals(createCalls[0].labels, ["kind:impl"]);
      assertEquals(createCalls[1].title, "Phase 3: wire runner");
      assertEquals(createCalls[2].title, "Phase 4: document");
      assertEquals(createCalls[2].labels, ["kind:consider"]);

      // Close targets the original issue
      const closeCall = github.log[3] as Extract<
        CallLog,
        { kind: "closeIssue" }
      >;
      assertEquals(closeCall.subjectId, 1);

      // --- Outbox was cleared after successful processing ---
      const outboxDir = store.getOutboxPath(1);
      const leftover: string[] = [];
      try {
        for await (const entry of Deno.readDir(outboxDir)) {
          if (entry.isFile) leftover.push(entry.name);
        }
      } catch (_) {
        // Directory may not exist — acceptable; clearOutbox removes entries,
        // the dir itself may persist.
      }
      assertEquals(leftover, []);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "integration: empty deferred_items results in zero create-issue calls (baseline unchanged)",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createConsidererLikeConfig();
      const store = new SubjectStore(`${tmpDir}/store`);
      await store.writeIssue({
        meta: {
          number: 2,
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

      const result = await orchestrator.run(2, {}, store);

      assertEquals(result.issueClosed, true);
      // Only the closeIssue entry appears; no create-issue calls.
      assertEquals(github.log.length, 1);
      assertEquals(github.log[0].kind, "closeIssue");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "integration: deferred_items field absent is treated as empty (schema-optional)",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createConsidererLikeConfig();
      const store = new SubjectStore(`${tmpDir}/store`);
      await store.writeIssue({
        meta: {
          number: 3,
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

      // Note: no `deferred_items` key on structuredOutput.
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

      const result = await orchestrator.run(3, {}, store);

      assertEquals(result.issueClosed, true);
      assertEquals(github.createdIssueNumbers.length, 0);
      assertEquals(github.log.length, 1);
      assertEquals(github.log[0].kind, "closeIssue");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);
