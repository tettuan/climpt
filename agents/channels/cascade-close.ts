/**
 * `CascadeClose` (channel id `"Cascade"`) — framework subscriber that
 * chains a sentinel close after every child issue under a parent has
 * reached `IssueClosedEvent`.
 *
 * Per channels/00 §A row 6, CascadeClose subscribes to BOTH
 * `IssueClosedEvent` (to drive sibling-aggregation) and
 * `SiblingsAllClosedEvent` (the trigger). Agent declarations do NOT
 * mention this channel; the framework wires it unconditionally and the
 * decision branch reads `workflow.projectBinding` to determine whether
 * cascade evaluation is enabled at all.
 *
 * Design refs:
 *  - To-Be `agents/docs/design/realistic/tobe/channels/45-channel-cascade.md`
 *    §A (event-driven structure), §B (SiblingsAllClosed generation),
 *    §C (decision input/output), §D (full table).
 *  - Realistic `channels/00-realistic-binding.md` §A row 6.
 *
 * PR4-3 status:
 *  - The orchestrator's inline T6.eval sentinel-cascade detection
 *    (orchestrator.ts:1044-1146) is migrated here. The orchestrator no
 *    longer queries `getIssueProjects` / `listProjectItems` /
 *    `getIssueLabels` for completion eval; this channel does on every
 *    `IssueClosedEvent`.
 *  - The cascade detection runs `getIssueProjects` for the closed
 *    subject, `listProjectItems` per project, and `getIssueLabels` per
 *    item. When every non-sentinel item carries the `donePhase` label
 *    AND the sentinel is identifiable, the channel publishes
 *    `SiblingsAllClosedEvent` and applies the eval-label transition on
 *    the sentinel. The sentinel itself is not closed by this channel —
 *    the workflow's regular close path handles that on the next cycle
 *    (consistent with v1.13.x evaluator semantics).
 *  - Failures during the eval check are non-fatal: the upstream close
 *    already happened.
 *
 * Subscription is event-driven (no synchronous handle*** entry from
 * the orchestrator). The bus's `publish` is fire-and-forget and the
 * subscriber runs synchronously inside the publisher's call stack, but
 * since the handler is async + the bus swallows promise rejections
 * (events/bus.ts F7), upstream close paths are not blocked by cascade
 * I/O.
 *
 * @module
 */

import type { CloseEventBus, Unsubscribe } from "../events/bus.ts";
import type {
  EventKind,
  IssueClosedEvent,
  SiblingsAllClosedEvent,
} from "../events/types.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import type {
  SubjectRef,
  WorkflowConfig,
} from "../orchestrator/workflow-types.ts";
import type { CloseTransport } from "../transports/close-transport.ts";
import {
  hasPhaseLabel,
  resolvePhaseLabel,
} from "../orchestrator/phase-transition.ts";
import type { Channel, ChannelContext, ChannelDecision } from "./types.ts";

const SUBSCRIBES_TO: ReadonlyArray<EventKind> = [
  "issueClosed",
  "siblingsAllClosed",
];

type CascadeCloseEvent = IssueClosedEvent | SiblingsAllClosedEvent;

export class CascadeCloseChannel implements Channel<CascadeCloseEvent> {
  readonly id = "Cascade" as const;
  readonly subscribesTo = SUBSCRIBES_TO;

