/**
 * SubjectPicker — Realistic dispatch front-end (T5.1).
 *
 * Per design 15 §B / 11 §B / 12 §E, the SubjectPicker constructs a
 * `SubjectQueue` for the orchestrator's CycleLoop. The queue is the
 * single seam where `run-workflow` and `run-agent` modes diverge:
 * the **same instance type** is used in both modes — only the input
 * source differs (gh listing vs. argv lift). Downstream consumers
 * (CycleLoop, AgentRuntime, Channels) cannot tell the modes apart
 * (R5 hard gate, 11 §C).
 *
 * Two factories:
 *   - `fromIssueSyncer(workflow, issueSyncer)` — workflow mode. Calls
 *     `IssueSyncer.sync(workflow.issueSource)` and lifts the resulting
 *     subject ids into a queue with `source: "workflow"`.
 *   - `fromArgv({ subjectId })` — agent mode. Builds a length-1 queue
 *     directly from CLI argv, bypassing the IssueQueryTransport seam
 *     ("the SubjectPicker is traversed, but the input source is argv"
 *     — 11 §B B11 修復).
 *
 * Notes for T5.1:
 *   - The queue items today carry only `{ subjectId, source }`. The
 *     `priority` slot is reserved for the prePass reordering path
 *     (12 §D2) which lands after T5.2's W11 wires up.
 *   - The picker is intentionally I/O-light: `pick()` calls the
 *     IssueSyncer once and returns the queue. Reordering / filtering
 *     happens elsewhere (Queue / Prioritizer) — T5.1 only carves out
 *     the seam.
 *
 * Design refs:
 *   - `agents/docs/design/realistic/12-workflow-config.md` §D / §E
 *   - `agents/docs/design/realistic/15-dispatch-flow.md` §B / §C
 *   - `agents/docs/design/realistic/11-invocation-modes.md` §B / §C
 *   - `tmp/realistic-migration/phased-plan.md` Phase 5 / T5.1
 *
 * @module
 */

import type { SubjectRef, WorkflowConfig } from "./workflow-types.ts";
import type { IssueSyncer } from "./issue-syncer.ts";

/**
 * One entry in the {@link SubjectQueue}.
 *
 * `source` discriminates how the subject id reached the queue:
 *   - `"workflow"` — produced by `IssueSyncer.sync` (run-workflow mode).
 *   - `"argv"` — lifted from CLI argv (run-agent mode).
 *   - `"prePass"` — reserved for the prioritizer pre-pass output
 *     (12 §D2). T5.1 does not populate this variant.
 */
export interface SubjectQueueItem {
  readonly subjectId: SubjectRef;
  readonly source: "workflow" | "argv" | "prePass";
  /**
   * Optional ordering hint emitted by the prioritizer pre-pass. Lower
   * numbers fire first. Absent when the picker has not consulted a
   * prioritizer (the T5.1 baseline).
   */
  readonly priority?: number;
}

/** Immutable snapshot of the queue produced by {@link SubjectPicker.pick}. */
export type SubjectQueue = ReadonlyArray<SubjectQueueItem>;

/**
 * Strategy abstraction for the per-mode `pick()` body. Each factory
 * supplies a closure that produces the queue without leaking
 * mode-specific dependencies onto the SubjectPicker class itself.
 */
type PickStrategy = () => Promise<SubjectQueue>;

/**
 * SubjectPicker — produces a `SubjectQueue` for the orchestrator's
 * cycle loop. See module docstring for the mode-invariance contract.
 */
export class SubjectPicker {
  readonly #strategy: PickStrategy;

  /** @internal Use the static factories instead. */
  private constructor(strategy: PickStrategy) {
    this.#strategy = strategy;
  }

  /**
   * Run-workflow factory. Wraps an existing {@link IssueSyncer} so the
   * picker delegates the gh-listing / fixture-listing transport choice
   * to the seam already present in `BatchRunner` and friends.
   *
   * The picker calls `issueSyncer.sync(workflow.issueSource)` exactly
   * once per `pick()` invocation. Consumers (BatchRunner) call `pick()`
   * once per batch.
   */
  static fromIssueSyncer(
    workflow: WorkflowConfig,
    issueSyncer: IssueSyncer,
  ): SubjectPicker {
    const strategy: PickStrategy = async () => {
      const ids = await issueSyncer.sync(workflow.issueSource);
      return ids.map((subjectId) => ({
        subjectId,
        source: "workflow" as const,
      }));
    };
    return new SubjectPicker(strategy);
  }

  /**
   * Run-agent factory. Returns a length-1 queue containing the
   * argv-supplied subject id, never touching the IssueQueryTransport
   * (11 §B "input source is argv, not bypass").
   */
  static fromArgv(opts: { readonly subjectId: SubjectRef }): SubjectPicker {
    const item: SubjectQueueItem = {
      subjectId: opts.subjectId,
      source: "argv",
    };
    const queue: SubjectQueue = [item];
    const strategy: PickStrategy = () => Promise.resolve(queue);
    return new SubjectPicker(strategy);
  }

  /**
   * Resolve the queue. Each call returns a fresh snapshot so callers
   * can iterate without worrying about hidden mutation.
   */
  async pick(): Promise<SubjectQueue> {
    return await this.#strategy();
  }
}
