/**
 * Issue completion handler - completes when a GitHub Issue is closed
 *
 * This module provides two implementations:
 * - IssueCompletionHandler: Original implementation (external calls in isComplete)
 * - IssueContractHandler: Contract-compliant (external calls separated)
 *
 * @refactored Phase 6 - External state checking separated to ExternalStateChecker
 */

import type { PromptResolver } from "../prompts/resolver.ts";
import {
  BaseCompletionHandler,
  type CheckContext,
  type CompletionCriteria,
  type CompletionResult,
  type CompletionType,
  type ContractCompletionHandler,
  type IterationSummary,
  type StepResult,
} from "./types.ts";
import type {
  ExternalStateChecker,
  IssueState,
} from "./external-state-checker.ts";

/**
 * Project context for when Issue is part of a Project
 */
export interface ProjectContext {
  projectNumber: number;
  projectTitle: string;
  projectDescription: string | null;
  projectReadme: string | null;
  totalIssues: number;
  currentIndex: number;
  remainingIssueTitles: string[];
  labelFilter?: string;
}

export class IssueCompletionHandler extends BaseCompletionHandler {
  readonly type = "issue" as const;
  private promptResolver?: PromptResolver;
  private projectContext?: ProjectContext;
  private repository?: string;
  private cwd?: string;
  private lastSummary?: IterationSummary;

  constructor(
    private readonly issueNumber: number,
    repository?: string,
  ) {
    super();
    this.repository = repository;
  }

  /**
   * Set working directory for command execution.
   * Required for correct behavior in worktree mode.
   */
  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  /**
   * Set project context (for Project mode delegation)
   */
  setProjectContext(context: ProjectContext): void {
    this.projectContext = context;
  }

  /**
   * Get the issue number
   */
  getIssueNumber(): number {
    return this.issueNumber;
  }

  async buildInitialPrompt(): Promise<string> {
    if (this.promptResolver) {
      return await this.promptResolver.resolve("initial_issue", {
        "uv-issue_number": String(this.issueNumber),
      });
    }

    // Fallback inline prompt
    const projectSection = this.projectContext
      ? this.buildProjectContextSection()
      : "";

    return `
${projectSection}## Current Task: Issue #${this.issueNumber}

Work on GitHub Issue #${this.issueNumber} until it is closed.

## Working Style

1. **Use TodoWrite** to track tasks
2. **Delegate complex work** to sub-agents
3. **Report progress** via issue-action blocks

## Issue Actions

### Report Progress
\`\`\`issue-action
{"action":"progress","issue":${this.issueNumber},"body":"## Progress\\n- What was done"}
\`\`\`

### Complete Issue
\`\`\`issue-action
{"action":"close","issue":${this.issueNumber},"body":"## Resolution\\n- What was implemented"}
\`\`\`

Start by analyzing the issue requirements and creating a task breakdown.
    `.trim();
  }

  private buildProjectContextSection(): string {
    if (!this.projectContext) return "";

    const ctx = this.projectContext;
    const labelInfo = ctx.labelFilter
      ? ` (filtered by: "${ctx.labelFilter}")`
      : "";

    return `## Project Overview

**Project #${ctx.projectNumber}**: ${ctx.projectTitle}${labelInfo}
**Progress**: Issue ${ctx.currentIndex} of ${ctx.totalIssues}

---

`;
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    // Store the summary for use in isComplete()
    if (previousSummary) {
      this.lastSummary = previousSummary;
    }

    if (this.promptResolver) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";
      return await this.promptResolver.resolve("continuation_issue", {
        "uv-iteration": String(completedIterations),
        "uv-issue_number": String(this.issueNumber),
        "uv-previous_summary": summaryText,
      });
    }

