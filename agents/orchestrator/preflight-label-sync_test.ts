/**
 * Preflight label-sync wiring tests.
 *
 * Contract under test (Phase 2): before any issue processing, both
 * BatchRunner and Orchestrator (single-issue mode) must reconcile the
 * repository's label set against `workflow.json#labels` exactly once,
 * using the same `syncLabels` routine covered in `label-sync_test.ts`.
 *
 * Why it lives in its own file: the stubs in `orchestrator_test.ts` are
 * locked down to specific label sequences that would short-circuit the
 * preflight. Here we use a recording `GitHubClient` that tracks only the
 * three label-spec methods (`listLabelsDetailed`, `createLabel`,
 * `updateLabel`) while routing the rest to inert no-ops. This lets each
 * test assert "preflight ran with exactly these specs" without fighting
 * the issue-dispatch machinery.
 *
 * Non-goals: we do NOT assert on per-label colour format here (that is
 * the loader's job — see `workflow-loader_test.ts`), and we do NOT assert
 * on transition correctness (covered in `orchestrator_test.ts`).
 */

import { assertEquals } from "@std/assert";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  LabelDetail,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import { StubDispatcher } from "./dispatcher.ts";
import { Orchestrator } from "./orchestrator.ts";
import { BatchRunner } from "./batch-runner.ts";
import type { WorkflowConfig } from "./workflow-types.ts";

// =============================================================================
// Recording GitHub client — only label-spec methods are instrumented
// =============================================================================

interface LabelCall {
  op: "list" | "create" | "update";
  name?: string;
  color?: string;
  description?: string;
}

/**
 * Recording GitHubClient that captures label-spec calls but stays inert
 * for issue I/O. Exposes `.labelCalls` for assertions.
 *
 * Behaviour:
 * - `listLabelsDetailed` returns whatever baseline the test provided.
 *   Records a "list" call each invocation so tests can assert preflight
 *   ran (or was invoked exactly N times across a batch + single-issue
 *   sequence).
 * - `createLabel` / `updateLabel` record the call and succeed silently.
 * - All other methods return empty / no-op values so the outer
 *   orchestrator flow makes no progress past sync (which is intentional
 *   — we only care about preflight here).
 */
class RecordingGithubClient implements GitHubClient {
  #baseline: LabelDetail[];
  readonly labelCalls: LabelCall[] = [];

  constructor(baseline: LabelDetail[] = []) {
    this.#baseline = baseline;
  }

