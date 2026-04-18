#!/usr/bin/env -S deno run --allow-read --allow-run --allow-net
/**
 * Deterministic PR merger CLI.
 *
 * Role (01-overview.md, 03-data-flow.md):
 *   Read a reviewer-emitted verdict JSON + GitHub PR state, AND-combine them
 *   through the pure gate evaluator (`canMerge`), and — only on full-pass —
 *   invoke `gh pr merge`. **No LLM is in the loop.**
 *
 * CLI contract (design-requirements.md § 5.1, 5.4):
 *   --pr <number>                  (required)
 *   --verdict <path>               (required, alias: --verdict-path)
 *   --dry-run                      (optional flag)
 *   --merge-method <squash|merge|rebase>  (optional override; verdict wins
 *                                          when both are present only if the
 *                                          verdict specifies one — override
 *                                          is a last-resort escape hatch)
 *
 * Exit codes:
 *   0 — merge succeeded, dry-run completed cleanly, or retriable gate result
 *       (see note below).
 *   1 — retriable error (gh subprocess failure, network timeout, ci-pending).
 *   2 — fatal (verdict-missing, schema-mismatch, pr-number-mismatch,
 *       rejected, approvals-missing, conflicts, ci-failed,
 *       base-branch-mismatch).
 *
 * Note on `ci-pending`: design-requirements.md § 5.4 is ambiguous about
 * whether `ci-pending` is exit 0 or exit 1. This implementation chooses
 * **exit 1 (retriable)** so that the workflow-merge orchestrator's self-loop
 * naturally retries without a separate polling mechanism.
 *
 * Non-interference (design-requirements.md § 7.1): this file is a fresh entry
 * point; it does not import from `agents/runner/`, `agents/common/worktree.ts`,
 * `agents/common/tool-policy.ts`, `agents/verdict/external-state-adapter.ts`,
 * `agents/orchestrator/query-executor.ts`, or `.agent/workflow.json`. `gh` is
 * invoked via `Deno.Command`, bypassing the SDK tool-policy layer (which only
 * affects nested agent subprocesses).
 *
 * @module
 */

import { parseArgs } from "@std/cli/parse-args";
import { canMerge, type PrData, type Verdict } from "./lib/can-merge.ts";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

/**
 * Canonical 5-outcome surface (00-design-decisions.md § T8).
 * `rejected` is the catch-all for non-retriable fatal states.
 */
export type CanonicalOutcome =
  | "merged"
  | "ci-pending"
  | "approvals-missing"
  | "conflicts"
  | "rejected";

/**
 * Every reason code the CLI can emit on stdout.
 * Superset of `CanMergeReason` (pure gates) plus wrapper-only reasons.
 */
export type ReasonCode =
  | "schema-mismatch"
  | "rejected-by-reviewer"
  | "unknown-mergeable"
  | "conflicts"
  | "approvals-missing"
  | "ci-pending"
  | "ci-failed"
  | "base-branch-mismatch"
  | "pr-number-mismatch"
  | "verdict-missing"
  | "gh-command-failed";

/**
 * stdout decision JSON shape (design-requirements.md § 5.4).
 * Emitted on **every** exit, regardless of code.
 */
export interface DecisionJson {
  "ok": boolean;
  "pr_number": number | null;
  "decision": { kind: CanonicalOutcome };
  "reason": ReasonCode | null;
  "executed": boolean;
  "labels": { added: string[]; removed: string[] };
  "exit_code": 0 | 1 | 2;
  "error"?: string;
}

// -----------------------------------------------------------------------------
// Dependency-injection seams for tests
// -----------------------------------------------------------------------------

/**
 * Side-effect surface. Tests substitute this object to verify argv / labels
 * without spawning `gh`.
 */
export interface GhOps {
  viewPr(prNumber: number): Promise<PrData>;
  mergePr(
    prNumber: number,
    method: "squash" | "merge" | "rebase",
    deleteBranch: boolean,
  ): Promise<void>;
  setLabels(
    prNumber: number,
    add: string[],
    remove: string[],
  ): Promise<void>;
}