    // Fallback inline prompt
    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return `
Continue working on Issue #${this.issueNumber}.
Iterations completed: ${completedIterations}

${summarySection}

## Continue

1. Check TodoWrite for pending tasks
2. Execute next task
3. Mark completed and move forward
4. Use issue-action to report progress or close when done

\`\`\`issue-action
{"action":"close","issue":${this.issueNumber},"body":"## Resolution\\n- What was implemented"}
\`\`\`
    `.trim();
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `Close Issue #${this.issueNumber}`,
      detailed:
        `Complete the requirements in GitHub Issue #${this.issueNumber} and close it when done. Use issue-action blocks to report progress and close the issue.`,
    };
  }

  /**
   * Get the declared status and next_action from structured output
   */
  getStructuredOutputStatus(): {
    status?: string;
    nextAction?: string;
    nextActionReason?: string;
  } {
    if (!this.lastSummary?.structuredOutput) {
      return {};
    }

    const so = this.lastSummary.structuredOutput as Record<string, unknown>;
    const result: {
      status?: string;
      nextAction?: string;
      nextActionReason?: string;
    } = {};

    if (typeof so.status === "string") {
      result.status = so.status;
    }

    if (so.next_action) {
      const nextAction = so.next_action as Record<string, unknown>;
      if (typeof nextAction === "string") {
        result.nextAction = nextAction;
      } else if (typeof nextAction.action === "string") {
        result.nextAction = nextAction.action;
        if (typeof nextAction.reason === "string") {
          result.nextActionReason = nextAction.reason;
        }
      }
    }

    return result;
  }

  /**
   * Set the current iteration summary before completion check.
   * Implements CompletionHandler.setCurrentSummary interface method.
   */
  setCurrentSummary(summary: IterationSummary): void {
    this.lastSummary = summary;
  }

  async isComplete(): Promise<boolean> {
    try {
      // Check structured output declaration first
      const soStatus = this.getStructuredOutputStatus();
      const aiDeclaredComplete = soStatus.status === "completed" ||
        soStatus.nextAction === "complete";

      // Check 1: Is the issue closed on GitHub?
      const args = this.repository
        ? [
          "issue",
          "view",
          String(this.issueNumber),
          "-R",
          this.repository,
          "--json",
          "state",
        ]
        : ["issue", "view", String(this.issueNumber), "--json", "state"];

      const result = await new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
        cwd: this.cwd,
      }).output();

      if (!result.success) {
        return false;
      }

      const output = new TextDecoder().decode(result.stdout);
      const data = JSON.parse(output);
      const isIssueClosed = data.state === "CLOSED";

      // Check 2: Is the git working directory clean?
      // This prevents completion when agent closes issue via direct gh command
      // without committing changes (bypassing pre-close validation)
      const gitResult = await new Deno.Command("git", {
        args: ["status", "--porcelain"],
        stdout: "piped",
        stderr: "piped",
        cwd: this.cwd,
      }).output();

      if (!gitResult.success) {
        // If git status fails, assume not clean (conservative approach)
        return false;
      }

      const gitOutput = new TextDecoder().decode(gitResult.stdout).trim();
      const isGitClean = gitOutput === "";

      const externalConditionsMet = isIssueClosed && isGitClean;

      // Integration: Use both AI declaration AND external validation
      // - If AI declared complete but external conditions not met: NOT complete
      //   (prevents premature completion, agent should fix issues first)
      // - If external conditions met but AI didn't declare complete: complete
      //   (handles cases where structured output isn't used)
      // - If both agree: complete
      if (aiDeclaredComplete && !externalConditionsMet) {
        // AI thinks it's done but conditions not met
        // This will trigger retry with the discrepancy visible in next prompt
        return false;
      }

      return externalConditionsMet;
    } catch {
      return false;
    }
  }

  async getCompletionDescription(): Promise<string> {
    try {
      // Get AI's declared status
      const soStatus = this.getStructuredOutputStatus();
      const aiStatusPart = soStatus.status
        ? ` | AI declared: ${soStatus.status}`
        : "";
      const aiNextActionPart = soStatus.nextAction
        ? ` (next: ${soStatus.nextAction})`
        : "";

      // Check issue state
      const args = this.repository
        ? [
          "issue",
          "view",
          String(this.issueNumber),
          "-R",
          this.repository,
          "--json",
          "state",
        ]
        : ["issue", "view", String(this.issueNumber), "--json", "state"];

      const result = await new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
        cwd: this.cwd,
      }).output();

      const isIssueClosed = result.success &&
        JSON.parse(new TextDecoder().decode(result.stdout)).state === "CLOSED";

      // Check git status
      const gitResult = await new Deno.Command("git", {
        args: ["status", "--porcelain"],
        stdout: "piped",
        stderr: "piped",
        cwd: this.cwd,
      }).output();

      const gitOutput = gitResult.success
        ? new TextDecoder().decode(gitResult.stdout).trim()
        : "";
      const isGitClean = gitOutput === "";

      // Provide informative description including AI declaration
      const aiInfo = aiStatusPart + aiNextActionPart;
      if (isIssueClosed && isGitClean) {
        return `Issue #${this.issueNumber} is CLOSED and git is clean${aiInfo}`;
      } else if (isIssueClosed && !isGitClean) {
        return `Issue #${this.issueNumber} is CLOSED but git has uncommitted changes${aiInfo}`;
      } else {
        return `Issue #${this.issueNumber} is still OPEN${aiInfo}`;
      }
    } catch {
      return `Issue #${this.issueNumber} status unknown`;
    }
  }
}

// ============================================================================
// Contract-compliant Implementation
// ============================================================================

