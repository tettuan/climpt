/**
 * Unit tests for DeferredItemsEmitter.
 *
 * Design: schema-level acceptance/rejection lives in
 * `deferred-items-schema_test.ts`. These tests verify emitter-specific
 * invariants that schema validation cannot cover:
 *
 *   I4. Emitter → OutboxProcessor contract (round-trip):
 *       every file the emitter writes is parsed and dispatched by
 *       OutboxProcessor as a `create-issue` action.
 *   I5. Forwarding property (parameterized over items):
 *       for each index i, output[i].{title,body,labels} === input[i].{...}.
 *   I6. Sort-order contract:
 *       emitted filenames sort before any externally-written `001-+` entry,
 *       per OutboxProcessor.process()'s `files.sort()` behavior.
 *   I7. No-op invariant (parameterized):
 *       { absent, null, empty } inputs all emit zero files.
 *   I9. Defensive copy:
 *       mutating input.labels after emit() does not affect file content.
 *   I10. Idempotency — duplicate prevention (issue #484):
 *       confirmed items are not re-emitted on subsequent emit() calls.
 *   I11. Idempotency — unconfirmed retry:
 *       items whose keys were never confirmed ARE re-emitted.
 *   I12. Idempotency — partial overlap:
 *       only genuinely new items are emitted when input mixes old and new.
 *   I13. Idempotency — restart resilience:
 *       keys survive SubjectStore reconstruction (disk persistence).
 *   I14. Idempotency — label order independence:
 *       same item with differently-ordered labels produces the same key.
 *
 * The emitter's defensive validation (extractDeferredItems throws on
 * malformed input) is a fail-loud boundary — schema rejects the same
 * inputs upstream. One bypass-boundary test guards it.
 */

import {
  assert,
  assertEquals,
  assertGreater,
  assertRejects,
} from "jsr:@std/assert";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  Project,
  ProjectField,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { SubjectStore } from "./subject-store.ts";
import {
  computeIdempotencyKey,
  DeferredItemsEmitter,
  extractDeferredItems,
} from "./deferred-items-emitter.ts";

// =============================================================================
// Minimal spy GitHubClient — only createIssue is exercised; everything else
// is inert. Tests read `createdIssues` to assert forwarding.
// =============================================================================

class SpyGitHubClient implements GitHubClient {
  createdIssues: {
    title: string;
    labels: readonly string[];
    body: string;
  }[] = [];
  closedIssues: number[] = [];

