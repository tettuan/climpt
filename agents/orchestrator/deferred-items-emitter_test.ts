import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { SubjectStore } from "./subject-store.ts";
import {
  DeferredItemsEmitter,
  extractDeferredItems,
} from "./deferred-items-emitter.ts";

// =============================================================================
// extractDeferredItems — pure validation / normalization
// =============================================================================

Deno.test("extractDeferredItems returns [] when structuredOutput is undefined", () => {
  assertEquals(extractDeferredItems(undefined), []);
});

Deno.test("extractDeferredItems returns [] when deferred_items is absent", () => {
  assertEquals(extractDeferredItems({ verdict: "done" }), []);
});

Deno.test("extractDeferredItems returns [] when deferred_items is null", () => {
  assertEquals(extractDeferredItems({ deferred_items: null }), []);
});

Deno.test("extractDeferredItems returns [] for empty array", () => {
  assertEquals(extractDeferredItems({ deferred_items: [] }), []);
});

Deno.test("extractDeferredItems normalizes a populated array", () => {
  const out = extractDeferredItems({
    deferred_items: [
      { title: "Phase 2", body: "detail for phase 2", labels: ["kind:impl"] },
      {
        title: "Phase 3",
        body: "detail for phase 3",
        labels: ["kind:consider", "enhancement"],
      },
    ],
  });
  assertEquals(out.length, 2);
  assertEquals(out[0].title, "Phase 2");
  assertEquals(out[0].body, "detail for phase 2");
  assertEquals(out[0].labels, ["kind:impl"]);
  assertEquals(out[1].labels, ["kind:consider", "enhancement"]);
});

Deno.test("extractDeferredItems throws when deferred_items is not an array", () => {
  assertThrows(
    () => extractDeferredItems({ deferred_items: "oops" }),
    Error,
    "must be an array",
  );
});

Deno.test("extractDeferredItems throws on non-object entry", () => {
  assertThrows(
    () => extractDeferredItems({ deferred_items: ["not an object"] }),
    Error,
    "must be an object",
  );
});

Deno.test("extractDeferredItems throws on missing title", () => {
  assertThrows(
    () =>
      extractDeferredItems({
        deferred_items: [{ body: "no title", labels: [] }],
      }),
    Error,
    "title must be a non-empty string",
  );
});

Deno.test("extractDeferredItems throws on empty title", () => {
  assertThrows(
    () =>
      extractDeferredItems({
        deferred_items: [{ title: "", body: "x", labels: [] }],
      }),
    Error,
    "title must be a non-empty string",
  );
});

Deno.test("extractDeferredItems throws on non-string body", () => {
  assertThrows(
    () =>
      extractDeferredItems({
        deferred_items: [{ title: "t", body: 123, labels: [] }],
      }),
    Error,
    "body must be a string",
  );
});

Deno.test("extractDeferredItems throws on non-array labels", () => {
  assertThrows(
    () =>
      extractDeferredItems({
        deferred_items: [{ title: "t", body: "b", labels: "oops" }],
      }),
    Error,
    "labels must be an array",
  );
});

Deno.test("extractDeferredItems throws on non-string label entry", () => {
  assertThrows(
    () =>
      extractDeferredItems({
        deferred_items: [{ title: "t", body: "b", labels: [42] }],
      }),
    Error,
    "labels[0] must be a string",
  );
});

// =============================================================================
// DeferredItemsEmitter.emit — writes outbox files
// =============================================================================

Deno.test("emit writes zero files when deferred_items is empty", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(`${tmpDir}/store`);
    const emitter = new DeferredItemsEmitter(store);
    const result = await emitter.emit(42, { deferred_items: [] });
    assertEquals(result.count, 0);
    assertEquals(result.paths, []);

    // Outbox directory should not be polluted
    let fileCount = 0;
    try {
      for await (const entry of Deno.readDir(store.getOutboxPath(42))) {
        if (entry.isFile) fileCount++;
      }
    } catch (_) {
      // Directory may not exist — that's fine for empty case
    }
    assertEquals(fileCount, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("emit writes zero files when deferred_items is absent", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(`${tmpDir}/store`);
    const emitter = new DeferredItemsEmitter(store);
    const result = await emitter.emit(42, { verdict: "done" });
    assertEquals(result.count, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("emit writes one create-issue file per deferred item", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(`${tmpDir}/store`);
    const emitter = new DeferredItemsEmitter(store);
    const result = await emitter.emit(42, {
      deferred_items: [
        { title: "Phase 2", body: "body2", labels: ["kind:impl"] },
        { title: "Phase 3", body: "body3", labels: ["kind:consider"] },
        { title: "Phase 4", body: "body4", labels: [] },
      ],
    });

    assertEquals(result.count, 3);
    assertEquals(result.paths.length, 3);

    // Each file parses as a valid OutboxProcessor "create-issue" action
    const outboxDir = store.getOutboxPath(42);
    const files: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) files.push(entry.name);
    }
    files.sort();
    assertEquals(files.length, 3);
    assertEquals(files[0], "000-deferred-000.json");
    assertEquals(files[1], "000-deferred-001.json");
    assertEquals(files[2], "000-deferred-002.json");

    const first = JSON.parse(
      await Deno.readTextFile(`${outboxDir}/${files[0]}`),
    );
    assertEquals(first.action, "create-issue");
    assertEquals(first.title, "Phase 2");
    assertEquals(first.body, "body2");
    assertEquals(first.labels, ["kind:impl"]);

    const third = JSON.parse(
      await Deno.readTextFile(`${outboxDir}/${files[2]}`),
    );
    assertEquals(third.action, "create-issue");
    assertEquals(third.labels, []);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("emit uses 000- prefix so files sort before any 001-+ outbox entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(`${tmpDir}/store`);
    const outboxDir = store.getOutboxPath(7);
    await Deno.mkdir(outboxDir, { recursive: true });

    // Pre-existing externally-written outbox action (conventionally 001-)
    await Deno.writeTextFile(
      `${outboxDir}/001-comment.json`,
      JSON.stringify({ action: "comment", body: "pre-existing" }),
    );

    const emitter = new DeferredItemsEmitter(store);
    await emitter.emit(7, {
      deferred_items: [
        { title: "Deferred A", body: "a", labels: [] },
      ],
    });

    const files: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) files.push(entry.name);
    }
    files.sort();
    // Deferred file sorts before the externally-written 001-
    assertEquals(files[0], "000-deferred-000.json");
    assertEquals(files[1], "001-comment.json");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("emit propagates validation errors from extract", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(`${tmpDir}/store`);
    const emitter = new DeferredItemsEmitter(store);
    await assertRejects(
      () =>
        emitter.emit(1, {
          deferred_items: [{ title: "", body: "x", labels: [] }],
        }),
      Error,
      "title must be a non-empty string",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
