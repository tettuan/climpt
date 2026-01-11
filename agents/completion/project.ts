/**
 * Project completion handler - completes when project reaches final phase
 *
 * Multi-phase workflow:
 * 1. PREPARATION - Analyze project, organize skills
 * 2. PROCESSING - Work on issues one by one
 * 3. REVIEW - Check completion status
 * 4. AGAIN - Re-execute if review fails
 * 5. COMPLETE - Done
 */

import type { PromptResolver } from "../prompts/resolver.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type IterationSummary,
} from "./types.ts";
import { IssueCompletionHandler, type ProjectContext } from "./issue.ts";

export type ProjectPhase =
  | "preparation"
  | "processing"
  | "review"
  | "again"
  | "complete";

export interface ProjectPlan {
  totalIssues: number;
  estimatedComplexity: "low" | "medium" | "high";
  skillsNeeded: string[];
  skillsToDisable?: string[];
  executionOrder: Array<{ issue: number; reason: string }>;
  notes?: string;
}

export interface ReviewResult {
  result: "pass" | "fail";
  summary: string;
  issues?: Array<{ number: number; reason: string }>;
}

export interface ProjectIssueInfo {
  issueNumber: number;
  title: string;
  repository?: string;
}

export class ProjectCompletionHandler extends BaseCompletionHandler {
  readonly type = "project" as const;

  private phase: ProjectPhase = "preparation";
  private remainingIssues: ProjectIssueInfo[] = [];
  private currentIssue: ProjectIssueInfo | null = null;
  private currentIssueHandler: IssueCompletionHandler | null = null;
  private issuesCompleted = 0;
  private totalIssuesAtStart = 0;
  private completedIssueNumbers: Set<number> = new Set();
  private initialized = false;

  private projectTitle = "";
  private projectDescription: string | null = null;
  private projectPlan: ProjectPlan | null = null;
  private reviewResult: ReviewResult | null = null;

  private promptResolver?: PromptResolver;

