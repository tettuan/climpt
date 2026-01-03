/**
 * Project Completion Handler
 *
 * Handles GitHub Project-based completion criteria with multi-phase workflow:
 * 1. PREPARATION - Analyze project, organize skills
 * 2. PROCESSING - Work on issues one by one
 * 3. REVIEW - Check completion status
 * 4. AGAIN - Re-execute if review fails
 * 5. COMPLETE - Done
 */

import type {
  IterationSummary,
  ProjectPhase,
  ProjectPlan,
  ReviewResult,
} from "../types.ts";
import {
  fetchProjectRequirements,
  getProjectIssues,
  type ProjectIssueInfo,
} from "../github.ts";
import type { CompletionCriteria, CompletionHandler } from "./types.ts";
import { IssueCompletionHandler, type ProjectContext } from "./issue.ts";

/**
 * ProjectCompletionHandler
 *
 * Manages multi-phase GitHub Project workflow:
 * - Preparation: Analyze project and organize skills
 * - Processing: Work through issues one by one
 * - Review: Verify completion
 * - Again: Re-execute if review failed
 */
export class ProjectCompletionHandler implements CompletionHandler {
  readonly type = "project" as const;

  /** Current phase in the project workflow */
  private phase: ProjectPhase = "preparation";

  /** List of remaining open issues to process */
  private remainingIssues: ProjectIssueInfo[] = [];

  /** Current issue being worked on */
  private currentIssue: ProjectIssueInfo | null = null;

  /** Current issue handler (delegated) */
  private currentIssueHandler: IssueCompletionHandler | null = null;

  /** Number of issues completed in this session */
  private issuesCompleted = 0;

  /** Total issues found at initialization (for progress tracking) */
  private totalIssuesAtStart = 0;

  /** Issue numbers that have been marked completed (to filter from re-fetch) */
  private completedIssueNumbers: Set<number> = new Set();

  /** Whether the handler has been initialized */
  private initialized = false;

  /** Cached project info for context */
  private projectTitle = "";
  private projectDescription: string | null = null;

  /** Project plan from preparation phase */
  private projectPlan: ProjectPlan | null = null;

  /** Review result from review phase */
  private reviewResult: ReviewResult | null = null;

  /**
   * Create a Project completion handler
   *
   * @param projectNumber - GitHub Project number to work on
   * @param labelFilter - Optional label to filter issues by
   * @param includeCompleted - Include "Done" items from project board (default: false)
   * @param projectOwner - Explicit project owner (user login, org name, or "@me")
   */
  constructor(
    private readonly projectNumber: number,
    private readonly labelFilter?: string,
    private readonly includeCompleted: boolean = false,
    private readonly projectOwner?: string,
  ) {}

  /**
   * Get current phase
   */
  getPhase(): ProjectPhase {
    return this.phase;
  }

  /**
   * Advance to next phase
   */
  advancePhase(): void {
    switch (this.phase) {
      case "preparation":
        this.phase = "processing";
        break;
      case "processing":
        this.phase = "review";
        break;
      case "review":
        // Based on review result, go to complete or again
        if (this.reviewResult?.result === "pass") {
          this.phase = "complete";
        } else {
          this.phase = "again";
        }
        break;
      case "again":
        // After again, go back to review
        this.phase = "review";
        break;
      case "complete":
        // Already complete, no transition
        break;
    }
  }

  /**
   * Set project plan (from preparation phase output)
   */
  setProjectPlan(plan: ProjectPlan): void {
    this.projectPlan = plan;
  }

  /**
   * Set review result (from review phase output)
   */
  setReviewResult(result: ReviewResult): void {
    this.reviewResult = result;
  }

