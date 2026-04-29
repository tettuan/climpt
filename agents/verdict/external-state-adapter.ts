/**
 * External State Verdict Adapter
 *
 * Bridges ContractVerdictHandler (V2) to VerdictHandler (V1) interface.
 * Enables the Runner to use V2 IssueVerdictHandler without Runner changes.
 *
 * Resolves:
 * - Gap 2: Interface mismatch (ContractVerdictHandler -> VerdictHandler)
 * - Gap 3: isFinished() logic (refreshState -> check bridge)
 * - Gap 4: onBoundaryHook() (GitHub label/close operations)
 * - Gap 5: Prompt construction (PromptResolver integration)
 */

import type { PromptResolver } from "../common/prompt-resolver.ts";
import {
  BaseVerdictHandler,
  type IterationSummary,
  type VerdictCriteria,
  type VerdictStepIds,
} from "./types.ts";
import type { IssueVerdictHandler } from "./issue.ts";
import { STEP_PHASE } from "../shared/step-phases.ts";
import type { CloseEventBus } from "../events/bus.ts";
import type { BoundaryCloseChannel } from "../channels/boundary-close.ts";

/**
 * Configuration for the adapter, extracted from AgentDefinition and args.
 */
export interface ExternalStateAdapterConfig {
  /** Issue number being tracked */
  issueNumber: number;
  /** Repository in "owner/repo" format */
  repo?: string;
  /** Maximum polling iterations (Channel 3 variable source) */
  maxIterations?: number;
  /** GitHub label configuration from agent definition */
  github?: {
    labels?: {
      completion?: { add?: string[]; remove?: string[] };
    };
    defaultClosureAction?: string;
  };
}

/**
 * Adapter that wraps IssueVerdictHandler (ContractVerdictHandler)
 * and exposes VerdictHandler interface expected by AgentRunner.
 *
 * Method mapping:
 * - buildInitialPrompt() -> PromptResolver.resolve("initial.polling") || handler.buildPrompt(INITIAL, 1)
 * - buildContinuationPrompt() -> PromptResolver.resolve("continuation.polling") || handler.buildPrompt(CONTINUATION, n)
 * - buildVerdictCriteria() -> handler.getVerdictCriteria() with field name mapping
 * - isFinished() -> handler.refreshState() + handler.check()
 * - getVerdictDescription() -> derived from check result
 * - onBoundaryHook() -> gh issue edit (labels) + gh issue close
 * - setCurrentSummary() -> stored for future use
 */
export class ExternalStateVerdictAdapter extends BaseVerdictHandler {
  readonly type = "poll:state" as const;
  private promptResolver?: PromptResolver;
  private uvVariables: Record<string, string> = {};
  private currentSummary?: IterationSummary;
  private readonly stepIds: VerdictStepIds;
  #lastVerdict?: string;
  /**
   * `BoundaryCloseChannel` reference from
   * `BootArtifacts.boundaryClose` (PR4-3). When present, the adapter
   * invokes `handleBoundary(subjectId, agentId, stepId)` on the channel
   * instead of shelling out to `gh issue close` itself. The channel
   * owns the `closeTransport.close` write and publishes
   * `IssueClosedEvent(channel: "E")` / `IssueCloseFailedEvent`.
   *
   * The legacy `setEventBus(bus, runId)` setter (T3.3 shadow-mode)
   * survives only as an API shim — the bus + runId are now captured by
   * the channel itself at boot time, so the setter no longer wires
   * anything. Callers that pre-date PR4-3 still call it without harm.
   */
  #boundaryClose?: BoundaryCloseChannel;

  constructor(
    private readonly handler: IssueVerdictHandler,
    private readonly config: ExternalStateAdapterConfig,
    stepIds?: VerdictStepIds,
  ) {
    super();
    this.stepIds = stepIds ?? {
      initial: "initial.polling",
      continuation: "continuation.polling",
    };
  }

  /**
   * Legacy late-bind shim — the bus + runId are now captured by the
   * BoundaryClose channel directly (PR4-3 / T4.4c). Retained as a
   * no-op so callers that pre-date the cutover (T3.3 shadow-mode
   * tests) keep compiling.
   */
  setEventBus(
    _bus: CloseEventBus | undefined,
    _runId: string | undefined,
  ): void {
    // No-op after PR4-3. BoundaryClose owns the bus+runId capture.
  }

  /**
   * Late-bind the BoundaryClose channel (PR4-3 / T4.4c). Called by the
   * runner factory after the adapter is constructed so the existing
   * constructor signature (used by tests) need not change. When
   * omitted, the close path throws a clear error explaining the
   * missing wiring (no silent fallback to direct gh CLI).
   */
  setBoundaryClose(channel: BoundaryCloseChannel | undefined): void {
    this.#boundaryClose = channel;
  }

  /**
   * Get the last verdict value extracted from AI structured output.
   * Returns undefined if no verdict has been received yet.
   */
  override getLastVerdict(): string | undefined {
    return this.#lastVerdict;
  }