  constructor(
    private readonly projectNumber: number,
    private readonly labelFilter?: string,
    private readonly projectOwner?: string,
    private readonly includeCompleted: boolean = false,
  ) {
    super();
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

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
        if (this.reviewResult?.result === "pass") {
          this.phase = "complete";
        } else {
          this.phase = "again";
        }
        break;
      case "again":
        this.phase = "review";
        break;
      case "complete":
        break;
    }
  }

  setProjectPlan(plan: ProjectPlan): void {
    this.projectPlan = plan;
  }

  setReviewResult(result: ReviewResult): void {
    this.reviewResult = result;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Fetch project issues using gh CLI
    try {
      const issues = await this.fetchProjectIssues();
      this.remainingIssues = issues;
      this.totalIssuesAtStart = issues.length;
      this.projectTitle = `Project #${this.projectNumber}`;

      if (this.remainingIssues.length > 0) {
        const nextIssue = this.remainingIssues.shift();
        if (nextIssue) {
          this.setCurrentIssue(nextIssue);
        }
      }
    } catch (error) {
      // deno-lint-ignore no-console
      console.error("Failed to fetch project issues:", error);
      this.remainingIssues = [];
    }

    this.initialized = true;
  }

  private async fetchProjectIssues(): Promise<ProjectIssueInfo[]> {
    try {
      const cmd = new Deno.Command("gh", {
        args: [
          "project",
          "item-list",
          String(this.projectNumber),
          "--format",
          "json",
          ...(this.projectOwner ? ["--owner", this.projectOwner] : []),
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const result = await cmd.output();
      if (!result.success) {
        return [];
      }

      const output = new TextDecoder().decode(result.stdout);
      let data;
      try {
        data = JSON.parse(output);
      } catch {
        // Invalid JSON from gh CLI - return empty array
        return [];
      }

      // Filter by label if specified
      let items = data.items || [];
      if (this.labelFilter) {
        const filterLabel = this.labelFilter;
        items = items.filter((item: { labels?: string[] }) =>
          item.labels?.includes(filterLabel)
        );
      }

      // Filter out completed items unless includeCompleted is true
      if (!this.includeCompleted) {
        items = items.filter((item: { status?: string }) =>
          item.status !== "Done"
        );
      }

      return items.map((item: { number: number; title: string }) => ({
        issueNumber: item.number,
        title: item.title,
      }));
    } catch {
      return [];
    }
  }

  private setCurrentIssue(issue: ProjectIssueInfo): void {
    this.currentIssue = issue;
    this.currentIssueHandler = new IssueCompletionHandler(
      issue.issueNumber,
      issue.repository,
    );

    if (this.promptResolver) {
      this.currentIssueHandler.setPromptResolver(this.promptResolver);
    }

    const projectContext: ProjectContext = {
      projectNumber: this.projectNumber,
      projectTitle: this.projectTitle,
      projectDescription: this.projectDescription,
      projectReadme: null,
      totalIssues: this.totalIssuesAtStart,
      currentIndex: this.issuesCompleted + 1,
      remainingIssueTitles: this.remainingIssues.map(
        (i) => `#${i.issueNumber}: ${i.title}`,
      ),
      labelFilter: this.labelFilter,
    };
    this.currentIssueHandler.setProjectContext(projectContext);
  }

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
        return this.buildCompletePrompt(labelInfo);
    }
  }

  private buildPreparationPrompt(labelInfo: string): string {
    const issueList = this.remainingIssues
      .map((i) => `- #${i.issueNumber}: ${i.title}`)
      .join("\n");

    if (this.currentIssue) {
      const currentItem =
        `- #${this.currentIssue.issueNumber}: ${this.currentIssue.title}`;
      const fullList = this.remainingIssues.length > 0
        ? `${currentItem}\n${issueList}`
        : currentItem;

      return `
## Project Overview

**Project #${this.projectNumber}**: ${this.projectTitle}${labelInfo}

## Issues to Process (${this.totalIssuesAtStart} total)

${fullList}

## Your Task

Analyze this project and prepare for execution:
1. Review all issues and understand the overall requirements
2. Identify which skills and sub-agents are needed
3. Note any dependencies between issues
4. Create an execution plan

Output your plan in the project-plan format:
\`\`\`project-plan
{
  "totalIssues": ${this.totalIssuesAtStart},
  "estimatedComplexity": "low|medium|high",
  "skillsNeeded": ["skill1", "skill2"],
  "executionOrder": [
    {"issue": 1, "reason": "Foundation work"}
  ],
  "notes": "Any observations"
}
\`\`\`
      `.trim();
    }

    return `
## Project Overview

**Project #${this.projectNumber}**: ${this.projectTitle}${labelInfo}

## Status

No${this.labelFilter ? ` "${this.labelFilter}" labeled` : ""} issues to process.
Project preparation complete with no work needed.
    `.trim();
  }

  private async buildProcessingPrompt(labelInfo: string): Promise<string> {
    if (!this.currentIssueHandler) {
      return `
Project #${this.projectNumber}${labelInfo} - All issues complete!
No more work needed. Moving to review phase.
      `.trim();
    }

    return await this.currentIssueHandler.buildInitialPrompt();
  }

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
1. Verify all issues with "${
      this.labelFilter || "any"
    }" label are properly closed
2. Check each issue's resolution quality
3. Identify any remaining work needed

