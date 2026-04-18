/**
 * Integration tests for `merge-pr.ts`.
 *
 * These exercise the wrapper layer (verdict IO, pr_number cross-check,
 * dry-run short-circuit) without spawning `gh`. The `GhOps` object is
 * stubbed; the real `defaultGhOps` is covered indirectly by the unit
 * tests on `canMerge` plus manual dry-run invocation (see investigation
 * report).
 *
 * Design source of truth:
 *   - docs/internal/pr-merger-design/03-data-flow.md § 3.A (mergePr steps)
 *   - tmp/pr-merger-impl/investigation/design-requirements.md § 5.3, 5.4, 5.7
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { type GhOps, parseCli, run, type RunArgs } from "./merge-pr.ts";
import type { PrData } from "./lib/can-merge.ts";

/**
 * Stub `gh` that records every invocation and lets each test inject PR state.
 * Merge / label failures are opt-in via `mergeThrows` / `setLabelsThrows`.
 */
interface StubGh extends GhOps {
  readonly calls: {
    view: number[];
    merge: Array<
      { pr: number; method: string; deleteBranch: boolean }
    >;
    setLabels: Array<{ pr: number; add: string[]; remove: string[] }>;
  };
}

function makeGh(init: {
  prData?: PrData;
  viewThrows?: Error;
  mergeThrows?: Error;
}): StubGh {
  const calls: StubGh["calls"] = { view: [], merge: [], setLabels: [] };
  return {
    calls,
    viewPr: (pr) => {
      calls.view.push(pr);
      if (init.viewThrows) return Promise.reject(init.viewThrows);
      if (!init.prData) {
        return Promise.reject(new Error("stub: no PrData configured"));
      }
      return Promise.resolve(init.prData);
    },
    mergePr: (pr, method, deleteBranch) => {
      calls.merge.push({ pr, method, deleteBranch });
      if (init.mergeThrows) return Promise.reject(init.mergeThrows);
      return Promise.resolve();
    },
    setLabels: (pr, add, remove) => {
      calls.setLabels.push({ pr, add: [...add], remove: [...remove] });
      return Promise.resolve();
    },
  };
}

async function writeTempVerdict(content: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "merge-pr-test-" });
  const path = join(dir, "verdict.json");
  await Deno.writeTextFile(path, content);
  return path;
}

function validVerdictJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: "1.0.0",
    pr_number: 472,
    base_branch: "develop",
    verdict: "approved",
    merge_method: "squash",
    delete_branch: true,
    reviewer_summary: "All acceptance criteria met.",
    evaluated_at: "2026-04-13T00:00:00Z",
    reviewer_agent_version: "1.13.26",
    ci_required: true,
    ...overrides,
  });
}

function greenPrData(overrides: Partial<PrData> = {}): PrData {
  return {
    mergeable: "MERGEABLE",
    reviewDecision: "APPROVED",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    baseRefName: "develop",
    headRefName: "feature/x",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

Deno.test("parseCli accepts --pr and --verdict", () => {
  const r = parseCli(["--pr", "123", "--verdict", "/tmp/v.json"]);
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.args.pr, 123);
    assertEquals(r.args.verdictPath, "/tmp/v.json");
    assertEquals(r.args.dryRun, false);
    assertStrictEquals(r.args.mergeMethodOverride, undefined);
  }
});

Deno.test("parseCli accepts --verdict-path alias", () => {
  const r = parseCli(["--pr", "1", "--verdict-path", "/tmp/v.json"]);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.args.verdictPath, "/tmp/v.json");
});

Deno.test("parseCli accepts --dry-run and --merge-method", () => {
  const r = parseCli([
    "--pr",
    "42",
    "--verdict",
    "/tmp/v.json",
    "--dry-run",
    "--merge-method",
    "rebase",
  ]);
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.args.dryRun, true);
    assertEquals(r.args.mergeMethodOverride, "rebase");
  }
});