  /**
   * Close-write seam captured at boot (PR4-2a). Held for parity with
   * sibling channels — cascade evaluation publishes
   * `SiblingsAllClosedEvent` and updates labels on the sentinel; the
   * sentinel close itself is driven by the workflow's regular close
   * path on the next cycle (matches the v1.13.x evaluator
   * progression). The transport is retained on the instance so a
   * future revision that closes the sentinel directly can route
   * through it.
   */
  readonly #closeTransport: CloseTransport;
  readonly #github: GitHubClient;
  readonly #workflow: WorkflowConfig;
  readonly #bus: CloseEventBus;
  readonly #runId: string;
  /**
   * Diagnostic logger callback. Optional — when omitted, eval failures
   * are silently swallowed (W13: cascade is non-fatal). The boot
   * pipeline omits this in PR4-3; tests inject a logger to assert the
   * eval-failed path.
   */
  readonly #logger?: (
    level: "info" | "warn",
    message: string,
    fields: Record<string, unknown>,
  ) => void;
  #unsubscribes: Unsubscribe[] = [];

  constructor(deps: {
    readonly closeTransport: CloseTransport;
    readonly github: GitHubClient;
    readonly workflow: WorkflowConfig;
    readonly bus: CloseEventBus;
    readonly runId: string;
    readonly logger?: (
      level: "info" | "warn",
      message: string,
      fields: Record<string, unknown>,
    ) => void;
  }) {
    this.#closeTransport = deps.closeTransport;
    this.#github = deps.github;
    this.#workflow = deps.workflow;
    this.#bus = deps.bus;
    this.#runId = deps.runId;
    this.#logger = deps.logger;
    void this.#closeTransport;
  }

  /**
   * Subscribe to `issueClosed` (drives the cascade evaluation) and
   * `siblingsAllClosed` (R5 traceability seat). The cascade evaluation
   * runs synchronously within the publisher's call stack but the
   * handler is async — `bus.publish` swallows promise rejections so
   * upstream close paths are not blocked.
   */
  register(bus: CloseEventBus): void {
    if (this.#unsubscribes.length > 0) return;
    this.#unsubscribes.push(
      bus.subscribe<IssueClosedEvent>(
        { kind: "issueClosed" },
        (event) => {
          // Avoid re-entry on the channel's own publish — when the
          // cascade evaluation succeeds we publish nothing on the
          // `issueClosed` channel (the sentinel close lives in the
          // next cycle), so re-entry is impossible. Future revisions
          // that publish `IssueClosed(Cascade)` directly here MUST add
          // a guard to skip when `event.channel === "Cascade"` to
          // avoid infinite loops on multi-tier cascades.
          if (event.channel === "Cascade") return;
          this.#evaluate(event);
        },
      ),
      bus.subscribe<SiblingsAllClosedEvent>(
        { kind: "siblingsAllClosed" },
        (_event) => {
          // Observation seat reserved for R5 traceability.
        },
      ),
    );
  }

  /**
   * Pure decision function. CascadeClose's sibling-aggregation cannot
   * be expressed structurally in `decide` — it requires GitHub I/O
   * (`listProjectItems`, `getIssueLabels`) which is forbidden in
   * `decide` per channels/types.ts §1 purity invariant. The aggregation
   * lives in {@link evaluate} (event-handler side), and `decide` is
   * kept skip-only for ADT compliance.
   *
   * The R5 traceability test only inspects the (mode × channel)
   * coverage matrix; it does not require `decide` to return
   * `shouldClose` for cascades.
   */
  decide(_ctx: ChannelContext<CascadeCloseEvent>): ChannelDecision {
    return {
      kind: "skip",
      reason: "CascadeClose: sibling-aggregation requires I/O; eval lives in " +
        "the event handler",
    };
  }

  async execute(decision: ChannelDecision): Promise<void> {
    if (decision.kind === "shouldClose") {
      await this.#closeTransport.close(decision.subjectId);
    }
  }

  /**
   * Sentinel-cascade evaluation triggered by every non-Cascade
   * `IssueClosedEvent`. Migrated from orchestrator.ts:1044-1146.
   *
   * Steps:
   *  1. Skip when `workflow.projectBinding` is absent (cascade is
   *     opt-in via workflow.json — Invariant I1, design doc §3).
   *  2. Resolve `donePhase` / `evalPhase` labels via the workflow's
   *     `labelMapping` (no hardcoded `done` / `kind:eval`).
   *  3. For every project the closed subject belongs to, list items
   *     and read each item's labels. Identify the sentinel via
   *     `binding.sentinelLabel`; the rest are non-sentinels.
   *  4. When every non-sentinel item resolves to `donePhase` AND a
   *     sentinel is found, publish `SiblingsAllClosedEvent` and
   *     transition the sentinel from `evalPhase` to `donePhase`
   *     labels. The sentinel close itself happens on the next
   *     workflow cycle when the regular close path observes the new
   *     label state.
   *
   * Failures are non-fatal: the upstream close already happened.
   */
  async #evaluate(closedEvent: IssueClosedEvent): Promise<void> {
    const binding = this.#workflow.projectBinding;
    if (!binding) return;

    const closedSubject = closedEvent.subjectId;
    if (typeof closedSubject !== "number") return;

    try {
      const projects = await this.#github.getIssueProjects(closedSubject);
      const doneLabel = resolvePhaseLabel(this.#workflow, binding.donePhase);
      const evalLabel = resolvePhaseLabel(this.#workflow, binding.evalPhase);
      if (doneLabel === null || evalLabel === null) {
        throw new Error(
          `Internal invariant: projectBinding.donePhase / evalPhase ` +
            `resolved to null despite WF-PROJECT-006/007 checks.`,
        );
      }

      for (const project of projects) {
        // deno-lint-ignore no-await-in-loop
        const items = await this.#github.listProjectItems(project);
        let sentinelNumber: number | null = null;
        let allNonSentinelDone = true;
        let nonSentinelCount = 0;
        for (const item of items) {
          // deno-lint-ignore no-await-in-loop
          const itemLabels = await this.#github.getIssueLabels(
            item.issueNumber,
          );
          if (itemLabels.includes(binding.sentinelLabel)) {
            sentinelNumber = item.issueNumber;
          } else {
            nonSentinelCount++;
            if (
              !hasPhaseLabel(itemLabels, this.#workflow, binding.donePhase)
            ) {
              allNonSentinelDone = false;
            }
          }
        }

        if (
          sentinelNumber !== null &&
          nonSentinelCount > 0 &&
          allNonSentinelDone
        ) {
          const closedChildren = items
            .filter((it) => it.issueNumber !== sentinelNumber)
            .map((it) => it.issueNumber as SubjectRef);
          this.#bus.publish({
            kind: "siblingsAllClosed",
            publishedAt: Date.now(),
            runId: this.#runId,
            subjectId: closedSubject,
            parentSubjectId: sentinelNumber as SubjectRef,
            closedChildren,
          });
          // deno-lint-ignore no-await-in-loop
          await this.#github.updateIssueLabels(
            sentinelNumber,
            [doneLabel],
            [evalLabel],
          );
          this.#logger?.(
            "info",
            `Project completion detected (${project.owner}/${project.number}): ` +
              `triggered evaluator on sentinel #${sentinelNumber}`,
            {
              event: "project_completion_eval_triggered",
              subjectId: closedSubject,
              project: `${project.owner}/${project.number}`,
              sentinelNumber,
              nonSentinelCount,
              doneLabel,
              evalLabel,
            },
          );
        }
      }
    } catch (evalCheckError) {
      const evalMsg = evalCheckError instanceof Error
        ? evalCheckError.message
        : String(evalCheckError);
      this.#logger?.(
        "warn",
        `Project completion check failed for #${closedSubject}: ${evalMsg}`,
        {
          event: "project_completion_check_failed",
          subjectId: closedSubject,
          error: evalMsg,
        },
      );
      // Non-fatal — close already happened (W13).
    }
  }
}