  /**
   * Initialize by fetching project info and open issues
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Fetch project info for context (pass explicit owner)
    const projectContent = await fetchProjectRequirements(
      this.projectNumber,
      this.projectOwner,
    );
    // Parse project title from content (first line after "Project:")
    const titleMatch = projectContent.match(/^Project: (.+)$/m);
    this.projectTitle = titleMatch
      ? titleMatch[1]
      : `Project #${this.projectNumber}`;
    // Store description (rest of content)
    const descMatch = projectContent.match(/\n\n(.+)/s);
    this.projectDescription = descMatch ? descMatch[1].trim() : null;

    // Fetch issues (includeCompleted controls whether "Done" items are included)
    this.remainingIssues = await getProjectIssues(
      this.projectNumber,
      {
        labelFilter: this.labelFilter,
        includeCompleted: this.includeCompleted,
        owner: this.projectOwner,
      },
    );
    this.totalIssuesAtStart = this.remainingIssues.length;
    this.initialized = true;

    // Set up the first issue if there are any (for processing phase)
    if (this.remainingIssues.length > 0) {
      this.setCurrentIssue(this.remainingIssues.shift()!);
    }
  }

  /**
   * Set current issue and create its handler with project context
   */
  private setCurrentIssue(issue: ProjectIssueInfo): void {
    this.currentIssue = issue;

    // Create IssueCompletionHandler for this issue
    this.currentIssueHandler = new IssueCompletionHandler(
      issue.issueNumber,
      issue.repository,
    );

    // Set project context on the handler
    const projectContext: ProjectContext = {
      projectNumber: this.projectNumber,
      projectTitle: this.projectTitle,
      projectDescription: this.projectDescription,
      totalIssues: this.totalIssuesAtStart,
      currentIndex: this.issuesCompleted + 1,
      remainingIssueTitles: this.remainingIssues.map(
        (i) => `#${i.issueNumber}: ${i.title}`,
      ),
      labelFilter: this.labelFilter,
    };
    this.currentIssueHandler.setProjectContext(projectContext);
  }

  /**
   * Build initial prompt - varies by phase
   */
  async buildInitialPrompt(): Promise<string> {
    await this.initialize();

    const labelInfo = this.labelFilter
      ? ` (filtered by label: "${this.labelFilter}")`
      : "";

    switch (this.phase) {
      case "preparation":
        return this.buildPreparationPrompt(labelInfo);

      case "processing":
        return this.buildProcessingPrompt(labelInfo);

      case "review":
        return this.buildReviewPrompt(labelInfo);

      case "again":
        return this.buildAgainPrompt(labelInfo);

      case "complete":
        return `
Project #${this.projectNumber}${labelInfo} is complete!
${this.issuesCompleted} issue(s) have been closed.
        `.trim();
    }
  }

  /**
   * Build preparation phase prompt
   */
  private buildPreparationPrompt(labelInfo: string): string {
    const issueList = [...this.remainingIssues]
      .map((i) => `- #${i.issueNumber}: ${i.title}`)
      .join("\n");

    if (this.currentIssue) {
      const currentIssueItem = `- #${this.currentIssue.issueNumber}: ${this.currentIssue.title}`;
      return `
## Project Overview

**Project #${this.projectNumber}**: ${this.projectTitle}${labelInfo}
${this.projectDescription || ""}

## Issues to Process (${this.totalIssuesAtStart} total)

${currentIssueItem}
${issueList}

## Your Task

Analyze this project and prepare for execution:
1. Review all issues and understand the overall requirements
2. Identify which skills and sub-agents are needed
3. Note any dependencies between issues
4. Create an execution plan

Output your plan in the specified project-plan format.
      `.trim();
    }

    // No issues case
    return `
## Project Overview

**Project #${this.projectNumber}**: ${this.projectTitle}${labelInfo}
${this.projectDescription || ""}

## Status

No${this.labelFilter ? ` "${this.labelFilter}" labeled` : ""} issues to process.
Project preparation complete with no work needed.
    `.trim();
  }

  /**
   * Build processing phase prompt - delegates to IssueCompletionHandler
   */
  private async buildProcessingPrompt(labelInfo: string): Promise<string> {
    // No issues to work on
    if (!this.currentIssueHandler) {
      return `
You are working on GitHub Project #${this.projectNumber}${labelInfo}.

## Project Overview
**${this.projectTitle}**
${this.projectDescription || ""}

## Status
All${this.labelFilter ? ` "${this.labelFilter}" labeled` : ""} issues in this project are already complete! No work needed.
      `.trim();
    }

    // Delegate to IssueCompletionHandler (which has project context set)
    return await this.currentIssueHandler.buildInitialPrompt();
  }