  getIssueLabels(): Promise<string[]> {
    return Promise.resolve([]);
  }
  updateIssueLabels(): Promise<void> {
    return Promise.resolve();
  }
  addIssueComment(): Promise<void> {
    return Promise.resolve();
  }
  createIssue(title: string, labels: string[], body: string): Promise<number> {
    this.createdIssues.push({ title, labels: [...labels], body });
    return Promise.resolve(1000 + this.createdIssues.length);
  }
  closeIssue(subjectId: number): Promise<void> {
    this.closedIssues.push(subjectId);
    return Promise.resolve();
  }
  reopenIssue(): Promise<void> {
    return Promise.reject(new Error("not implemented"));
  }
  getRecentComments(): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }
  listIssues(_c: IssueCriteria): Promise<IssueListItem[]> {
    return Promise.resolve([]);
  }
  getIssueDetail(_n: number): Promise<IssueDetail> {
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
  createLabel(): Promise<void> {
    return Promise.resolve();
  }
  updateLabel(): Promise<void> {
    return Promise.resolve();
  }
  addIssueToProject(
    _project: ProjectRef,
    _issueNumber: number,
  ): Promise<string> {
    return Promise.resolve("PVTI_stub");
  }
  updateProjectItemField(
    _project: ProjectRef,
    _itemId: string,
    _fieldId: string,
    _value: ProjectFieldValue,
  ): Promise<void> {
    return Promise.resolve();
  }
  closeProject(_project: ProjectRef): Promise<void> {
    return Promise.resolve();
  }
  getProjectItemIdForIssue(): Promise<string | null> {
    return Promise.resolve(null);
  }
  listProjectItems(
    _project: ProjectRef,
  ): Promise<{ id: string; issueNumber: number }[]> {
    return Promise.resolve([]);
  }
  createProjectFieldOption(
    _project: ProjectRef,
    _fieldId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    return Promise.resolve({ id: `OPT_${name}`, name });
  }
  getIssueProjects(
    _issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>> {
    return Promise.resolve([]);
  }
  listUserProjects(_owner: string): Promise<Project[]> {
    return Promise.resolve([]);
  }
  getProject(_project: ProjectRef): Promise<Project> {
    return Promise.resolve({
      id: "PVT_stub",
      number: 0,
      owner: "",
      title: "",
      readme: "",
      shortDescription: null,
      closed: false,
    });
  }
  getProjectFields(_project: ProjectRef): Promise<ProjectField[]> {
    return Promise.resolve([]);
  }
  removeProjectItem(_project: ProjectRef, _itemId: string): Promise<void> {
    return Promise.resolve();
  }
}

async function withTempStore<T>(
  fn: (store: SubjectStore, tmp: string) => Promise<T>,
): Promise<T> {
  const tmp = await Deno.makeTempDir();
  try {
    return await fn(new SubjectStore(`${tmp}/store`), tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

// =============================================================================
// I7 — No-op invariant, parameterized.
// Any "no deferred items" input shape must produce zero files, regardless of
// which absence form the agent emits (null, missing key, empty array).
// =============================================================================

const NO_OP_INPUTS: {
  name: string;
  input: Record<string, unknown> | undefined;
}[] = [
  { name: "structuredOutput undefined", input: undefined },
  { name: "deferred_items key absent", input: { verdict: "done" } },
  { name: "deferred_items null", input: { deferred_items: null } },
  { name: "deferred_items empty array", input: { deferred_items: [] } },
];

for (const { name, input } of NO_OP_INPUTS) {
  Deno.test(
    `no-op invariant: emit writes zero files when ${name}`,
    async () => {
      await withTempStore(async (store) => {
        const emitter = new DeferredItemsEmitter(store);
        const result = await emitter.emit(1, input);
        assertEquals(result.count, 0, "emit.count must be 0 for no-op input");
        assertEquals(result.paths, [], "emit.paths must be [] for no-op input");

        // No stray files in outbox
        const outboxDir = store.getOutboxPath(1);
        let fileCount = 0;
        try {
          for await (const entry of Deno.readDir(outboxDir)) {
            if (entry.isFile) fileCount++;
          }
        } catch (_err) {
          // Directory absent is acceptable for no-op.
        }
        assertEquals(
          fileCount,
          0,
          `No-op input "${name}" must leave 0 files in outbox, found ${fileCount}. ` +
            `Fix: DeferredItemsEmitter.emit must short-circuit before mkdir/write ` +
            `when extractDeferredItems returns [].`,
        );
      });
    },
  );
}

// =============================================================================
// I4 + I5 — Contract with OutboxProcessor + forwarding property.
// Instead of manually asserting `.action === "create-issue"` (shadow contract),
// feed the emitter output through the real OutboxProcessor with a spy
// GitHubClient. Then assert: for each input item, the spy saw
// createIssue(title, labels, body) with matching values at the same index.
// =============================================================================

interface ItemFixture {
  title: string;
  body: string;
  labels: string[];
}

const ITEM_FIXTURES: ItemFixture[][] = [
  // Single item, single label
  [{ title: "Alpha", body: "body-alpha", labels: ["kind:impl"] }],
  // Multiple items, varied label cardinality
  [
    { title: "Phase 2: extract module", body: "b2", labels: ["kind:impl"] },
    {
      title: "Phase 3: wire runner",
      body: "b3",
      labels: ["kind:impl", "enhancement"],
    },
    { title: "Phase 4: document", body: "b4", labels: [] },
  ],
  // Edge: body and labels both degenerate but schema-valid
  [{ title: "t", body: "", labels: [] }],
  // Edge: many items exercising numeric suffix padding (capped at 10, issue #513)
  Array.from({ length: 10 }, (_, i) => ({
    title: `item-${i}`,
    body: `body-${i}`,
    labels: [`label-${i}`],
  })),
];

for (const fixture of ITEM_FIXTURES) {
  Deno.test(
    `contract: emitter output round-trips through OutboxProcessor as create-issue — ${fixture.length} item(s)`,
    async () => {
      await withTempStore(async (store) => {
        const emitter = new DeferredItemsEmitter(store);
        const emitResult = await emitter.emit(42, {
          deferred_items: fixture,
        });
        assertEquals(
          emitResult.count,
          fixture.length,
          "emit.count must equal input length",
        );

        const github = new SpyGitHubClient();
        const processor = new OutboxProcessor(github, store);
        const outboxResults = await processor.process(42);

        // Every file produced by the emitter is a valid create-issue.
        assertEquals(
          outboxResults.length,
          fixture.length,
          "OutboxProcessor must see exactly one result per emitted file.",
        );
        for (const r of outboxResults) {
          assertEquals(
            r.success,
            true,
            `OutboxProcessor rejected a file: action="${r.action}", ` +
              `error="${r.error}". Fix: DeferredItemsEmitter must write ` +
              `action="create-issue" shape defined by OutboxAction.`,
          );
          assertEquals(
            r.action,
            "create-issue",
            "Emitter must produce create-issue actions exclusively.",
          );
        }

        // Forwarding property: for each input item, there is exactly one
        // matching createIssue call — index-aligned (since OutboxProcessor
        // sorts files numerically and we use a sequential suffix).
        assertEquals(
          github.createdIssues.length,
          fixture.length,
          "createIssue call count must equal input length.",
        );
        for (let i = 0; i < fixture.length; i++) {
          const input = fixture[i];
          const observed = github.createdIssues[i];
          assertEquals(
            observed.title,
            input.title,
            `Forwarding mismatch at index ${i}: title`,
          );
          assertEquals(
            observed.body,
            input.body,
            `Forwarding mismatch at index ${i}: body`,
          );
          assertEquals(
            [...observed.labels],
            [...input.labels],
            `Forwarding mismatch at index ${i}: labels`,
          );
        }
      });
    },
  );
}

// =============================================================================
// I6 — Sort-order contract.
// OutboxProcessor sorts files by filename. Emitted files must sort BEFORE any
// externally-written outbox entries (conventionally `001-+`), so that
// create-issue runs before any subsequent action queued for the same cycle.
// This is the contract the ordering-in-integration relies on (I8).
// =============================================================================

Deno.test(
  "sort-order contract: emitted files sort before any 001-+ outbox entry",
  async () => {
    await withTempStore(async (store) => {
      const outboxDir = store.getOutboxPath(99);
      await Deno.mkdir(outboxDir, { recursive: true });

      // Pre-existing externally-written entries covering the 001-..999- range.
      const fakeExternalFilenames = [
        "001-comment.json",
        "050-labels.json",
        "999-close.json",
      ];
      for (const fn of fakeExternalFilenames) {
        await Deno.writeTextFile(
          `${outboxDir}/${fn}`,
          JSON.stringify({ action: "comment", body: `stub-${fn}` }),
        );
      }

      const emitter = new DeferredItemsEmitter(store);
      const emitResult = await emitter.emit(99, {
        deferred_items: [
          { title: "D1", body: "b", labels: [] },
          { title: "D2", body: "b", labels: [] },
          { title: "D3", body: "b", labels: [] },
        ],
      });
      assertEquals(emitResult.count, 3);

      // Collect and sort all filenames, mimicking OutboxProcessor.process().
      const all: string[] = [];
      for await (const entry of Deno.readDir(outboxDir)) {
        if (entry.isFile) all.push(entry.name);
      }
      all.sort();

      // The emitted files occupy positions 0..N-1; externals follow.
      const emittedBasenames = emitResult.paths.map((p) =>
        p.substring(p.lastIndexOf("/") + 1)
      ).sort();
      assertEquals(
        all.length,
        emittedBasenames.length + fakeExternalFilenames.length,
      );
      for (let i = 0; i < emittedBasenames.length; i++) {
        assertEquals(
          all[i],
          emittedBasenames[i],
          `Emitted file "${emittedBasenames[i]}" must sort at position ${i}, ` +
            `but position ${i} is "${all[i]}". ` +
            `Fix: DeferredItemsEmitter.emit must prefix with a numeric ` +
            `token strictly less than "001-" (currently "000-deferred-").`,
        );
      }
    });
  },
);

// =============================================================================
// I9 — Defensive copy.
// Mutating the caller's labels array after emit() must not change what was
// written. This protects against subtle cross-agent bugs where the same
// deferred_items object is reused.
// =============================================================================

Deno.test(
  "defensive copy: mutating input.labels post-emit does not affect file content",
  async () => {
    await withTempStore(async (store) => {
      const labels = ["kind:impl"];
      const input = {
        deferred_items: [{ title: "t", body: "b", labels }],
      };
      const emitter = new DeferredItemsEmitter(store);
      const result = await emitter.emit(7, input);
      assertEquals(result.count, 1);

      // Mutate the input after the call.
      labels.push("after-the-fact");
      labels[0] = "stomped";

      const github = new SpyGitHubClient();
      const processor = new OutboxProcessor(github, store);
      await processor.process(7);

      assertEquals(github.createdIssues.length, 1);
      assertEquals(
        [...github.createdIssues[0].labels],
        ["kind:impl"],
        "Emitter must deep-copy input.labels. " +
          "Fix: DeferredItemsEmitter.emit stores [...item.labels].",
      );
    });
  },
);

// =============================================================================
// Defensive boundary — one guard against schema bypass.
// Schema validation happens upstream in the runner's closure. If a future
// code path bypasses that (e.g. direct call from a test or a new caller),
// the emitter must fail loudly rather than silently emit garbage.
// Schema-level rejection diagnostics are covered in deferred-items-schema_test.ts.
// =============================================================================

Deno.test(
  "defensive boundary: emitter rejects malformed input when schema is bypassed",
  async () => {
    await withTempStore(async (store) => {
      const emitter = new DeferredItemsEmitter(store);
      await assertRejects(
        () =>
          emitter.emit(1, {
            deferred_items: [{ title: "", body: "b", labels: [] }],
          }),
        Error,
        "title",
        "Emitter must surface a diagnostic naming the offending field. " +
          "Fix: extractDeferredItems throws with path-qualified message.",
      );
    });
  },
);

// Defensive boundary: per-cycle count cap (issue #513).
// extractDeferredItems must throw when input exceeds the cap of 10,
// and must pass when input is exactly at the cap.
Deno.test(
  "defensive boundary: extractDeferredItems rejects 11 items (cap exceeded)",
  () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      title: `item-${i}`,
      body: `body-${i}`,
      labels: [`label-${i}`],
    }));
    let threw = false;
    try {
      extractDeferredItems({ deferred_items: items });
    } catch (err) {
      threw = true;
      const msg = (err as Error).message;
      assert(
        msg.includes("11"),
        `Error message must include the actual count (11), got: ${msg}`,
      );
      assert(
        msg.includes("10"),
        `Error message must include the cap (10), got: ${msg}`,
      );
    }
    assert(
      threw,
      "extractDeferredItems must throw when items exceed the cap of 10. " +
        "Fix: add length check after Array.isArray guard.",
    );
  },
);

