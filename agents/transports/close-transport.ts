/**
 * `CloseTransport` — independent seam for issue close-write (design 12 §C P2
 * polarity, design 20 §B `TransportPolicy.close`).
 *
 * Three variants form a closed ADT keyed on `kind`:
 *  - `real` — shells out to `gh issue close` (or delegates to an existing
 *    `GitHubClient.closeIssue`). Used in production / `TransportPolicy.close
 *    === "real"`.
 *  - `file` — appends a record to `${logDir}/closed-issues.jsonl`. Used by
 *    fixture-mode (`TransportPolicy.close === "file"`) where the run writes
 *    a transcript of intended closes without touching the upstream API.
 *  - `mock` — pushes the closed `subjectId` onto a caller-supplied array.
 *    Used by unit tests that want to inspect close requests without
 *    filesystem I/O.
 *
 * P4-1 scope (this file): the seam exists and the three factories are
 * usable. The `real` factory delegates back to an existing
 * `GitHubClient.closeIssue` rather than embedding the gh CLI invocation
 * here — splitting `GhCliClient` is a downstream task (T4.2 full split,
 * tracked in plan revisions). The seam itself is the contract that lets
 * channels execute close without coupling to `GitHubClient`.
 *
 * Distinguished from `IssueQueryTransport` (read-side) which lives
 * separately. This file owns the **write** side only.
 *
 * @see agents/docs/design/realistic/12-workflow-config.md §C
 * @see agents/docs/design/realistic/20-state-hierarchy.md §B
 * @see tmp/realistic-migration/phased-plan.md §P4 T4.2
 *
 * @module
 */

import type { SubjectRef } from "../orchestrator/workflow-types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Closed ADT discriminator for the three transport variants.
 *
 * Keep narrow — the Realistic anti-list forbids new transport variants
 * without an explicit design revision. Adding a 4th value here also
 * requires extending {@link TransportPolicy.close}.
 */
export type CloseTransportKind = "real" | "file" | "mock";

/**
 * Close-write seam contract.
 *
 * `close` is async, returns void on success, and throws on transport
 * failure. Channel.execute call sites translate thrown failures into
 * `IssueCloseFailedEvent`; success publishes `IssueClosedEvent`.
 *
 * The contract is intentionally narrower than `GitHubClient.closeIssue`:
 * it accepts only the subject identifier and returns no payload.
 * Auxiliary actions (comments, label updates) are independent transport
 * calls handled outside this seam.
 */
export interface CloseTransport {
  readonly kind: CloseTransportKind;
  close(subjectId: SubjectRef): Promise<void>;
}

/**
 * Subset of `GitHubClient` consumed by the `real` transport. Defined
 * structurally so callers do not need to import the full client interface
 * (and so tests can supply a minimal stub).
 */
export interface CloseTransportGithub {
  closeIssue(subjectId: SubjectRef): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Construct a `real` transport that delegates to an existing
 * `GitHubClient.closeIssue` implementation.
 *
 * Why not embed the gh CLI invocation here in P4-1: the existing
 * `GhCliClient.closeIssue` is already exercised by integration tests; a
 * second copy of the gh invocation logic would create a divergence
 * surface. T4.2's full split moves the invocation here in a later PR.
 *
 * @param github An object exposing `closeIssue(subjectId)` — typically the
 *               `GitHubClient` instance constructed by the orchestrator.
 * @returns A frozen `CloseTransport` of `kind: "real"`.
 */
export const createRealCloseTransport = (
  github: CloseTransportGithub,
): CloseTransport => {
  return Object.freeze({
    kind: "real" as const,
    close(subjectId: SubjectRef): Promise<void> {
      return github.closeIssue(subjectId);
    },
  });
};

/**
 * Construct a `file` transport that appends one JSON record per close to
 * `${logDir}/closed-issues.jsonl`.
 *
 * Used by fixture-mode (`TransportPolicy.close === "file"`) so the run
 * produces a deterministic transcript without touching gh. Best-effort
 * mkdir on first call; per-write errors propagate to the channel
 * `execute` so the bus can publish `IssueCloseFailedEvent`.
 *
 * @param logDir Absolute directory in which to create the JSONL file.
 * @returns A frozen `CloseTransport` of `kind: "file"`.
 */
export const createFileCloseTransport = (logDir: string): CloseTransport => {
  const logPath = `${logDir}/closed-issues.jsonl`;
  let mkdirAttempted = false;
  return Object.freeze({
    kind: "file" as const,
    async close(subjectId: SubjectRef): Promise<void> {
      if (!mkdirAttempted) {
        mkdirAttempted = true;
        try {
          await Deno.mkdir(logDir, { recursive: true });
        } catch {
          // Best-effort: writeTextFile below will surface a fatal error
          // if the directory is genuinely missing.
        }
      }
      const line = JSON.stringify({
        subjectId,
        closedAt: Date.now(),
      }) + "\n";
      await Deno.writeTextFile(logPath, line, {
        append: true,
        create: true,
      });
    },
  });
};

/**
 * Construct a `mock` transport that records every requested close into a
 * caller-supplied array.
 *
 * Tests typically pass an empty array and then assert on its contents
 * after the channel under test fires. The array is mutated in place; the
 * transport itself is frozen.
 *
 * @param closed Array that receives one `subjectId` per `close` call.
 * @returns A frozen `CloseTransport` of `kind: "mock"`.
 */
export const createMockCloseTransport = (
  closed: SubjectRef[],
): CloseTransport => {
  return Object.freeze({
    kind: "mock" as const,
    close(subjectId: SubjectRef): Promise<void> {
      closed.push(subjectId);
      return Promise.resolve();
    },
  });
};
