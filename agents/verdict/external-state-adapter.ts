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

/**
 * Configuration for the adapter, extracted from AgentDefinition and args.
 */
export interface ExternalStateAdapterConfig {
  /** Issue number being tracked */
  issueNumber: number;
  /** Repository in "owner/repo" format */
  repo?: string;
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
      return (await this.promptResolver.resolve(this.stepIds.continuation, {
        uv: {
          ...this.uvVariables,
          issue: String(this.config.issueNumber),
          iteration: String(completedIterations),
          previous_summary: summaryText,
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
    stepKind: "closure";
    structuredOutput?: Record<string, unknown>;
  }): Promise<void> {
    const { issueNumber, repo, github } = this.config;

    const closureAction = this.resolveClosureAction(
      payload.structuredOutput,
      github?.defaultClosureAction,
    );

    // Update labels for "label-only" and "label-and-close"
    if (closureAction !== "close") {
      await this.updateLabels(issueNumber, repo, github?.labels?.completion);
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
   * Update issue labels based on completion config.
   * Non-fatal: failures are silently caught to avoid stopping the agent.
   */
  private async updateLabels(
    issueNumber: number,
    repo: string | undefined,
    completion: { add?: string[]; remove?: string[] } | undefined,
  ): Promise<void> {
    if (!completion) return;

    const { add, remove } = completion;
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
   * Close a GitHub issue.
   * Non-fatal: failures are silently caught to avoid stopping the agent.
   */
  private async closeIssue(
    issueNumber: number,
    repo: string | undefined,
  ): Promise<void> {
    const args = ["issue", "close", String(issueNumber)];
    if (repo) args.push("--repo", repo);
    try {
      await new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch {
      // Non-fatal: issue close failure should not stop the agent
    }
  }
}
