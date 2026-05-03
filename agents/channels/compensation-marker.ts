/**
 * Compensation marker factory + comment body composer.
 *
 * Single source of truth for the deterministic string that
 * {@link CompensationCommentChannel} embeds in every comp comment so
 * retries can deduplicate. Both producer (channel post) and consumer
 * (channel re-read on retry) call this so the marker has exactly one
 * authoritative definition (Anti-Pattern: hardcoded test expectations,
 * test-design rule §1).
 *
 * Scope: `(subjectId, runId)`. Per-run uniqueness lets a fresh run
 * (post-operator-intervention) emit a new compensation if its close
 * fails again, without being suppressed by an old marker. The marker
 * format itself is opaque outside of this file.
 *
 * Why not the legacy `(subjectId, cycleSeq)` shape: the saga-driven
 * cycleSeq disappears with the W13 saga rollback removal. `runId` is
 * the available alternative correlation key from `BootArtifacts.runId`.
 *
 * @module
 */

import type { SubjectRef } from "../orchestrator/workflow-types.ts";

/**
 * Marker string embedded in a compensation comment.
 *
 * Returns a single line that the consumer scans for via
 * `string.includes`. Format intentionally narrow: any drift here
 * desynchronises producer/consumer dedup.
 */
export const compensationMarker = (
  subjectId: SubjectRef,
  runId: string,
): string => `climpt-compensation:subject-${subjectId}:run-${runId}`;

/**
 * Compose the full comment body for a compensation post.
 *
 * Structure:
 *  - Visible warning header for human readers in the GitHub UI.
 *  - Reason line so the operator sees the transport's failure cause.
 *  - `<sub>` footer carrying the marker (visible but compact); the
 *    marker is the dedup key.
 *
 * Returned object exposes both the marker (for the consumer's recent-
 * comment scan) and the full text (for `addIssueComment`).
 */
export const compensationCommentBody = (input: {
  readonly subjectId: SubjectRef;
  readonly runId: string;
  readonly reason: string;
}): { readonly marker: string; readonly text: string } => {
  const marker = compensationMarker(input.subjectId, input.runId);
  const text = `⚠️ 自動遷移失敗: 手動確認をお願いします\n\n` +
    `Issue close failed during phase transition.\nReason: ${input.reason}\n\n` +
    `---\n<sub>🤖 ${marker}</sub>`;
  return { marker, text };
};
