/**
 * `MergeCloseAdapter` — parent-side IPC bridge for the merge-pr subprocess
 * (PR4-4 T4.5, Critique F15).
 *
 * The `merge-pr` CLI runs as an independent subprocess (design 11 §D);
 * after a successful `gh pr merge`, GitHub's server auto-closes the issue
 * referenced by `Closes #N` in the PR body. The framework itself never
 * calls `closeIssue` for the M channel — but the close MUST surface on
 * the parent's `CloseEventBus` as `IssueClosedEvent({ channel: "M" })` so
 * downstream subscribers (CompensationCommentChannel, OutboxClosePost,
 * CascadeClose, diagnostic logger, R5 test) observe it uniformly with the
 * other 5 channels (R5 hard gate, design 11 §C step 5 / 30 §E).
 *
 * The IPC strategy (Critique F15 — Typed Outbox):
 *  1. `merge-pr.ts` writes one JSON record per successful merge to
 *     `tmp/merge-close-facts/<runId>.jsonl` (or, when standalone-invoked
 *     without a parent runId, a generic `standalone.jsonl`). The record
 *     is an `OutboxAction({ action: "merge-close-fact" })` — same closed
 *     enum as in-process outbox actions, validated by
 *     {@link validateMergeCloseFact}. No bespoke close-fact schema lives
 *     outside the OutboxAction discriminated union.
 *  2. The parent's `MergeCloseAdapter` reads the JSONL once at boot
 *     (replaying any stale facts) and then again at every cycle
 *     boundary (`drain`). Each consumed fact publishes
 *     `IssueClosedEvent({ channel: "M" })` to the bus and then the
 *     fact line is removed from the file (idempotent — re-running
 *     `merge-pr` for the same `(subjectId, runId)` produces the same
 *     bus event exactly once per fact).
 *  3. Idempotency is by **per-run truncation**: after consume the
 *     adapter rewrites the JSONL with only the unconsumed lines. A
 *     duplicate fact written between drain calls would fire twice — by
 *     design, since each successful merge subprocess is one atomic
 *     close.
 *
 * Design refs:
 *  - To-Be `agents/docs/design/realistic/tobe/channels/44-channel-M.md`
 *    §A (shared Boot), §C (Transport), §F (responsibility).
 *  - Realistic `channels/00-realistic-binding.md` §A row 5.
 *  - `agents/docs/design/realistic/11-invocation-modes.md` §D (merge-pr
 *    publishes via Oracle).
 *  - `tmp/realistic-migration/critique.md` F15 (Typed Outbox principle).
 *
 * Notes on semantics:
 *  - This is **not** a `Channel` implementation. The `MergeCloseChannel`
 *    in `merge-close.ts` keeps `decide` returning `skip` (the channel
 *    has no event to subscribe to — channels/00 §A row 5 says
 *    "publish のみ、subscribe 無し"). The bus publication is the
 *    adapter's job; the channel's `register` is a no-op observation
 *    seat for R5 traceability reflection.
 *  - The adapter does NOT call `closeTransport.close`. GitHub's server
 *    has already closed the issue server-side; calling close from the
 *    framework would be a redundant write (and would fail when the
 *    issue is already closed).
 *
 * @module
 */

import type { CloseEventBus } from "../events/bus.ts";
import type { SubjectRef } from "../orchestrator/workflow-types.ts";
import {
  type MergeCloseFactAction,
  validateMergeCloseFact,
} from "../orchestrator/outbox-processor.ts";

// ---------------------------------------------------------------------------
// Path conventions
// ---------------------------------------------------------------------------

/**
 * Default fact-file root, relative to the parent process's `cwd`.
 *
 * `merge-pr` writes to `<cwd>/tmp/merge-close-facts/<runId>.jsonl` when
 * the parent's runId is supplied via env (`CLIMPT_PARENT_RUN_ID`); the
 * adapter consumes from the same path. The directory is created on
 * first write.
 */
export const MERGE_CLOSE_FACTS_DIR = "tmp/merge-close-facts";

/**
 * Resolve the per-run JSONL path for a given (cwd, runId) pair.
 *
 * The runId is path-prefixed onto the fact file so concurrent boots do
 * not commingle their fact streams. Standalone merge-pr invocations
 * (no parent runId in env) write to `standalone.jsonl` — the adapter
 * does not consume that path by default (a standalone parent has no
 * adapter), so those facts accumulate harmlessly until the user
 * deletes them.
 */
export function mergeCloseFactPath(cwd: string, runId: string): string {
  // runId is `crypto.randomUUID()` (boot-types.ts) — opaque string with
  // characters that are filesystem-safe. No sanitisation needed.
  return `${cwd}/${MERGE_CLOSE_FACTS_DIR}/${runId}.jsonl`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link MergeCloseAdapter}.
 */
export interface MergeCloseAdapterOpts {
  readonly bus: CloseEventBus;
  readonly runId: string;
  /**
   * Process working directory; the JSONL fact file is resolved from
   * this. Defaults to `Deno.cwd()` for production callers that mirror
   * `BootKernel.boot({ cwd })`.
   */
  readonly cwd: string;
  /**
   * Override the fact-file path. Tests pass an explicit path to avoid
   * stomping the production `tmp/merge-close-facts/<runId>.jsonl`. When
   * omitted, derived from `cwd` + `runId` via {@link mergeCloseFactPath}.
   */
  readonly factFilePath?: string;
}

/**
 * Drain result for diagnostic / test inspection.
 */