// -----------------------------------------------------------------------------
// Reason → Canonical Outcome mapping (design-requirements.md § 5.3)
// -----------------------------------------------------------------------------

function outcomeOfReason(reason: ReasonCode): CanonicalOutcome {
  switch (reason) {
    case "unknown-mergeable":
    case "ci-pending":
      return "ci-pending";
    case "conflicts":
      return "conflicts";
    case "approvals-missing":
      return "approvals-missing";
    case "schema-mismatch":
    case "rejected-by-reviewer":
    case "ci-failed":
    case "base-branch-mismatch":
    case "pr-number-mismatch":
    case "verdict-missing":
    case "gh-command-failed":
      return "rejected";
  }
}

/**
 * Retriable reasons cause exit 1, non-retriable fatal reasons cause exit 2.
 * Derived from § 5.3 "retry" column and § 5.4 mapping table.
 */
function isRetriable(reason: ReasonCode): boolean {
  // `unknown-mergeable` and `ci-pending` are the canonical retriable gates.
  // `gh-command-failed` is retriable (transient network / gh flake).
  return reason === "unknown-mergeable" ||
    reason === "ci-pending" ||
    reason === "gh-command-failed";
}

/**
 * Label mutation per outcome (design-requirements.md § 5.3).
 *   - merged     → -merge:ready, +merge:done
 *   - ci-pending → no change
 *   - others     → -merge:ready, +merge:blocked
 */
function labelDeltaFor(
  outcome: CanonicalOutcome,
): { added: string[]; removed: string[] } {
  switch (outcome) {
    case "merged":
      return { added: ["merge:done"], removed: ["merge:ready"] };
    case "ci-pending":
      return { added: [], removed: [] };
    case "approvals-missing":
    case "conflicts":
    case "rejected":
      return { added: ["merge:blocked"], removed: ["merge:ready"] };
  }
}

// -----------------------------------------------------------------------------
// Verdict IO
// -----------------------------------------------------------------------------

interface VerdictLoadOk {
  ok: true;
  verdict: Verdict;
}
interface VerdictLoadErr {
  ok: false;
  reason: "verdict-missing" | "schema-mismatch";
  detail: string;
}
type VerdictLoad = VerdictLoadOk | VerdictLoadErr;

/**
 * Reads `path`, JSON-parses, and validates the minimal required shape
 * (design-requirements.md § 5.6). Full JSON Schema validation is intentionally
 * out of scope here; this guards only the fields the CLI itself reads.
 */
async function loadVerdict(path: string): Promise<VerdictLoad> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return {
        ok: false,
        reason: "verdict-missing",
        detail: `verdict file not found: ${path}`,
      };
    }
    return {
      ok: false,
      reason: "verdict-missing",
      detail: `unable to read verdict file '${path}': ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      reason: "schema-mismatch",
      detail: `verdict JSON parse error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const check = validateVerdictShape(parsed);
  if (!check.ok) {
    return { ok: false, reason: "schema-mismatch", detail: check.detail };
  }
  return { ok: true, verdict: check.verdict };
}

/**
 * Structural validation for the fields the CLI consumes. Accepts unknown
 * extra fields (forward-compat).
 */