Deno.test(
  "defensive boundary: extractDeferredItems accepts exactly 10 items",
  () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `item-${i}`,
      body: `body-${i}`,
      labels: [`label-${i}`],
    }));
    const result = extractDeferredItems({ deferred_items: items });
    assertEquals(
      result.length,
      10,
      "extractDeferredItems must accept exactly 10 items (at cap boundary).",
    );
  },
);

// Sanity: extractDeferredItems is a pure function; cover only the non-array
// boundary, since schema covers structural forms. Keeps parity with the
// defensive boundary test above.
Deno.test(
  "defensive boundary: extractDeferredItems rejects non-array input",
  () => {
    let threw = false;
    try {
      extractDeferredItems({ deferred_items: "not-an-array" });
    } catch (err) {
      threw = true;
      assertGreater(
        (err as Error).message.length,
        0,
        "Error message must be non-empty.",
      );
    }
    assert(
      threw,
      "extractDeferredItems must throw on non-array input. " +
        "Fix: keep the Array.isArray guard.",
    );
  },
);

// =============================================================================
// I10 — Idempotency: duplicate prevention (issue #484).
// After emit + confirmEmitted, re-emitting the same structuredOutput must
// produce zero new outbox files and zero createIssue calls.
// =============================================================================

Deno.test(
  "idempotency: confirmed items are not re-emitted on second emit",
  async () => {
    await withTempStore(async (store) => {
      const input = {
        deferred_items: [
          { title: "A", body: "body-a", labels: ["kind:impl"] },
          { title: "B", body: "body-b", labels: ["bug"] },
        ],
      };

      const emitter = new DeferredItemsEmitter(store);
      const SUBJECT = 10;

      // Cycle 1: emit → process outbox (simulating all-success) → confirm
      const r1 = await emitter.emit(SUBJECT, input);
      assertEquals(r1.count, 2, "First emit must write all items.");
      assertGreater(
        r1.emittedKeys.length,
        0,
        "First emit must return idempotency keys.",
      );
      // Process outbox to clear it (simulating successful OutboxProcessor run)
      const github1 = new SpyGitHubClient();
      const processor1 = new OutboxProcessor(github1, store);
      await processor1.process(SUBJECT);
      assertEquals(
        github1.createdIssues.length,
        2,
        "Cycle 1 must create 2 issues.",
      );
      // Confirm keys after successful processing
      await emitter.confirmEmitted(SUBJECT, r1.emittedKeys);

      // Cycle 2: same input → zero new items
      const r2 = await emitter.emit(SUBJECT, input);
      assertEquals(
        r2.count,
        0,
        "Second emit after confirm must produce 0 items. " +
          "Fix: DeferredItemsEmitter.emit must check confirmed keys.",
      );
      assertEquals(r2.paths, []);
      assertEquals([...r2.emittedKeys], []);

      // Verify no outbox files were written in cycle 2
      const github2 = new SpyGitHubClient();
      const processor2 = new OutboxProcessor(github2, store);
      const outboxResults = await processor2.process(SUBJECT);
      assertEquals(
        outboxResults.length,
        0,
        "No outbox actions should exist after idempotent skip.",
      );
      assertEquals(
        github2.createdIssues.length,
        0,
        "No createIssue calls on idempotent retry.",
      );
    });
  },
);