  /**
   * Build review phase prompt
   */
  private buildReviewPrompt(labelInfo: string): string {
    const completedList = Array.from(this.completedIssueNumbers)
      .map((n) => `- #${n}`)
      .join("\n");

    return `
## Project Review

**Project #${this.projectNumber}**: ${this.projectTitle}${labelInfo}

## Work Completed

${this.issuesCompleted} issue(s) closed:
${completedList || "- (none)"}

## Your Task

Review the project completion status:
1. Verify all issues with "${this.labelFilter || "any"}" label are properly closed
2. Check each issue's resolution quality
3. Identify any remaining work needed

Output your review in the specified review-result format.
    `.trim();
  }

  /**
   * Build again phase prompt (re-execution after failed review)
   */
  private buildAgainPrompt(labelInfo: string): string {
    const reviewFindings = this.reviewResult?.issues
      ?.map((i) => `- #${i.number}: ${i.reason}`)
      .join("\n") || "- No specific issues identified";

    return `
## Re-execution Required

**Project #${this.projectNumber}**: ${this.projectTitle}${labelInfo}

## Review Findings

The previous review found these issues:
${this.reviewResult?.summary || "Review did not pass"}

Issues needing attention:
${reviewFindings}

## Your Task

Address the review findings:
1. Analyze each issue that needs attention
2. Complete any remaining work
3. Fix any problems identified
4. Report completion when done

After addressing all findings, the system will run another review.
    `.trim();
  }

