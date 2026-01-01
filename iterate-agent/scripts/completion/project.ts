/**
 * Project Completion Handler
 *
 * Handles GitHub Project-based completion criteria.
 * Iterates through open issues one by one until all are closed.
 */

import type { IterationSummary } from "../types.ts";
import {
  fetchIssueRequirements,
  fetchProjectRequirements,
  getOpenIssuesFromProject,
  isIssueComplete,
  type ProjectIssueInfo,
} from "../github.ts";
import type { CompletionCriteria, CompletionHandler } from "./types.ts";
import { formatIterationSummary } from "./types.ts";

/**
 * ProjectCompletionHandler
 *
 * Manages iteration through GitHub Project issues one by one.
 * Each issue is worked on until closed, then moves to the next.
 */
export class ProjectCompletionHandler implements CompletionHandler {
  readonly type = "project" as const;

  /** List of remaining open issues to process */
  private remainingIssues: ProjectIssueInfo[] = [];

  /** Current issue being worked on */
  private currentIssue: ProjectIssueInfo | null = null;

  /** Number of issues completed in this session */
  private issuesCompleted = 0;

  /** Issue numbers that have been marked completed (to filter from re-fetch) */
  private completedIssueNumbers: Set<number> = new Set();

  /** Whether the handler has been initialized */
  private initialized = false;

  /**
   * Create a Project completion handler
   *
   * @param projectNumber - GitHub Project number to work on
   * @param labelFilter - Optional label to filter issues by
   */
  constructor(
    private readonly projectNumber: number,
    private readonly labelFilter?: string,
  ) {}

  /**
   * Initialize by fetching open issues from the project
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    this.remainingIssues = await getOpenIssuesFromProject(
      this.projectNumber,
      this.labelFilter,
    );
    this.initialized = true;

    // Set the first issue as current if there are any
    if (this.remainingIssues.length > 0) {
      this.currentIssue = this.remainingIssues.shift()!;
    }
  }

  /**
   * Build initial prompt with first issue details
   */
  async buildInitialPrompt(): Promise<string> {
    await this.initialize();

    // First, show project overview
    const projectContent = await fetchProjectRequirements(this.projectNumber);
    const labelInfo = this.labelFilter
      ? ` (filtered by label: "${this.labelFilter}")`
      : "";

    if (!this.currentIssue) {
      return `
You are working on GitHub Project #${this.projectNumber}${labelInfo}.

## Project Overview
${projectContent}

## Status
All${this.labelFilter ? ` "${this.labelFilter}" labeled` : ""} issues in this project are already complete! No work needed.
      `.trim();
    }

    // Get details for the current issue (with cross-repo support)
    const issueContent = await fetchIssueRequirements(
      this.currentIssue.issueNumber,
      this.currentIssue.repository,
    );

    const remainingCount = this.remainingIssues.length;
    // Don't show repository info in remaining list to avoid confusion
    const remainingList = this.remainingIssues
      .slice(0, 5)
      .map((i) => `  - #${i.issueNumber}: ${i.title}`)
      .join("\n");
    const moreText = remainingCount > 5
      ? `\n  ... and ${remainingCount - 5} more`
      : "";

    // For cross-repo issues: hide repository details, emphasize current directory work
    const crossRepoWorkNote = this.currentIssue.repository
      ? `
**Note**: This issue contains requirements from an external repository.
All implementation work should be done **in the current directory**.
`
      : "";

    return `
You are working on GitHub Project #${this.projectNumber}${labelInfo}.

## Project Overview
${projectContent}

---

## Current Task: Issue #${this.currentIssue.issueNumber}

${issueContent}
${crossRepoWorkNote}
## Queue Status
- **Current issue**: #${this.currentIssue.issueNumber} - ${this.currentIssue.title}
- **Remaining issues**: ${remainingCount}${this.labelFilter ? ` (with "${this.labelFilter}" label)` : ""}
${remainingList}${moreText}

## Your Mission
1. Focus on completing Issue #${this.currentIssue.issueNumber}
2. Use the **delegate-climpt-agent** Skill to implement the required changes
3. All work must be done **in the current working directory**
4. Continue until this issue's requirements are fully satisfied

## Issue Actions (IMPORTANT)
Use these structured outputs to communicate with the issue. **Do NOT run \`gh\` commands directly.**

### Report Progress
\`\`\`issue-action
{"action":"progress","issue":${this.currentIssue.issueNumber},"body":"## Progress\\n- Step 1 completed\\n- Working on step 2"}
\`\`\`

### Ask a Question
\`\`\`issue-action
{"action":"question","issue":${this.currentIssue.issueNumber},"body":"Need clarification on..."}
\`\`\`

### Report Blocker (stops iteration, awaits human)
\`\`\`issue-action
{"action":"blocked","issue":${this.currentIssue.issueNumber},"body":"Cannot proceed because...","label":"need clearance"}
\`\`\`

### Complete Issue (closes automatically)
\`\`\`issue-action
{"action":"close","issue":${this.currentIssue.issueNumber},"body":"Implemented feature X with tests"}
\`\`\`

Start by analyzing Issue #${this.currentIssue.issueNumber} and planning your implementation.
    `.trim();
  }