  listLabelsDetailed(): Promise<LabelDetail[]> {
    this.labelCalls.push({ op: "list" });
    return Promise.resolve(this.#baseline.map((l) => ({ ...l })));
  }

  createLabel(
    name: string,
    color: string,
    description: string,
  ): Promise<void> {
    this.labelCalls.push({ op: "create", name, color, description });
    return Promise.resolve();
  }

  updateLabel(
    name: string,
    color: string,
    description: string,
  ): Promise<void> {
    this.labelCalls.push({ op: "update", name, color, description });
    return Promise.resolve();
  }

  // --- Inert issue I/O ---
  getIssueLabels(): Promise<string[]> {
    return Promise.resolve([]);
  }
  updateIssueLabels(): Promise<void> {
    return Promise.resolve();
  }
  addIssueComment(): Promise<void> {
    return Promise.resolve();
  }
  createIssue(): Promise<number> {
    return Promise.resolve(0);
  }
  closeIssue(): Promise<void> {
    return Promise.resolve();
  }
  reopenIssue(): Promise<void> {
    return Promise.resolve();
  }
  getRecentComments(): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }
  listIssues(_: IssueCriteria): Promise<IssueListItem[]> {
    // Return empty so the batch completes after preflight with no dispatch.
    return Promise.resolve([]);
  }
  getIssueDetail(): Promise<IssueDetail> {
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
}

// =============================================================================
// Config builders
// =============================================================================

/**
 * Minimal valid workflow config. Adding a `labels` block is opt-in per
 * test so the "no labels section → preflight is a no-op" case is
 * covered without fighting the test builder.
 */
function baseConfig(
  labels?: Record<string, { color: string; description: string }>,
): WorkflowConfig {
  return {
    version: "1.0.0",
    phases: {
      implementation: { type: "actionable", priority: 1, agent: "iterator" },
      complete: { type: "terminal" },
    },
    labelMapping: {
      ready: "implementation",
      done: "complete",
    },
    agents: {
      iterator: {
        role: "transformer",
        outputPhase: "complete",
        fallbackPhase: "complete",
      },
    },
    rules: {
      maxCycles: 1,
      cycleDelayMs: 0,
      maxConsecutivePhases: 0,
    },
    labels,
  };
}

// =============================================================================
// BatchRunner preflight wiring
// =============================================================================

Deno.test("BatchRunner: preflight creates missing labels declared in workflow.json", async () => {
  const github = new RecordingGithubClient(/* empty baseline */);
  const config = baseConfig({
    "kind:impl": { color: "a2eeef", description: "impl work" },
    "done": { color: "0e8a16", description: "terminal" },
  });
  const tmpDir = await Deno.makeTempDir();
  try {
    const orchestrator = new Orchestrator(
      config,
      github,
      new StubDispatcher(),
      tmpDir,
    );
    const runner = new BatchRunner(
      orchestrator,
      config,
      github,
      new StubDispatcher(),
      tmpDir,
    );
    await runner.run({});

    // Exactly one baseline read (one preflight invocation per batch).
    const lists = github.labelCalls.filter((c) => c.op === "list");
    assertEquals(
      lists.length,
      1,
      "BatchRunner must invoke listLabelsDetailed exactly once (preflight runs once per batch).",
    );

    // Both declared specs must have been created, in declaration order.
    const creates = github.labelCalls.filter((c) => c.op === "create");
    assertEquals(
      creates.map((c) => c.name),
      ["kind:impl", "done"],
      "All labels declared in workflow.json#labels must be created during preflight.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("BatchRunner: preflight updates labels whose color drifted", async () => {
  const github = new RecordingGithubClient([
    // Existing label with stale color.
    { name: "kind:impl", color: "ffffff", description: "impl work" },
  ]);
  const config = baseConfig({
    "kind:impl": { color: "a2eeef", description: "impl work" },
  });
  const tmpDir = await Deno.makeTempDir();
  try {
    const orchestrator = new Orchestrator(
      config,
      github,
      new StubDispatcher(),
      tmpDir,
    );
    const runner = new BatchRunner(
      orchestrator,
      config,
      github,
      new StubDispatcher(),
      tmpDir,
    );
    await runner.run({});

    const updates = github.labelCalls.filter((c) => c.op === "update");
    assertEquals(updates.length, 1);
    assertEquals(updates[0].name, "kind:impl");
    assertEquals(updates[0].color, "a2eeef");

    // No creates (label already existed).
    assertEquals(
      github.labelCalls.filter((c) => c.op === "create").length,
      0,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("BatchRunner: preflight is a no-op when workflow.json has no labels section", async () => {
  const github = new RecordingGithubClient();
  const config = baseConfig(/* no labels */);
  const tmpDir = await Deno.makeTempDir();
  try {
    const orchestrator = new Orchestrator(
      config,
      github,
      new StubDispatcher(),
      tmpDir,
    );
    const runner = new BatchRunner(
      orchestrator,
      config,
      github,
      new StubDispatcher(),
      tmpDir,
    );
    await runner.run({});

    // No label-spec API call of any kind: preflight short-circuits when
    // `labels` is absent so pre-Phase-2 configs continue to work.
    assertEquals(
      github.labelCalls.length,
      0,
      "Preflight must not invoke any label API when workflow.json has no labels section.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("BatchRunner: preflight dryRun skips create/update but still lists", async () => {
  const github = new RecordingGithubClient(/* empty baseline */);
  const config = baseConfig({
    "kind:impl": { color: "a2eeef", description: "impl" },
  });
  const tmpDir = await Deno.makeTempDir();
  try {
    const orchestrator = new Orchestrator(
      config,
      github,
      new StubDispatcher(),
      tmpDir,
    );
    const runner = new BatchRunner(
      orchestrator,
      config,
      github,
      new StubDispatcher(),
      tmpDir,
    );
    await runner.run({}, { dryRun: true });

    // dryRun still reads baseline (that's harmless and informs the summary).
    assertEquals(
      github.labelCalls.filter((c) => c.op === "list").length,
      1,
    );
    // But must NOT mutate — this is the core dryRun contract.
    assertEquals(
      github.labelCalls.filter(
        (c) => c.op === "create" || c.op === "update",
      ).length,
      0,
      "dryRun preflight must never invoke createLabel or updateLabel.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// =============================================================================
// Orchestrator (single-issue mode) preflight wiring
// =============================================================================

Deno.test("Orchestrator.run: single-issue mode invokes preflight when logger is owned", async () => {
  const github = new RecordingGithubClient();
  const config = baseConfig({
    "kind:impl": { color: "a2eeef", description: "impl" },
  });
  const tmpDir = await Deno.makeTempDir();
  try {
    const orchestrator = new Orchestrator(
      config,
      github,
      new StubDispatcher({ iterator: "success" }),
      tmpDir,
    );
    // No `logger` arg → ownsLogger === true → preflight must fire.
    // Issue lookup short-circuits because getIssueLabels returns [].
    await orchestrator.run(1);

    assertEquals(
      github.labelCalls.filter((c) => c.op === "list").length,
      1,
      "Single-issue mode must run preflight exactly once when no external logger is passed.",
    );
    assertEquals(
      github.labelCalls.filter((c) => c.op === "create").length,
      1,
      "Preflight should have created the one declared label.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("Orchestrator.runBatch: preflight runs exactly once across batch + per-issue", async () => {
  // This is the double-sync guard: BatchRunner passes its own logger
  // into Orchestrator.run per issue, so Orchestrator's ownsLogger check
  // must skip the inner preflight. Net effect: one preflight per batch,
  // regardless of how many issues are in the batch.
  const github = new RecordingGithubClient();
  const config = baseConfig({
    "kind:impl": { color: "a2eeef", description: "impl" },
  });
  const tmpDir = await Deno.makeTempDir();
  try {
    const orchestrator = new Orchestrator(
      config,
      github,
      new StubDispatcher({ iterator: "success" }),
      tmpDir,
    );
    await orchestrator.runBatch({});

    // listLabelsDetailed must be called exactly once (batch preflight);
    // if Orchestrator double-syncs the count would be >1.
    assertEquals(
      github.labelCalls.filter((c) => c.op === "list").length,
      1,
      "Preflight must not double-run: BatchRunner handles the sync, Orchestrator.run must skip it when a batch logger was injected.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
