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
} from "./github-client.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { SubjectStore } from "./subject-store.ts";
import {
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
  // Edge: many items exercising numeric suffix padding
  Array.from({ length: 12 }, (_, i) => ({
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