function validateVerdictShape(
  raw: unknown,
): { ok: true; verdict: Verdict } | { ok: false; detail: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, detail: "verdict root is not an object" };
  }
  const obj = raw as Record<string, unknown>;
  const requireString = (key: string): string | null =>
    typeof obj[key] === "string" && (obj[key] as string).length > 0
      ? (obj[key] as string)
      : null;

  const schemaVersion = requireString("schema_version");
  const baseBranch = requireString("base_branch");
  const verdictStr = requireString("verdict");
  const reviewerSummary = requireString("reviewer_summary");
  const evaluatedAt = requireString("evaluated_at");
  const reviewerAgentVersion = requireString("reviewer_agent_version");
  const prNumber = typeof obj.pr_number === "number" &&
      Number.isInteger(obj.pr_number) &&
      (obj.pr_number as number) >= 1
    ? (obj.pr_number as number)
    : null;

  if (
    schemaVersion === null ||
    baseBranch === null ||
    verdictStr === null ||
    reviewerSummary === null ||
    evaluatedAt === null ||
    reviewerAgentVersion === null ||
    prNumber === null
  ) {
    return {
      ok: false,
      detail: "verdict is missing one or more required fields",
    };
  }
  if (verdictStr !== "approved" && verdictStr !== "rejected") {
    return {
      ok: false,
      detail:
        `verdict.verdict must be 'approved'|'rejected' (got '${verdictStr}')`,
    };
  }
  const mergeMethod = typeof obj.merge_method === "string"
    ? obj.merge_method
    : undefined;
  if (
    mergeMethod !== undefined &&
    mergeMethod !== "squash" &&
    mergeMethod !== "merge" &&
    mergeMethod !== "rebase"
  ) {
    return {
      ok: false,
      detail:
        `verdict.merge_method must be 'squash'|'merge'|'rebase' when present (got '${mergeMethod}')`,
    };
  }
  const deleteBranch = typeof obj.delete_branch === "boolean"
    ? obj.delete_branch
    : undefined;
  const ciRequired = typeof obj.ci_required === "boolean"
    ? obj.ci_required
    : undefined;

  return {
    ok: true,
    verdict: {
      schema_version: schemaVersion,
      pr_number: prNumber,
      base_branch: baseBranch,
      verdict: verdictStr,
      merge_method: mergeMethod as Verdict["merge_method"],
      delete_branch: deleteBranch,
      reviewer_summary: reviewerSummary,
      evaluated_at: evaluatedAt,
      reviewer_agent_version: reviewerAgentVersion,
      ci_required: ciRequired,
    },
  };
}

// -----------------------------------------------------------------------------
// Default `gh` implementation (process spawn)
// -----------------------------------------------------------------------------