Deno.test("parseCli rejects missing --pr", () => {
  const r = parseCli(["--verdict", "/tmp/v.json"]);
  assertEquals(r.ok, false);
});

Deno.test("parseCli rejects non-integer --pr", () => {
  const r = parseCli(["--pr", "abc", "--verdict", "/tmp/v.json"]);
  assertEquals(r.ok, false);
});

Deno.test("parseCli rejects invalid --merge-method", () => {
  const r = parseCli([
    "--pr",
    "1",
    "--verdict",
    "/tmp/v.json",
    "--merge-method",
    "bogus",
  ]);
  assertEquals(r.ok, false);
});

// ---------------------------------------------------------------------------
// Scenario a: verdict file absent
// ---------------------------------------------------------------------------

Deno.test("run emits verdict-missing when file does not exist (exit 2)", async () => {
  const args: RunArgs = {
    pr: 1,
    verdictPath: "/does/not/exist/verdict.json",
    dryRun: false,
  };
  const gh = makeGh({});
  const { decision } = await run(args, gh);
  assertEquals(decision.ok, false);
  assertEquals(decision.reason, "verdict-missing");
  assertEquals(decision.exit_code, 2);
  assertEquals(decision.decision.kind, "rejected");
  assertEquals(decision.executed, false);
  assertEquals(gh.calls.view.length, 0);
  assertEquals(gh.calls.merge.length, 0);
});

// ---------------------------------------------------------------------------
// Scenario b: verdict JSON malformed
// ---------------------------------------------------------------------------