  /**
   * Set prompt resolver for externalized prompts.
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  /**
   * Supply base UV variables (CLI args + runtime) for prompt resolution.
   */
  setUvVariables(uv: Record<string, string>): void {
    this.uvVariables = uv;
  }

  /**
   * Set current iteration summary (called by runner before isFinished).
   */
  setCurrentSummary(summary: IterationSummary): void {
    this.currentSummary = summary;
  }

  async buildInitialPrompt(): Promise<string> {
    if (this.promptResolver) {
      return (await this.promptResolver.resolve(this.stepIds.initial, {
        uv: {
          ...this.uvVariables,
          issue: String(this.config.issueNumber),
          ...(this.config.repo ? { repository: this.config.repo } : {}),
          ...(this.config.maxIterations !== undefined
            ? { max_iterations: String(this.config.maxIterations) }
            : {}),
        },
      })).content;
    }
    return this.handler.buildPrompt(STEP_PHASE.INITIAL, 1);
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    const summaryText = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    if (this.promptResolver) {
      const maxIter = this.config.maxIterations;
      return (await this.promptResolver.resolve(this.stepIds.continuation, {
        uv: {
          ...this.uvVariables,
          issue: String(this.config.issueNumber),
          iteration: String(completedIterations),
          previous_summary: summaryText,
          ...(maxIter !== undefined
            ? {
              max_iterations: String(maxIter),
              remaining: String(Math.max(0, maxIter - completedIterations)),
            }
            : {}),
        },
      })).content;
    }

    return this.handler.buildPrompt(
      STEP_PHASE.CONTINUATION,
      completedIterations + 1,
    );
  }

  buildVerdictCriteria(): VerdictCriteria {
    const criteria = this.handler.getVerdictCriteria();
    return {
      short: criteria.summary,
      detailed: criteria.detailed,
    };
  }

  /**
   * Check completion by refreshing external state then checking.
   * Bridges V2's separate refreshState()/check() to V1's single isFinished().
   */
  async isFinished(): Promise<boolean> {
    await this.handler.refreshState();
    const result = this.handler.check({ iteration: 1 });
    return result.complete;
  }

  getVerdictDescription(): Promise<string> {
    const result = this.handler.check({ iteration: 1 });
    if (result.complete) {
      return Promise.resolve(
        result.reason ?? `Issue #${this.config.issueNumber} is closed`,
      );
    }
    return Promise.resolve(
      `Waiting for Issue #${this.config.issueNumber} to close`,
    );
  }

  /**
   * Handle boundary hook for closure steps.
   * Performs GitHub operations based on resolved closure action.
   *
   * Closure action priority:
   *   1. AI structured output `closure_action` field (dynamic override)
   *   2. `defaultClosureAction` from agent.json config (static)
   *   3. `"close"` (default)
   *
   * Actions:
   *   - `"close"`: close the issue only (no label changes)
   *   - `"label-only"`: update labels only (do not close)
   *   - `"label-and-close"`: update labels, then close the issue
   */
  async onBoundaryHook(payload: {
    stepId: string;
    kind: "closure";
    structuredOutput?: Record<string, unknown>;
  }): Promise<void> {
    // Extract verdict from AI structured output if present
    if (payload.structuredOutput) {
      const rawVerdict = payload.structuredOutput.verdict;
      if (typeof rawVerdict === "string" && rawVerdict.length > 0) {
        this.#lastVerdict = rawVerdict;
      }
    }

    const { issueNumber, repo, github } = this.config;

    const closureAction = this.resolveClosureAction(
      payload.structuredOutput,
      github?.defaultClosureAction,
    );

    // Extract labels from AI structured output (design: 04_step_flow_design.md:311)
    const soLabels = this.#extractStructuredOutputLabels(
      payload.structuredOutput,
    );

    // Update labels for "label-only" and "label-and-close"
    if (closureAction !== "close") {
      await this.updateLabels(
        issueNumber,
        repo,
        github?.labels?.completion,
        soLabels,
      );
    }