/**
 * Configuration for IssueContractHandler.
 */
export interface IssueContractConfig {
  /** Issue number to track */
  issueNumber: number;
  /** Repository in "owner/repo" format (optional) */
  repo?: string;
  /** Minimum interval between state checks in ms (default: 60000) */
  checkInterval?: number;
}

/** Alias for backwards compatibility */
export type IssueCompletionConfigV2 = IssueContractConfig;

/**
 * Issue-based completion handler with contract compliance.
 *
 * Contract-compliant implementation that separates external state checking
 * from completion judgment logic.
 *
 * Key characteristics:
 * - check() uses cached state only - no external calls
 * - refreshState() method for explicit state updates
 * - External state checker is injected as dependency
 *
 * Usage:
 * ```typescript
 * const checker = new GitHubStateChecker();
 * const handler = new IssueContractHandler(
 *   { issueNumber: 123, repo: "owner/repo" },
 *   checker
 * );
 *
 * // Loop layer calls refreshState at appropriate intervals
 * await handler.refreshState();
 *
 * // check() is now side-effect free
 * const result = handler.check({ iteration: 1 });
 * ```
 */
export class IssueContractHandler implements ContractCompletionHandler {
  readonly type: CompletionType = "issue";

  private cachedState?: IssueState;
  private lastCheckTime = 0;

  constructor(
    private readonly config: IssueContractConfig,
    private readonly stateChecker: ExternalStateChecker,
  ) {}

  /**
   * Check completion based on cached issue state.
   *
   * No external calls - uses cached state only.
   * Call refreshState() to update from external source.
   *
   * @post No side effects (Query method)
   */
  check(_context: CheckContext): CompletionResult {
    if (!this.cachedState) {
      return { complete: false };
    }

    return {
      complete: this.cachedState.closed,
      reason: this.cachedState.closed
        ? `Issue #${this.config.issueNumber} is closed`
        : undefined,
    };
  }

  /**
   * Transition logic - issue completion doesn't have steps.
   *
   * @post No side effects (Query method)
   */
  transition(_result: StepResult): "complete" {
    return "complete";
  }

  /**
   * Build prompt for issue-based agent.
   *
   * @post No side effects (Query method)
   */
  buildPrompt(phase: "initial" | "continuation", iteration: number): string {
    if (phase === "initial") {
      return `Work on Issue #${this.config.issueNumber}. Check if the issue is resolved.`;
    }
    return `Continue working on Issue #${this.config.issueNumber}. Iteration ${iteration}.`;
  }

  /**
   * Get completion criteria.
   *
   * @post No side effects (Query method)
   */
  getCompletionCriteria(): { summary: string; detailed: string } {
    return {
      summary: `Issue #${this.config.issueNumber} closed`,
      detailed:
        `Complete when GitHub Issue #${this.config.issueNumber} is closed${
          this.config.repo ? ` in ${this.config.repo}` : ""
        }.`,
    };
  }

  /**
   * Refresh state from external source.
   *
   * This is the ONLY method that performs external calls.
   * Should be called by the loop layer at appropriate intervals.
   *
   * @post Updates cachedState and lastCheckTime
   */
  async refreshState(): Promise<void> {
    const now = Date.now();
    const interval = this.config.checkInterval ?? 60000; // Default 1 minute

    if (now - this.lastCheckTime < interval) {
      return; // Skip if checked recently
    }

    this.cachedState = await this.stateChecker.checkIssueState(
      this.config.issueNumber,
      this.config.repo,
    );
    this.lastCheckTime = now;
  }

  /**
   * Force refresh state regardless of interval.
   *
   * Useful for initial state fetch or explicit refresh requests.
   *
   * @post Updates cachedState and lastCheckTime
   */
  async forceRefreshState(): Promise<void> {
    this.cachedState = await this.stateChecker.checkIssueState(
      this.config.issueNumber,
      this.config.repo,
    );
    this.lastCheckTime = Date.now();
  }

  /**
   * Get the cached state (for inspection/debugging).
   *
   * @returns Current cached state or undefined if not yet fetched
   */
  getCachedState(): IssueState | undefined {
    return this.cachedState;
  }

  /**
   * Get the issue number.
   */
  getIssueNumber(): number {
    return this.config.issueNumber;
  }

  /**
   * Check if state needs refresh based on interval.
   *
   * @returns true if refreshState() would fetch new data
   */
  needsRefresh(): boolean {
    const now = Date.now();
    const interval = this.config.checkInterval ?? 60000;
    return now - this.lastCheckTime >= interval;
  }
}

/** Alias for backwards compatibility */
export const IssueCompletionHandlerV2 = IssueContractHandler;