  /**
   * Build continuation prompt for subsequent iterations
   */
  buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): string {
    const summarySection = previousSummary
      ? formatIterationSummary(previousSummary)
      : "";

    if (!this.currentIssue) {
      return `
All issues in Project #${this.projectNumber} have been completed!
You have completed ${completedIterations} iteration(s) and closed ${this.issuesCompleted} issue(s).

${summarySection}

No more work needed. The project is complete.
      `.trim();
    }

    const remainingCount = this.remainingIssues.length;

    // For cross-repo issues: emphasize current directory work
    const crossRepoWorkNote = this.currentIssue.repository
      ? `\n**Note**: Work in current directory (issue is from external repository).`
      : "";

    return `
You are continuing work on GitHub Project #${this.projectNumber}.
You have completed ${completedIterations} iteration(s) and closed ${this.issuesCompleted} issue(s).

${summarySection}

## Current Task: Issue #${this.currentIssue.issueNumber}

**Title**: ${this.currentIssue.title}
**Status**: ${this.currentIssue.status || "No status"}${crossRepoWorkNote}
**Remaining issues in queue**: ${remainingCount}

## Your Mission
1. Review the Previous Iteration Summary to understand what was accomplished
2. Continue working on Issue #${this.currentIssue.issueNumber}
3. Use the **delegate-climpt-agent** Skill to implement the remaining changes
4. All work must be done **in the current working directory**

## Issue Actions
Use these structured outputs to communicate with the issue. **Do NOT run \`gh\` commands directly.**

- **Progress**: \`{"action":"progress","issue":${this.currentIssue.issueNumber},"body":"..."}\`
- **Question**: \`{"action":"question","issue":${this.currentIssue.issueNumber},"body":"..."}\`
- **Blocked**: \`{"action":"blocked","issue":${this.currentIssue.issueNumber},"body":"...","label":"need clearance"}\`
- **Complete**: \`{"action":"close","issue":${this.currentIssue.issueNumber},"body":"..."}\`

Wrap in \`\`\`issue-action\n...\n\`\`\` code block.

**Next Step**: Analyze the summary above and continue working on Issue #${this.currentIssue.issueNumber}.
    `.trim();
  }

  /**
   * Get completion criteria for system prompt
   */
  buildCompletionCriteria(): CompletionCriteria {
    const labelDesc = this.labelFilter
      ? ` with "${this.labelFilter}" label`
      : "";
    return {
      criteria: `completing all open issues${labelDesc} in Project #${this.projectNumber}`,
      detail:
        `Work through Project #${this.projectNumber} issues${labelDesc} one by one. For each issue, implement the requirements and close it when done. The agent will automatically move to the next issue until all are complete.`,
    };
  }

  /**
   * Check if current issue is complete and advance to next if needed
   *
   * @returns true if all project issues are complete
   */
  async isComplete(): Promise<boolean> {
    await this.initialize();

    // If no current issue, check if we're done
    if (!this.currentIssue) {
      // Re-fetch to make sure we haven't missed any
      const openIssues = await getOpenIssuesFromProject(
        this.projectNumber,
        this.labelFilter,
      );
      // Filter out issues we've already completed (API cache may be stale)
      const filteredIssues = openIssues.filter(
        (issue) => !this.completedIssueNumbers.has(issue.issueNumber),
      );
      if (filteredIssues.length === 0) {
        return true;
      }
      // If there are new open issues, pick one up
      this.remainingIssues = filteredIssues;
      this.currentIssue = this.remainingIssues.shift()!;
      return false;
    }

    // Check if current issue is closed (with cross-repo support)
    const currentClosed = await isIssueComplete(
      this.currentIssue.issueNumber,
      this.currentIssue.repository,
    );

    if (currentClosed) {
      // Only count if not already counted by markCurrentIssueCompleted()
      if (!this.completedIssueNumbers.has(this.currentIssue.issueNumber)) {
        this.issuesCompleted++;
        this.completedIssueNumbers.add(this.currentIssue.issueNumber);
      }

      // Move to next issue
      if (this.remainingIssues.length > 0) {
        this.currentIssue = this.remainingIssues.shift()!;
        return false;
      }

      // No more queued issues - re-fetch to check for any remaining
      const openIssues = await getOpenIssuesFromProject(
        this.projectNumber,
        this.labelFilter,
      );
      // Filter out issues we've already completed (API cache may be stale)
      const filteredIssues = openIssues.filter(
        (issue) => !this.completedIssueNumbers.has(issue.issueNumber),
      );
      if (filteredIssues.length === 0) {
        this.currentIssue = null;
        return true;
      }

      // More issues found, continue
      this.remainingIssues = filteredIssues;
      this.currentIssue = this.remainingIssues.shift()!;
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

    const totalRemaining = 1 + this.remainingIssues.length; // current + queue

    if (!this.currentIssue) {
      return `Project #${this.projectNumber} is COMPLETE (${this.issuesCompleted} issues closed)`;
    }

    return `Project #${this.projectNumber}: Working on Issue #${this.currentIssue.issueNumber} (${totalRemaining} remaining, ${this.issuesCompleted} closed)`;
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
    if (this.currentIssue) {
      this.issuesCompleted++;
      this.completedIssueNumbers.add(this.currentIssue.issueNumber);
      if (this.remainingIssues.length > 0) {
        this.currentIssue = this.remainingIssues.shift()!;
      } else {
        this.currentIssue = null;
      }
    }
  }
}