// =============================================================================
// I11 — Idempotency: unconfirmed retry.
// If confirmEmitted is never called (outbox processing failed), the next
// emit must re-emit the items so they can be retried.
// =============================================================================

Deno.test(
  "idempotency: unconfirmed items are re-emitted on retry",
  async () => {
    await withTempStore(async (store) => {
      const input = {
        deferred_items: [
          { title: "X", body: "body-x", labels: ["enhancement"] },
        ],
      };

      const emitter = new DeferredItemsEmitter(store);
      const SUBJECT = 11;

      // Cycle 1: emit but do NOT confirm (simulating outbox failure)
      const r1 = await emitter.emit(SUBJECT, input);
      assertEquals(r1.count, 1);
      // Deliberately skip confirmEmitted — simulating outbox failure.

      // Clear outbox to simulate partial state (outbox not cleared on failure,
      // but we test the emitter's key-based behavior, not outbox state)
      await store.clearOutbox(SUBJECT);

      // Cycle 2: same input → must re-emit because no confirmation
      const r2 = await emitter.emit(SUBJECT, input);
      assertEquals(
        r2.count,
        1,
        "Unconfirmed items must be re-emitted on retry. " +
          "Fix: DeferredItemsEmitter must only skip items with confirmed keys.",
      );
    });
  },
);