async function runGh(
  args: string[],
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("gh", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  return {
    success: out.success,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function defaultViewPr(prNumber: number): Promise<PrData> {
  const res = await runGh([
    "pr",
    "view",
    String(prNumber),
    "--json",
    "mergeable,reviewDecision,statusCheckRollup,baseRefName,headRefName",
  ]);
  if (!res.success) {
    throw new Error(`gh pr view failed: ${res.stderr.trim() || res.stdout}`);
  }
  return JSON.parse(res.stdout) as PrData;
}

async function defaultMergePr(
  prNumber: number,
  method: "squash" | "merge" | "rebase",
  deleteBranch: boolean,
): Promise<void> {
  const args = ["pr", "merge", String(prNumber), `--${method}`];
  if (deleteBranch) args.push("--delete-branch");
  const res = await runGh(args);
  if (!res.success) {
    throw new Error(`gh pr merge failed: ${res.stderr.trim() || res.stdout}`);
  }
}

async function defaultSetLabels(
  prNumber: number,
  add: string[],
  remove: string[],
): Promise<void> {
  if (add.length === 0 && remove.length === 0) return;
  const args = ["pr", "edit", String(prNumber)];
  for (const a of add) args.push("--add-label", a);
  for (const r of remove) args.push("--remove-label", r);
  const res = await runGh(args);
  if (!res.success) {
    // Label mutation failure is not fatal to the merge decision; surface it
    // on stderr but do not flip the outcome.
    const msg = res.stderr.trim() || res.stdout.trim();
    await Deno.stderr.write(
      new TextEncoder().encode(`warning: gh pr edit failed: ${msg}\n`),
    );
  }
}

export const defaultGhOps: GhOps = {
  viewPr: defaultViewPr,
  mergePr: defaultMergePr,
  setLabels: defaultSetLabels,
};

// -----------------------------------------------------------------------------
// Core orchestration
// -----------------------------------------------------------------------------

export interface RunArgs {
  pr: number;
  verdictPath: string;
  dryRun: boolean;
  mergeMethodOverride?: "squash" | "merge" | "rebase";
}

export interface RunResult {
  decision: DecisionJson;
}

/**
 * Exhaustive wrapper that performs:
 *   1. verdict load + shape validate (wrapper step 1 / 2)
 *   2. pr_number cross-check (wrapper step 3)
 *   3. gh pr view (wrapper step 4)
 *   4. canMerge pure gates (wrapper step 5)
 *   5. gh pr merge on full pass (wrapper step 7)
 *   6. label mutation
 *
 * Never throws for design-anticipated failures; throws are only raised by
 * programmer errors. Unexpected exceptions propagate to `main` which maps
 * them to exit 1.
 */
export async function run(
  args: RunArgs,
  gh: GhOps = defaultGhOps,
): Promise<RunResult> {
  // Wrapper step 1: load verdict.
  const load = await loadVerdict(args.verdictPath);
  if (!load.ok) {
    return {
      decision: buildDecision({
        prNumber: args.pr,
        reason: load.reason,
        executed: false,
        labels: { added: [], removed: [] },
        error: load.detail,
      }),
    };
  }
  const verdict = load.verdict;

  // Wrapper step 3: pr_number cross-check.
  if (args.pr !== verdict.pr_number) {
    return {
      decision: buildDecision({
        prNumber: args.pr,
        reason: "pr-number-mismatch",
        executed: false,
        labels: { added: [], removed: [] },
        error:
          `--pr ${args.pr} does not match verdict.pr_number ${verdict.pr_number}`,
      }),
    };
  }

  // Wrapper step 4: fetch PR state from GitHub.
  let prData: PrData;
  try {
    prData = await gh.viewPr(args.pr);
  } catch (err) {
    return {
      decision: buildDecision({
        prNumber: args.pr,
        reason: "gh-command-failed",
        executed: false,
        labels: { added: [], removed: [] },
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }

  // Wrapper step 5: pure gate evaluation.
  const gate = canMerge(prData, verdict);
  if (!gate.ok) {
    const outcome = outcomeOfReason(gate.error);
    const labels = labelDeltaFor(outcome);
    // Best-effort label mutation (does not alter the reported outcome).
    await gh.setLabels(args.pr, labels.added, labels.removed);
    return {
      decision: buildDecision({
        prNumber: args.pr,
        reason: gate.error,
        executed: false,
        labels,
      }),
    };
  }

  // Gate passed. Dry-run short-circuits before any mutation.
  if (args.dryRun) {
    return {
      decision: buildDecision({
        prNumber: args.pr,
        reason: null,
        executed: false,
        labels: { added: [], removed: [] },
      }),
    };
  }

  // Wrapper step 7: perform the merge.
  const method = args.mergeMethodOverride ?? verdict.merge_method ?? "squash";
  const deleteBranch = verdict.delete_branch !== false;
  try {
    await gh.mergePr(args.pr, method, deleteBranch);
  } catch (err) {
    return {
      decision: buildDecision({
        prNumber: args.pr,
        reason: "gh-command-failed",
        executed: false,
        labels: { added: [], removed: [] },
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }

  // Merge succeeded: swap labels.
  const mergedLabels = labelDeltaFor("merged");
  await gh.setLabels(args.pr, mergedLabels.added, mergedLabels.removed);

  return {
    decision: {
      ok: true,
      pr_number: args.pr,
      decision: { kind: "merged" },
      reason: null,
      executed: true,
      labels: mergedLabels,
      exit_code: 0,
    },
  };
}

interface BuildDecisionInput {
  prNumber: number | null;
  reason: ReasonCode | null;
  executed: boolean;
  labels: { added: string[]; removed: string[] };
  error?: string;
}

function buildDecision(input: BuildDecisionInput): DecisionJson {
  if (input.reason === null) {
    // Gates passed, no merge executed (dry-run).
    return {
      ok: true,
      pr_number: input.prNumber,
      decision: { kind: "merged" },
      reason: null,
      executed: input.executed,
      labels: input.labels,
      exit_code: 0,
    };
  }
  const outcome = outcomeOfReason(input.reason);
  const exitCode: 0 | 1 | 2 = isRetriable(input.reason) ? 1 : 2;
  const decision: DecisionJson = {
    ok: false,
    "pr_number": input.prNumber,
    decision: { kind: outcome },
    reason: input.reason,
    executed: input.executed,
    labels: input.labels,
    "exit_code": exitCode,
  };
  if (input.error !== undefined) decision.error = input.error;
  return decision;
}

// -----------------------------------------------------------------------------
// CLI entry
// -----------------------------------------------------------------------------

interface CliParseOk {
  ok: true;
  args: RunArgs;
}
interface CliParseErr {
  ok: false;
  error: string;
}

export function parseCli(argv: string[]): CliParseOk | CliParseErr {
  const parsed = parseArgs(argv, {
    string: ["pr", "verdict", "verdict-path", "merge-method"],
    boolean: ["dry-run", "help"],
    alias: { h: "help" },
  });

  if (parsed.help) {
    return { ok: false, error: "HELP" };
  }

  const prRaw = parsed.pr;
  if (typeof prRaw !== "string" || prRaw.length === 0) {
    return { ok: false, error: "--pr is required" };
  }
  const prNum = Number(prRaw);
  if (!Number.isInteger(prNum) || prNum < 1) {
    return {
      ok: false,
      error: `--pr must be a positive integer (got '${prRaw}')`,
    };
  }

  const verdictPath = (parsed.verdict ?? parsed["verdict-path"]) as
    | string
    | undefined;
  if (typeof verdictPath !== "string" || verdictPath.length === 0) {
    return {
      ok: false,
      error: "--verdict (or --verdict-path) is required",
    };
  }

  const method = parsed["merge-method"] as string | undefined;
  if (
    method !== undefined &&
    method !== "squash" &&
    method !== "merge" &&
    method !== "rebase"
  ) {
    return {
      ok: false,
      error:
        `--merge-method must be 'squash'|'merge'|'rebase' (got '${method}')`,
    };
  }

  return {
    ok: true,
    args: {
      pr: prNum,
      verdictPath,
      dryRun: Boolean(parsed["dry-run"]),
      mergeMethodOverride: method as RunArgs["mergeMethodOverride"],
    },
  };
}

const HELP = `merge-pr — deterministic PR merge executor

Usage:
  deno run --allow-read --allow-run --allow-net agents/scripts/merge-pr.ts \\
    --pr <number> --verdict <path> [--dry-run] [--merge-method <method>]

Arguments:
  --pr <number>             GitHub PR number (required)
  --verdict <path>          Path to reviewer verdict JSON (required)
  --verdict-path <path>     Alias for --verdict
  --dry-run                 Evaluate gates only; do not invoke 'gh pr merge'
  --merge-method <m>        Override verdict.merge_method (squash|merge|rebase)

Exit codes:
  0  merge succeeded, or dry-run with full gate pass
  1  retriable (gh command failure, ci-pending)
  2  fatal (verdict-missing, schema-mismatch, rejected, etc.)

Every invocation emits a single decision JSON line on stdout.
`;

function emit(decision: DecisionJson): void {
  // Single-line JSON for trivial log ingestion.
  const line = JSON.stringify(decision);
  // Use raw write to avoid `no-console` lint rule while staying stdout-bound.
  Deno.stdout.writeSync(new TextEncoder().encode(line + "\n"));
}

async function main(): Promise<number> {
  const parsed = parseCli(Deno.args);
  if (!parsed.ok) {
    if (parsed.error === "HELP") {
      await Deno.stdout.write(new TextEncoder().encode(HELP));
      return 0;
    }
    await Deno.stderr.write(
      new TextEncoder().encode(`error: ${parsed.error}\n${HELP}`),
    );
    return 2;
  }

  try {
    const { decision } = await run(parsed.args);
    emit(decision);
    return decision.exit_code;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({
      ok: false,
      pr_number: parsed.args.pr,
      decision: { kind: "rejected" },
      reason: "gh-command-failed",
      executed: false,
      labels: { added: [], removed: [] },
      exit_code: 1,
      error: msg,
    });
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