export interface DrainResult {
  /**
   * Number of facts successfully published as `IssueClosedEvent(M)`.
   */
  readonly published: number;
  /**
   * Number of JSONL lines that failed structural validation. Quarantined
   * (skipped) — the adapter logs to `console.warn` so a corrupt line
   * does not block subsequent valid facts.
   */
  readonly invalid: number;
  /**
   * Subject ids of every fact published in this drain (insertion order).
   * Useful for assertion in tests; production callers ignore this.
   */
  readonly publishedSubjects: ReadonlyArray<SubjectRef>;
}

/**
 * Parent-process IPC consumer for `merge-pr` close facts.
 *
 * Lifecycle:
 *  - Construct inside `BootKernel.boot` (or comparable test setup).
 *  - Call `drain()` at every cycle boundary (orchestrator end-of-cycle,
 *    end-of-run) to publish accumulated facts.
 *  - The adapter is idempotent across drain calls — once a fact is
 *    consumed it is removed from the JSONL file.
 */
export class MergeCloseAdapter {
  readonly #bus: CloseEventBus;
  readonly #runId: string;
  readonly #factFilePath: string;

  constructor(opts: MergeCloseAdapterOpts) {
    this.#bus = opts.bus;
    this.#runId = opts.runId;
    this.#factFilePath = opts.factFilePath ??
      mergeCloseFactPath(opts.cwd, opts.runId);
  }

  /**
   * Read the fact file, publish one `IssueClosedEvent(M)` per valid
   * line, and truncate the file. Returns a {@link DrainResult} for
   * diagnostic inspection.
   *
   * The implementation is fail-soft:
   *  - Missing fact file → `{ published: 0, invalid: 0 }` (the common
   *    case — no merge-pr ran in this run yet).
   *  - JSON parse error on a line → counted as `invalid`, `console.warn`
   *    emitted, line discarded.
   *  - Schema validation error → counted as `invalid`, line discarded.
   *  - Successful publish → fact removed from file.
   *
   * **Order of operations**: read all lines → validate → publish each
   * valid fact (in JSONL insertion order) → atomically truncate the
   * file (write empty contents, since every successful line was
   * consumed and invalid lines are intentionally discarded). The
   * truncate happens AFTER publishing so a publish-side throw does not
   * lose facts. (Bus publish swallows handler errors per
   * `events/bus.ts` F7, so in practice publish does not throw.)
   */
  async drain(): Promise<DrainResult> {
    let raw: string;
    try {
      raw = await Deno.readTextFile(this.#factFilePath);
    } catch (cause) {
      if (cause instanceof Deno.errors.NotFound) {
        return { published: 0, invalid: 0, publishedSubjects: [] };
      }
      throw cause;
    }

    const lines = raw.split("\n").filter((l) => l.length > 0);
    const publishedSubjects: SubjectRef[] = [];
    let invalid = 0;

    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        // deno-lint-ignore no-console
        console.warn(
          `[MergeCloseAdapter] Skipping invalid JSONL line: ${msg}`,
        );
        invalid += 1;
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) {
        // deno-lint-ignore no-console
        console.warn(
          "[MergeCloseAdapter] Skipping non-object line in fact file",
        );
        invalid += 1;
        continue;
      }
      let fact: MergeCloseFactAction;
      try {
        fact = validateMergeCloseFact(parsed as Record<string, unknown>);
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        // deno-lint-ignore no-console
        console.warn(`[MergeCloseAdapter] Skipping invalid fact: ${msg}`);
        invalid += 1;
        continue;
      }
      // Cross-runId facts are observed but published — the parent's
      // boot writes facts under its own runId, so a mismatch usually
      // means the merge-pr subprocess inherited a different runId
      // (e.g. when invoked from a separate boot). Publishing keeps
      // the close visible on the bus; the runId on the published
      // event is the parent's, not the fact's, because event.runId
      // identifies the consumer's correlation context (10 §B).
      this.#bus.publish({
        kind: "issueClosed",
        publishedAt: Date.now(),
        runId: this.#runId,
        subjectId: fact.subjectId,
        channel: "M",
      });
      publishedSubjects.push(fact.subjectId);
    }

    // Truncate (idempotent consume): every line was either published
    // or quarantined. Write empty contents so a subsequent drain on
    // the same boot reads zero lines.
    if (lines.length > 0) {
      await Deno.writeTextFile(this.#factFilePath, "");
    }

    return {
      published: publishedSubjects.length,
      invalid,
      publishedSubjects,
    };
  }
}

// ---------------------------------------------------------------------------
// Subprocess-side write helper
// ---------------------------------------------------------------------------

/**
 * Append a `merge-close-fact` OutboxAction to the parent's JSONL file.
 *
 * Called by `merge-pr.ts` after a successful `gh pr merge`. The path
 * is derived from `cwd` + `runId` using {@link mergeCloseFactPath} so
 * subprocess + parent agree on the rendezvous point structurally
 * (no environment-specific path negotiation).
 *
 * Best-effort `mkdir -p` on the parent directory; per-write errors
 * propagate to the caller so the merge-pr exit code reflects "merged
 * but parent IPC failed". The fact file is the authoritative IPC
 * surface — losing a write means losing the bus event.
 *
 * @param fact   The validated fact payload.
 * @param cwd    Parent process working directory (passed by merge-pr
 *               as `Deno.cwd()` — the subprocess inherits the parent's
 *               cwd by default; entry-point validation is the caller's
 *               responsibility).
 */
export async function writeMergeCloseFact(
  fact: MergeCloseFactAction,
  cwd: string,
): Promise<void> {
  const path = mergeCloseFactPath(cwd, fact.runId || "standalone");
  const dir = path.substring(0, path.lastIndexOf("/"));
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch {
    // Best-effort: writeTextFile below surfaces a fatal error if the
    // directory is genuinely missing.
  }
  const line = JSON.stringify(fact) + "\n";
  await Deno.writeTextFile(path, line, { append: true, create: true });
}