Output your review in the review-result format:
\`\`\`review-result
{"result":"pass","summary":"All issues completed successfully"}
\`\`\`

or

\`\`\`review-result
{"result":"fail","summary":"N issues need attention","issues":[{"number":X,"reason":"..."}]}
\`\`\`
    `.trim();
  }

  private buildAgainPrompt(labelInfo: string): string {
    const reviewFindings = this.reviewResult?.issues
      ?.map((i) => `- #${i.number}: ${i.reason}`)
      .join("\n") || "- No specific issues identified";

    return `
## Re-execution Required

**Project #${this.projectNumber}**: ${this.projectTitle}${labelInfo}

## Review Findings

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

  private buildCompletePrompt(labelInfo: string): string {
    return `
Project #${this.projectNumber}${labelInfo} is complete!
${this.issuesCompleted} issue(s) have been closed.
    `.trim();
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    switch (this.phase) {
      case "processing":
        if (this.currentIssueHandler) {
          return await this.currentIssueHandler.buildContinuationPrompt(
            completedIterations,
            previousSummary,
          );
        }
        return `All issues processed. Moving to review.`;

      default: {
        const summarySection = previousSummary
          ? this.formatIterationSummary(previousSummary)
          : "";
        return `
Continue with ${this.phase} phase.
Iterations completed: ${completedIterations}

${summarySection}
        `.trim();
      }
    }
  }

  buildCompletionCriteria(): CompletionCriteria {
    const labelDesc = this.labelFilter
      ? ` with "${this.labelFilter}" label`
      : "";
    return {
      short: `Complete project #${this.projectNumber}`,
      detailed:
        `Work through GitHub Project #${this.projectNumber} issues${labelDesc} one by one. For each issue, implement the requirements and close it when done.`,
    };
  }

  async isComplete(): Promise<boolean> {
    await this.initialize();

    if (this.phase === "complete") {
      return true;
    }

    switch (this.phase) {
      case "preparation":
        return this.projectPlan !== null;
      case "processing":
        return await this.isProcessingComplete();
      case "review":
        return this.reviewResult !== null;
      case "again":
        return await this.isProcessingComplete();
    }

    return false;
  }

  private async isProcessingComplete(): Promise<boolean> {
    if (!this.currentIssueHandler) {
      return true;
    }

    const currentClosed = await this.currentIssueHandler.isComplete();
    if (currentClosed) {
      const issueNumber = this.currentIssueHandler.getIssueNumber();
      if (!this.completedIssueNumbers.has(issueNumber)) {
        this.issuesCompleted++;
        this.completedIssueNumbers.add(issueNumber);
      }

      if (this.remainingIssues.length > 0) {
        const nextIssue = this.remainingIssues.shift();
        if (nextIssue) {
          this.setCurrentIssue(nextIssue);
        }
        return false;
      }

      this.currentIssue = null;
      this.currentIssueHandler = null;
      return true;
    }

    return false;
  }

  async getCompletionDescription(): Promise<string> {
    await this.initialize();

    const phaseDesc = {
      preparation: "Preparation",
      processing: "Processing",
      review: "Review",
      again: "Re-execution",
      complete: "Complete",
    }[this.phase];

    if (this.phase === "complete" || !this.currentIssue) {
      return `Project #${this.projectNumber} - ${phaseDesc} (${this.issuesCompleted} issues closed)`;
    }

    const totalRemaining = (this.currentIssue ? 1 : 0) +
      this.remainingIssues.length;
    return `Project #${this.projectNumber} - ${phaseDesc}: Issue #${this.currentIssue.issueNumber} (${totalRemaining} remaining, ${this.issuesCompleted} closed)`;
  }

  getCurrentIssueNumber(): number | null {
    return this.currentIssue?.issueNumber ?? null;
  }

  getCompletedCount(): number {
    return this.issuesCompleted;
  }

  markCurrentIssueCompleted(): void {
    if (this.currentIssueHandler) {
      const issueNumber = this.currentIssueHandler.getIssueNumber();
      this.issuesCompleted++;
      this.completedIssueNumbers.add(issueNumber);
      if (this.remainingIssues.length > 0) {
        const nextIssue = this.remainingIssues.shift();
        if (nextIssue) {
          this.setCurrentIssue(nextIssue);
        }
      } else {
        this.currentIssue = null;
        this.currentIssueHandler = null;
      }
    }
  }

  getProjectPlan(): ProjectPlan | null {
    return this.projectPlan;
  }

  getReviewResult(): ReviewResult | null {
    return this.reviewResult;
  }
}