    // Close issue for "close" and "label-and-close"
    if (closureAction !== "label-only") {
      await this.closeIssue(issueNumber, repo);
    }
  }

  /**
   * Resolve the effective closure action from structured output and config.
   */
  private resolveClosureAction(
    structuredOutput: Record<string, unknown> | undefined,
    configAction: string | undefined,
  ): "close" | "label-only" | "label-and-close" {
    const validActions = new Set(["close", "label-only", "label-and-close"]);

    // Priority 1: AI structured output override
    if (structuredOutput) {
      const soAction = (structuredOutput as Record<string, unknown>)
        .closure_action;
      if (typeof soAction === "string" && validActions.has(soAction)) {
        return soAction as "close" | "label-only" | "label-and-close";
      }
    }

    // Priority 2: config defaultClosureAction
    if (configAction && validActions.has(configAction)) {
      return configAction as "close" | "label-only" | "label-and-close";
    }

    // Priority 3: default
    return "close";
  }

  /**
   * Extract and validate labels from AI structured output.
   * Expected shape: `{ issue: { labels: { add?: string[], remove?: string[] } } }`
   */
  #extractStructuredOutputLabels(
    structuredOutput: Record<string, unknown> | undefined,
  ): { add?: string[]; remove?: string[] } | undefined {
    if (!structuredOutput) return undefined;

    const issue = structuredOutput.issue;
    if (!issue || typeof issue !== "object") return undefined;

    const labels = (issue as Record<string, unknown>).labels;
    if (!labels || typeof labels !== "object") return undefined;

    const raw = labels as Record<string, unknown>;
    const result: { add?: string[]; remove?: string[] } = {};

    if (Array.isArray(raw.add) && raw.add.every((v) => typeof v === "string")) {
      result.add = raw.add as string[];
    }
    if (
      Array.isArray(raw.remove) &&
      raw.remove.every((v) => typeof v === "string")
    ) {
      result.remove = raw.remove as string[];
    }

    if (!result.add && !result.remove) return undefined;
    return result;
  }

  /**
   * Update issue labels by merging config and structured output sources.
   * Structured output labels are merged with config labels (deduplicated).
   * Non-fatal: failures are silently caught to avoid stopping the agent.
   */
  private async updateLabels(
    issueNumber: number,
    repo: string | undefined,
    completion: { add?: string[]; remove?: string[] } | undefined,
    structuredOutputLabels?: { add?: string[]; remove?: string[] },
  ): Promise<void> {
    const merged = this.#mergeLabels(completion, structuredOutputLabels);
    if (!merged) return;

    const { add, remove } = merged;
    const labelArgs: string[] = [];
    if (add?.length) labelArgs.push("--add-label", add.join(","));
    if (remove?.length) labelArgs.push("--remove-label", remove.join(","));

    if (labelArgs.length === 0) return;

    const args = ["issue", "edit", String(issueNumber), ...labelArgs];
    if (repo) args.push("--repo", repo);
    try {
      await new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch {
      // Non-fatal: label update failure should not stop the agent
    }
  }

  /**
   * Merge label sources: config (static) and structured output (AI-decided).
   * Both sources contribute; duplicates are removed.
   */
  #mergeLabels(
    config: { add?: string[]; remove?: string[] } | undefined,
    soLabels: { add?: string[]; remove?: string[] } | undefined,
  ): { add?: string[]; remove?: string[] } | undefined {
    if (!config && !soLabels) return undefined;

    const addSet = new Set<string>([
      ...(config?.add ?? []),
      ...(soLabels?.add ?? []),
    ]);
    const removeSet = new Set<string>([
      ...(config?.remove ?? []),
      ...(soLabels?.remove ?? []),
    ]);

    const add = addSet.size > 0 ? [...addSet] : undefined;
    const remove = removeSet.size > 0 ? [...removeSet] : undefined;

    if (!add && !remove) return undefined;
    return { add, remove };
  }

  /**
   * Close a GitHub issue (PR4-3 / T4.4c cutover).
   *
   * The actual close-write is now delegated to
   * {@link BoundaryCloseChannel.handleBoundary} — the channel owns the
   * `closeTransport.close` invocation and publishes
   * `IssueClosedEvent(channel: "E")` / `IssueCloseFailedEvent` (W2:
   * direct gh CLI from a verdict adapter is forbidden). The legacy
   * `Deno.Command("gh", ["issue", "close", ...])` shell-out has been
   * deleted.
   *
   * Non-fatal: failures inside the channel are caught here so the
   * agent's closure step does not abort. The channel still publishes
   * the failure event before throwing.
   */
  private async closeIssue(
    issueNumber: number,
    _repo: string | undefined,
  ): Promise<void> {
    if (this.#boundaryClose === undefined) {
      throw new Error(
        "ExternalStateVerdictAdapter: closeIssue invoked but no " +
          "BoundaryCloseChannel was wired. The runner factory must call " +
          "setBoundaryClose(BootArtifacts.boundaryClose) before the " +
          "closure step boundary hook fires (PR4-3 T4.4c cutover).",
      );
    }
    try {
      await this.#boundaryClose.handleBoundary(
        issueNumber,
        // The verdict adapter does not carry the dispatching agent id
        // verbatim; pass a stable diagnostic label instead so the
        // event log carries an identifying string.
        "external-state-adapter",
        // The verdict adapter likewise lacks the closure stepId at
        // this site (the boundary hook payload is the source); pass a
        // stable label so the event log carries one.
        "closure.external-state",
      );
    } catch {
      // Non-fatal: issue close failure should not stop the agent. The
      // channel already published `IssueCloseFailedEvent(channel: "E")`
      // before throwing, so the bus carries the failure trace.
    }
  }
}
