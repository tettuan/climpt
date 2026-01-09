/**
 * Issue completion handler - completes when a GitHub Issue is closed
 */

import type { PromptResolver } from "../prompts/resolver.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type IterationSummary,
} from "./types.ts";

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

  constructor(
    private readonly issueNumber: number,
    repository?: string,
  ) {
    super();
    this.repository = repository;
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

  async isComplete(): Promise<boolean> {
    try {
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
      }).output();

      if (!result.success) {
        return false;
      }

      const output = new TextDecoder().decode(result.stdout);
      const data = JSON.parse(output);
      return data.state === "CLOSED";
    } catch {
      return false;
    }
  }

  async getCompletionDescription(): Promise<string> {
    const complete = await this.isComplete();
    return complete
      ? `Issue #${this.issueNumber} is now CLOSED`
      : `Issue #${this.issueNumber} is still OPEN`;
  }
}