Deno.test("run emits schema-mismatch when verdict JSON is malformed (exit 2)", async () => {
  const path = await writeTempVerdict("not valid json {");
  const gh = makeGh({});
  const { decision } = await run(
    { pr: 1, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.ok, false);
  assertEquals(decision.reason, "schema-mismatch");
  assertEquals(decision.exit_code, 2);
  assertEquals(gh.calls.view.length, 0);
});

Deno.test("run emits schema-mismatch when required fields are missing (exit 2)", async () => {
  const path = await writeTempVerdict(JSON.stringify({ pr_number: 1 }));
  const gh = makeGh({});
  const { decision } = await run(
    { pr: 1, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.reason, "schema-mismatch");
  assertEquals(decision.exit_code, 2);
});

// ---------------------------------------------------------------------------
// Scenario c: pr_number mismatch
// ---------------------------------------------------------------------------

Deno.test("run emits pr-number-mismatch when --pr disagrees with verdict (exit 2)", async () => {
  const path = await writeTempVerdict(validVerdictJson({ pr_number: 200 }));
  const gh = makeGh({ prData: greenPrData() });
  const { decision } = await run(
    { pr: 100, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.ok, false);
  assertEquals(decision.reason, "pr-number-mismatch");
  assertEquals(decision.exit_code, 2);
  assertEquals(decision.decision.kind, "rejected");
  // Cross-check happens before any gh call (wrapper step 3, pre-API).
  assertEquals(gh.calls.view.length, 0);
  assertEquals(gh.calls.merge.length, 0);
});

// ---------------------------------------------------------------------------
// Scenario d: dry-run with full gate pass
// ---------------------------------------------------------------------------

Deno.test("run with --dry-run returns merged-kind decision but does not execute merge (exit 0)", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({ prData: greenPrData() });
  const { decision } = await run(
    { pr: 472, verdictPath: path, dryRun: true },
    gh,
  );
  assertEquals(decision.ok, true);
  assertEquals(decision.reason, null);
  assertEquals(decision.decision.kind, "merged");
  assertEquals(decision.executed, false);
  assertEquals(decision.exit_code, 0);
  assertEquals(gh.calls.view.length, 1);
  assertEquals(gh.calls.merge.length, 0);
  assertEquals(gh.calls.setLabels.length, 0);
});

// ---------------------------------------------------------------------------
// Additional coverage: full successful merge
// ---------------------------------------------------------------------------

Deno.test("run performs merge and swaps labels on full gate pass (exit 0)", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({ prData: greenPrData() });
  const { decision } = await run(
    { pr: 472, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.ok, true);
  assertEquals(decision.decision.kind, "merged");
  assertEquals(decision.executed, true);
  assertEquals(decision.exit_code, 0);
  assertEquals(decision.labels, {
    added: ["merge:done"],
    removed: ["merge:ready"],
  });
  assertEquals(gh.calls.merge, [{
    pr: 472,
    method: "squash",
    deleteBranch: true,
  }]);
  assertEquals(gh.calls.setLabels, [{
    pr: 472,
    add: ["merge:done"],
    remove: ["merge:ready"],
  }]);
});

Deno.test("run honours --merge-method override", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({ prData: greenPrData() });
  await run(
    {
      pr: 472,
      verdictPath: path,
      dryRun: false,
      mergeMethodOverride: "rebase",
    },
    gh,
  );
  assertEquals(gh.calls.merge[0].method, "rebase");
});

Deno.test("run honours verdict.delete_branch=false", async () => {
  const path = await writeTempVerdict(
    validVerdictJson({ delete_branch: false }),
  );
  const gh = makeGh({ prData: greenPrData() });
  await run(
    { pr: 472, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(gh.calls.merge[0].deleteBranch, false);
});

// ---------------------------------------------------------------------------
// Gate-failure mappings: retriable vs fatal
// ---------------------------------------------------------------------------

Deno.test("run maps ci-pending to exit 1 (retriable) without mutating labels", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({
    prData: greenPrData({
      statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: null }],
    }),
  });
  const { decision } = await run(
    { pr: 472, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.reason, "ci-pending");
  assertEquals(decision.decision.kind, "ci-pending");
  assertEquals(decision.exit_code, 1);
  // ci-pending preserves labels (design § 5.3).
  assertEquals(decision.labels, { added: [], removed: [] });
  assertEquals(gh.calls.merge.length, 0);
});

Deno.test("run maps ci-failed to exit 2 with merge:blocked label", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({
    prData: greenPrData({
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
    }),
  });
  const { decision } = await run(
    { pr: 472, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.reason, "ci-failed");
  assertEquals(decision.decision.kind, "rejected");
  assertEquals(decision.exit_code, 2);
  assertEquals(decision.labels, {
    added: ["merge:blocked"],
    removed: ["merge:ready"],
  });
});

Deno.test("run maps conflicts to exit 2 with merge:blocked label", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({ prData: greenPrData({ mergeable: "CONFLICTING" }) });
  const { decision } = await run(
    { pr: 472, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.reason, "conflicts");
  assertEquals(decision.decision.kind, "conflicts");
  assertEquals(decision.exit_code, 2);
});

Deno.test("run maps unknown-mergeable to exit 1 (retriable ci-pending outcome)", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({ prData: greenPrData({ mergeable: "UNKNOWN" }) });
  const { decision } = await run(
    { pr: 472, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.reason, "unknown-mergeable");
  assertEquals(decision.decision.kind, "ci-pending");
  assertEquals(decision.exit_code, 1);
});

// ---------------------------------------------------------------------------
// gh command failures
// ---------------------------------------------------------------------------

Deno.test("run maps gh pr view failure to exit 1 (retriable)", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({
    viewThrows: new Error("gh pr view failed: 503 Service Unavailable"),
  });
  const { decision } = await run(
    { pr: 472, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.reason, "gh-command-failed");
  assertEquals(decision.exit_code, 1);
  assertEquals(decision.decision.kind, "rejected");
});

Deno.test("run maps gh pr merge failure to exit 1 (retriable)", async () => {
  const path = await writeTempVerdict(validVerdictJson());
  const gh = makeGh({
    prData: greenPrData(),
    mergeThrows: new Error("gh pr merge failed: network timeout"),
  });
  const { decision } = await run(
    { pr: 472, verdictPath: path, dryRun: false },
    gh,
  );
  assertEquals(decision.reason, "gh-command-failed");
  assertEquals(decision.exit_code, 1);
  assertEquals(decision.executed, false);
});
