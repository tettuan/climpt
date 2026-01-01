/**
 * Issue Completion Handler
 *
 * Handles GitHub Issue-based completion criteria.
 * Can be used standalone or as part of ProjectCompletionHandler.
 */

import type { IterationSummary } from "../types.ts";
import { fetchIssueRequirements, isIssueComplete } from "../github.ts";
import type { CompletionCriteria, CompletionHandler } from "./types.ts";
import { formatIterationSummary } from "./types.ts";

/**
 * Project context for when Issue is part of a Project
 */
export interface ProjectContext {
  /** Project number */
  projectNumber: number;
  /** Project title */
  projectTitle: string;
  /** Project description */
  projectDescription: string | null;
  /** Total issues in project (with label filter) */
  totalIssues: number;
  /** Current issue index (1-based) */
  currentIndex: number;
  /** Remaining issue titles (for context) */
  remainingIssueTitles: string[];
  /** Label filter applied */
  labelFilter?: string;
}

/**
 * IssueCompletionHandler
 *
 * Manages iteration until a GitHub Issue is closed.
 * Supports optional project context for when used from ProjectCompletionHandler.
 */
export class IssueCompletionHandler implements CompletionHandler {
  readonly type = "issue" as const;

  /** Optional repository for cross-repo issues */
  private repository?: string;

  /** Optional project context */
  private projectContext?: ProjectContext;

  /**
   * Create an Issue completion handler
   *
   * @param issueNumber - GitHub Issue number to work on
   * @param repository - Optional repository (owner/repo) for cross-repo issues
   */
  constructor(
    private readonly issueNumber: number,
    repository?: string,
  ) {
    this.repository = repository;
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

  /**
   * Get the repository (for cross-repo support)
   */
  getRepository(): string | undefined {
    return this.repository;
  }

  /**
   * Build initial prompt with Issue details
   * Includes project context if set, and issue-action format for completion reporting
   */
  async buildInitialPrompt(): Promise<string> {
    const issueContent = await fetchIssueRequirements(
      this.issueNumber,
      this.repository,
    );

    // Build project context section if available
    const projectSection = this.projectContext
      ? this.buildProjectContextSection()
      : "";

    // Cross-repo note if applicable
    const crossRepoNote = this.repository
      ? `\n**Note**: This issue is from an external repository. All work should be done in the current directory.\n`
      : "";

    return `
${projectSection}## Current Task: Issue #${this.issueNumber}

${issueContent}
${crossRepoNote}
## Your Mission
1. Analyze the issue requirements
2. Use the **delegate-climpt-agent** Skill to implement the required changes
3. Verify the implementation meets the requirements
4. Report completion using the issue-action format below

## Issue Actions

Use these structured outputs to communicate. **Do NOT run \`gh\` commands directly.**

### Report Progress (optional, for long tasks)
\`\`\`issue-action
{"action":"progress","issue":${this.issueNumber},"body":"## Progress\\n- Step 1 done\\n- Working on step 2"}
\`\`\`

### Complete Issue (REQUIRED when done)
\`\`\`issue-action
{"action":"close","issue":${this.issueNumber},"body":"## Resolution\\n- What was implemented\\n- How it was verified"}
\`\`\`

### Ask a Question (if blocked by missing information)
\`\`\`issue-action
{"action":"question","issue":${this.issueNumber},"body":"Need clarification on..."}
\`\`\`

### Report Blocker (if cannot proceed)
\`\`\`issue-action
{"action":"blocked","issue":${this.issueNumber},"body":"Cannot proceed because...","label":"need clearance"}
\`\`\`

Start by analyzing Issue #${this.issueNumber} and planning your implementation.
    `.trim();
  }

  /**
   * Build project context section for prompts
   */
  private buildProjectContextSection(): string {
    if (!this.projectContext) return "";

    const ctx = this.projectContext;
    const labelInfo = ctx.labelFilter
      ? ` (filtered by label: "${ctx.labelFilter}")`
      : "";

    const remainingList = ctx.remainingIssueTitles
      .slice(0, 5)
      .map((title, i) => `  - ${title}`)
      .join("\n");
    const moreText = ctx.remainingIssueTitles.length > 5
      ? `\n  ... and ${ctx.remainingIssueTitles.length - 5} more`
      : "";

    return `## Project Overview

**Project #${ctx.projectNumber}**: ${ctx.projectTitle}${labelInfo}
${ctx.projectDescription ? `\n${ctx.projectDescription}\n` : ""}
**Progress**: Issue ${ctx.currentIndex} of ${ctx.totalIssues}

### Remaining Issues (for context only)
${remainingList}${moreText}

---

`;
  }

  /**
   * Build continuation prompt for subsequent iterations
   * Includes project context if set, and issue-action format for completion reporting
   */
  buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): string {
    const summarySection = previousSummary
      ? formatIterationSummary(previousSummary)
      : "";

    // Build project context header if available
    const projectHeader = this.projectContext
      ? `Project #${this.projectContext.projectNumber}: Issue ${this.projectContext.currentIndex} of ${this.projectContext.totalIssues}\n\n`
      : "";

    // Cross-repo note if applicable
    const crossRepoNote = this.repository
      ? `\n**Note**: Work in current directory (issue is from external repository).`
      : "";

    return `
${projectHeader}You are continuing work on Issue #${this.issueNumber}.
Iterations completed: ${completedIterations}${crossRepoNote}

${summarySection}

## Your Mission
1. Review the Previous Iteration Summary to understand what was accomplished
2. Identify what remains to close this issue
3. Use **delegate-climpt-agent** Skill to implement remaining changes
4. Report completion when done

## Issue Actions

Use these structured outputs. **Do NOT run \`gh\` commands directly.**

- **Progress**: \`{"action":"progress","issue":${this.issueNumber},"body":"..."}\`
- **Complete**: \`{"action":"close","issue":${this.issueNumber},"body":"..."}\`
- **Question**: \`{"action":"question","issue":${this.issueNumber},"body":"..."}\`
- **Blocked**: \`{"action":"blocked","issue":${this.issueNumber},"body":"...","label":"need clearance"}\`

Wrap in \`\`\`issue-action\n...\n\`\`\` code block.

**Next Step**: Review the summary and continue working on Issue #${this.issueNumber}.
    `.trim();
  }

  /**
   * Get completion criteria for system prompt
   */
  buildCompletionCriteria(): CompletionCriteria {
    return {
      criteria: `closing Issue #${this.issueNumber}`,
      detail:
        `Work on Issue #${this.issueNumber} until it is closed. The issue will be checked periodically; when it's marked as CLOSED, your work is complete.`,
    };
  }

  /**
   * Check if Issue is closed (supports cross-repo)
   */
  async isComplete(): Promise<boolean> {
    return await isIssueComplete(this.issueNumber, this.repository);
  }

  /**
   * Get human-readable completion status
   */
  async getCompletionDescription(): Promise<string> {
    const complete = await this.isComplete();
    return complete
      ? `Issue #${this.issueNumber} is now CLOSED`
      : `Issue #${this.issueNumber} is still OPEN`;
  }
}
