/**
 * Label Sync - Idempotent pre-dispatch label reconciliation.
 *
 * Reads declarative `labels` specs from workflow.json and reconciles
 * them against the GitHub repository label set. Per-label try/catch
 * isolates failures so a single permission / transport error does not
 * abort the rest of the batch. Caller logs aggregate results and
 * decides whether to continue — this module never throws for
 * individual label failures.
 *
 * Design rationale: agents/docs/design/... (Phase 2 of the
 * label-bootstrap-failure remediation). The previous bash-based
 * bootstrap (triager prompt, Step 1) was fragile under `set -e` and
 * hid color/description metadata inside a prompt file. By moving
 * specs to workflow.json and the sync logic to TypeScript, we get
 * per-label error isolation and a single source of truth.
 */

import type { GitHubClient, LabelDetail } from "./github-client.ts";
import type { LabelSpec } from "./workflow-types.ts";

/** Classification of per-label sync outcomes. */
export type SyncAction = "created" | "updated" | "nochange" | "failed";

/** Result of syncing a single label. */
export interface SyncResult {
  name: string;
  action: SyncAction;
  /** Present only when action === "failed". */
  error?: string;
}

/** Options for the top-level sync entry point. */
export interface SyncOptions {
  /**
   * When true, compute what would change but skip create/update
   * gh calls. Returns `created`/`updated`/`nochange` as if the
   * operation had succeeded so callers can still log a summary.
   */
  dryRun?: boolean;
}

/**
 * Compare current label state to declared specs and return the
 * needed action. Pure function — no I/O.
 *
 * Used by syncLabels internally and exported for unit testing /
 * reuse in dry-run reporting.
 */
export function decideLabelAction(
  spec: LabelSpec,
  current: LabelDetail | undefined,
): Exclude<SyncAction, "failed"> {
  if (!current) return "created";
  const currentColor = current.color.toLowerCase();
  const specColor = spec.color.toLowerCase();
  if (
    currentColor === specColor &&
    current.description === spec.description
  ) {
    return "nochange";
  }
  return "updated";
}

/**
 * Sync label specs against the repository via the provided GitHubClient.
 *
 * Behavior:
 * - Calls `listLabelsDetailed()` once to snapshot the current state.
 *   Failure here throws (caller cannot proceed without a baseline).
 * - For each spec, dispatches to create/update/nochange per the
 *   decision function above. Per-label errors are captured into
 *   `SyncResult.error` and do NOT abort the batch.
 * - Order of returned results matches declaration order in `specs`
 *   (stable, deterministic).
 *
 * @param github    GitHubClient implementation (gh CLI or file-based)
 * @param specs     Label name → spec mapping from workflow.json#labels
 * @param options   dryRun skips create/update calls but still classifies
 */
export async function syncLabels(
  github: GitHubClient,
  specs: Readonly<Record<string, LabelSpec>>,
  options: SyncOptions = {},
): Promise<SyncResult[]> {
  const dryRun = options.dryRun ?? false;

  const current = await github.listLabelsDetailed();
  const currentByName = new Map<string, LabelDetail>();
  for (const label of current) {
    currentByName.set(label.name, label);
  }

  const results: SyncResult[] = [];
  for (const [name, spec] of Object.entries(specs)) {
    const action = decideLabelAction(spec, currentByName.get(name));

    if (action === "nochange") {
      results.push({ name, action });
      continue;
    }

    if (dryRun) {
      results.push({ name, action });
      continue;
    }

    try {
      if (action === "created") {
        // deno-lint-ignore no-await-in-loop -- sequential by design: per-label try/catch + order preservation + gh rate-limit friendliness
        await github.createLabel(name, spec.color, spec.description);
      } else {
        // deno-lint-ignore no-await-in-loop -- sequential by design (same rationale)
        await github.updateLabel(name, spec.color, spec.description);
      }
      results.push({ name, action });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push({ name, action: "failed", error: msg });
    }
  }

  return results;
}

/**
 * Human-readable summary line from sync results. Counts by action —
 * callers typically log this alongside the full `SyncResult[]` for
 * post-mortem analysis.
 */
export function summarizeSync(results: readonly SyncResult[]): string {
  const counts: Record<SyncAction, number> = {
    created: 0,
    updated: 0,
    nochange: 0,
    failed: 0,
  };
  for (const r of results) {
    counts[r.action]++;
  }
  return (
    `labels: ${results.length} total ` +
    `(created=${counts.created}, updated=${counts.updated}, ` +
    `nochange=${counts.nochange}, failed=${counts.failed})`
  );
}