  /**
   * Build continuation prompt - delegates to IssueCompletionHandler
   */
  buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): string {
    // Vary by phase
    switch (this.phase) {
      case "preparation":
        return `
Continue preparing the project plan.
Iterations completed: ${completedIterations}

If you have analyzed all issues, output the project-plan JSON.
        `.trim();

      case "processing":
        // No current issue handler means all done
        if (!this.currentIssueHandler) {
          return `
All issues in Project #${this.projectNumber} have been processed!
Iterations: ${completedIterations}, Issues closed: ${this.issuesCompleted}

Moving to review phase.
          `.trim();
        }

        // Delegate to IssueCompletionHandler
        return this.currentIssueHandler.buildContinuationPrompt(
          completedIterations,
          previousSummary,
        );

      case "review":
        return `
Continue reviewing the project.
Iterations completed: ${completedIterations}

Output your review in the review-result format.
        `.trim();

      case "again":
        return `
Continue addressing review findings.
Iterations completed: ${completedIterations}

Work on the issues identified in the review.
        `.trim();

      case "complete":
        return `Project #${this.projectNumber} is complete!`;
    }
  }

  /**
   * Get completion criteria for system prompt
   */
  buildCompletionCriteria(): CompletionCriteria {
    const labelDesc = this.labelFilter
      ? ` with "${this.labelFilter}" label`
      : "";
    return {
      criteria:
        `completing all open issues${labelDesc} in Project #${this.projectNumber}`,
      detail:
        `Work through Project #${this.projectNumber} issues${labelDesc} one by one. For each issue, implement the requirements and close it when done. The agent will automatically move to the next issue until all are complete.`,
    };
  }

  /**
   * Check if current phase is complete
   *
   * @returns true if project is fully complete
   */
  async isComplete(): Promise<boolean> {
    await this.initialize();

    // If in complete phase, we're done
    if (this.phase === "complete") {
      return true;
    }

    // Check phase-specific completion
    switch (this.phase) {
      case "preparation":
        // Preparation is complete when project plan is set
        return this.projectPlan !== null;

      case "processing":
        return await this.isProcessingPhaseComplete();

      case "review":
        // Review is complete when result is set
        return this.reviewResult !== null;

      case "again":
        // Again phase follows processing logic
        return await this.isProcessingPhaseComplete();
    }

    return false;
  }

  /**
   * Check if processing/again phase is complete
   */
  private async isProcessingPhaseComplete(): Promise<boolean> {
    // If no current issue handler, check if we're done
    if (!this.currentIssueHandler) {
      // Re-fetch to make sure we haven't missed any (exclude Done items)
      const openIssues = await getProjectIssues(this.projectNumber, {
        labelFilter: this.labelFilter,
        includeCompleted: false,
        owner: this.projectOwner,
      });
      // Filter out issues we've already completed (API cache may be stale)
      const filteredIssues = openIssues.filter(
        (issue) => !this.completedIssueNumbers.has(issue.issueNumber),
      );
      if (filteredIssues.length === 0) {
        return true;
      }
      // If there are new open issues, pick one up
      this.remainingIssues = filteredIssues;
      this.setCurrentIssue(this.remainingIssues.shift()!);
      return false;
    }

    // Delegate completion check to IssueCompletionHandler
    const currentClosed = await this.currentIssueHandler.isComplete();

    if (currentClosed) {
      // Only count if not already counted by markCurrentIssueCompleted()
      const issueNumber = this.currentIssueHandler.getIssueNumber();
      if (!this.completedIssueNumbers.has(issueNumber)) {
        this.issuesCompleted++;
        this.completedIssueNumbers.add(issueNumber);
      }

      // Move to next issue
      if (this.remainingIssues.length > 0) {
        this.setCurrentIssue(this.remainingIssues.shift()!);
        return false;
      }

      // No more queued issues - re-fetch to check for any remaining (exclude Done items)
      const openIssues = await getProjectIssues(this.projectNumber, {
        labelFilter: this.labelFilter,
        includeCompleted: false,
        owner: this.projectOwner,
      });
      // Filter out issues we've already completed (API cache may be stale)
      const filteredIssues = openIssues.filter(
        (issue) => !this.completedIssueNumbers.has(issue.issueNumber),
      );
      if (filteredIssues.length === 0) {
        this.currentIssue = null;
        this.currentIssueHandler = null;
        return true;
      }

      // More issues found, continue
      this.remainingIssues = filteredIssues;
      this.setCurrentIssue(this.remainingIssues.shift()!);
      return false;
    }

    // Current issue still open
    return false;
  }

  /**
   * Get human-readable completion status
   */
  async getCompletionDescription(): Promise<string> {
    await this.initialize();

    const phaseDesc = {
      preparation: "Preparation",
      processing: "Processing",
      review: "Review",
      again: "Re-execution",
      complete: "Complete",
    }[this.phase];

    const totalRemaining = (this.currentIssue ? 1 : 0) +
      this.remainingIssues.length;

    if (this.phase === "complete" || !this.currentIssue) {
      return `Project #${this.projectNumber} - ${phaseDesc} (${this.issuesCompleted} issues closed)`;
    }

    return `Project #${this.projectNumber} - ${phaseDesc}: Issue #${this.currentIssue.issueNumber} (${totalRemaining} remaining, ${this.issuesCompleted} closed)`;
  }

  /**
   * Get current issue number being worked on
   */
  getCurrentIssueNumber(): number | null {
    return this.currentIssue?.issueNumber ?? null;
  }

  /**
   * Get current issue info (for closing)
   */
  getCurrentIssueInfo(): ProjectIssueInfo | null {
    return this.currentIssue;
  }

  /**
   * Get count of completed issues
   */
  getCompletedCount(): number {
    return this.issuesCompleted;
  }

  /**
   * Mark current issue as closed and advance to next
   * Called after TypeScript side closes the issue
   */
  markCurrentIssueCompleted(): void {
    if (this.currentIssueHandler) {
      const issueNumber = this.currentIssueHandler.getIssueNumber();
      this.issuesCompleted++;
      this.completedIssueNumbers.add(issueNumber);
      if (this.remainingIssues.length > 0) {
        this.setCurrentIssue(this.remainingIssues.shift()!);
      } else {
        this.currentIssue = null;
        this.currentIssueHandler = null;
      }
    }
  }

  /**
   * Get current issue handler (for direct access if needed)
   */
  getCurrentIssueHandler(): IssueCompletionHandler | null {
    return this.currentIssueHandler;
  }

  /**
   * Get project plan (from preparation phase)
   */
  getProjectPlan(): ProjectPlan | null {
    return this.projectPlan;
  }

  /**
   * Get review result
   */
  getReviewResult(): ReviewResult | null {
    return this.reviewResult;
  }
}