// =============================================================================
// I12 — Idempotency: partial overlap.
// When input mixes previously confirmed items and new items, only the new
// items are emitted.
// =============================================================================

Deno.test(
  "idempotency: partial overlap emits only new items",
  async () => {
    await withTempStore(async (store) => {
      const itemOld = { title: "Old", body: "old-body", labels: ["bug"] };
      const itemNew = { title: "New", body: "new-body", labels: ["feature"] };

      const emitter = new DeferredItemsEmitter(store);
      const SUBJECT = 12;

      // Cycle 1: emit and confirm only itemOld
      const r1 = await emitter.emit(SUBJECT, {
        deferred_items: [itemOld],
      });
      assertEquals(r1.count, 1);
      await emitter.confirmEmitted(SUBJECT, r1.emittedKeys);
      await store.clearOutbox(SUBJECT);

      // Cycle 2: input contains both old and new
      const r2 = await emitter.emit(SUBJECT, {
        deferred_items: [itemOld, itemNew],
      });
      assertEquals(
        r2.count,
        1,
        "Only the new item must be emitted when old item is already confirmed.",
      );

      // Verify the new item is the one that was emitted
      const github = new SpyGitHubClient();
      const processor = new OutboxProcessor(github, store);
      await processor.process(SUBJECT);

      assertEquals(github.createdIssues.length, 1);
      assertEquals(
        github.createdIssues[0].title,
        "New",
        "Only the genuinely new item must be forwarded to createIssue.",
      );
    });
  },
);

// =============================================================================
// I13 — Idempotency: restart resilience.
// Keys survive SubjectStore reconstruction from disk. A fresh SubjectStore
// instance reading the same directory must see previously confirmed keys.
// =============================================================================

Deno.test(
  "idempotency: confirmed keys persist across SubjectStore instances",
  async () => {
    const tmp = await Deno.makeTempDir();
    try {
      const storePath = `${tmp}/store`;
      const SUBJECT = 13;
      const input = {
        deferred_items: [
          { title: "Persistent", body: "survives restart", labels: ["p1"] },
        ],
      };

      // Instance 1: emit and confirm
      const store1 = new SubjectStore(storePath);
      const emitter1 = new DeferredItemsEmitter(store1);
      const r1 = await emitter1.emit(SUBJECT, input);
      assertEquals(r1.count, 1);
      await emitter1.confirmEmitted(SUBJECT, r1.emittedKeys);

      // Instance 2: fresh store from same directory
      const store2 = new SubjectStore(storePath);
      const emitter2 = new DeferredItemsEmitter(store2);
      const r2 = await emitter2.emit(SUBJECT, input);
      assertEquals(
        r2.count,
        0,
        "A fresh SubjectStore instance must see previously confirmed keys. " +
          "Fix: keys must be persisted to disk, not held in memory.",
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

// =============================================================================
// I14 — Idempotency: label order independence.
// The same item with differently-ordered labels must produce the same
// idempotency key, so that cosmetic reordering in agent output does not
// bypass the duplicate check.
// =============================================================================

Deno.test(
  "idempotency: label order does not affect idempotency key",
  async () => {
    const item1 = { title: "T", body: "B", labels: ["b", "a", "c"] as const };
    const item2 = { title: "T", body: "B", labels: ["c", "a", "b"] as const };

    const key1 = await computeIdempotencyKey(item1);
    const key2 = await computeIdempotencyKey(item2);

    assertEquals(
      key1,
      key2,
      "Items with identical content but different label order must produce " +
        "the same idempotency key. " +
        "Fix: computeIdempotencyKey must sort labels before hashing.",
    );
  },
);

// =============================================================================
// I14b — Idempotency: different content produces different keys.
// Guard against degenerate hash implementations that always return the same
// value. Two items with different titles must yield distinct keys.
// =============================================================================

Deno.test(
  "idempotency: different items produce different keys",
  async () => {
    const itemA = { title: "Alpha", body: "B", labels: ["l"] as const };
    const itemB = { title: "Beta", body: "B", labels: ["l"] as const };

    const keyA = await computeIdempotencyKey(itemA);
    const keyB = await computeIdempotencyKey(itemB);

    assert(
      keyA !== keyB,
      "Items with different content must produce different idempotency keys. " +
        "Fix: computeIdempotencyKey hash must incorporate title/body/labels.",
    );
  },
);
