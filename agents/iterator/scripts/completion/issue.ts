/**
 * Issue Completion Handler
 *
 * Handles GitHub Issue-based completion criteria.
 * Can be used standalone or as part of ProjectCompletionHandler.
 *
 * ## Prompt Externalization
 *
 * This handler uses PromptResolver for customizable prompts:
 * - User can override prompts by placing files in .agent/iterator/prompts/
 * - Falls back to embedded prompts in fallback-prompts.ts
 *
 * Steps:
 * - initial.issue: Initial prompt for issue work
 * - continuation.issue: Continuation prompt for iterations
 * - section.projectcontext: Project context section (when part of project)
 */

import type { IterationSummary } from "../types.ts";
import { fetchIssueRequirements, isIssueComplete } from "../github.ts";
import type { CompletionCriteria, CompletionHandler } from "./types.ts";
import { formatIterationSummary } from "./types.ts";
import type {
  PromptResolver,
  PromptVariables,
} from "../../../common/prompt-resolver.ts";

/**
 * Project context for when Issue is part of a Project
 */
export interface ProjectContext {
  /** Project number */
  projectNumber: number;
  /** Project title */
  projectTitle: string;
  /** Project description (shortDescription) */
  projectDescription: string | null;
  /** Project readme */
  projectReadme: string | null;
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

  /** Optional prompt resolver for externalized prompts */
  private promptResolver?: PromptResolver;

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
   * Set prompt resolver for externalized prompts
   *
   * @param resolver - PromptResolver instance
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
      ? await this.buildProjectContextSection()
      : "";

    // Cross-repo note if applicable
    const crossRepoNote = this.repository
      ? `\n**Note**: This issue is from an external repository. All work should be done in the current directory.\n`
      : "";

    // Use PromptResolver if available
    if (this.promptResolver) {
      const variables: PromptVariables = {
        uv: {
          issue_number: String(this.issueNumber),
        },
        custom: {
          project_context_section: projectSection,
          issue_content: issueContent,
          cross_repo_note: crossRepoNote,
        },
      };

      const result = await this.promptResolver.resolve(
        "initial.issue",
        variables,
      );
      return result.content;
    }

    // Fallback to inline prompt (for backward compatibility)
    return this.buildInlineInitialPrompt(
      projectSection,
      issueContent,
      crossRepoNote,
    );
  }

  /**
   * Build inline initial prompt (fallback when no resolver)
   */
  private buildInlineInitialPrompt(
    projectSection: string,
    issueContent: string,
    crossRepoNote: string,
  ): string {
    return `
${projectSection}## Current Task: Issue #${this.issueNumber}

${issueContent}
${crossRepoNote}
## Working Style: Task-Driven & Progressive

**IMPORTANT**: Work in small, trackable steps with frequent progress updates.

### Step 1: Analyze & Break Down
1. Read and understand the issue requirements thoroughly
2. **Use TodoWrite** to create fine-grained task list (5-10 specific tasks)
3. Each task should be completable in 1-2 tool invocations

### Step 2: Execute with Delegation
For each task:
1. Mark task as \`in_progress\` in TodoWrite
2. **Delegate complex work to sub-agents** using Task tool:
   - Use \`subagent_type="Explore"\` for codebase investigation
   - Use \`subagent_type="general-purpose"\` for multi-step implementations
   - Use \`subagent_type="Plan"\` for architectural decisions
3. Use **delegate-climpt-agent** Skill for project-specific workflows
4. Mark task as \`completed\` when done

### Step 3: Track Progress
- Update TodoWrite after EACH task completion
- Report progress via issue-action every 2-3 tasks
- Keep momentum: one task at a time, always moving forward

## Sub-Agent Delegation Guide

Use Task tool to offload work:
| Situation | Sub-agent Type |
|-----------|----------------|
| Find files/understand structure | \`Explore\` |
| Implement a feature | \`general-purpose\` |
| Design implementation approach | \`Plan\` |
| Project-specific commands | \`delegate-climpt-agent\` Skill |

**Parallel execution**: Launch multiple independent agents simultaneously for efficiency.

## Issue Actions

Use these structured outputs. **Do NOT run \`gh\` commands directly.**

### Report Progress (RECOMMENDED every 2-3 tasks)
\`\`\`issue-action
{"action":"progress","issue":${this.issueNumber},"body":"## Progress\\n- [x] Task 1 done\\n- [x] Task 2 done\\n- [ ] Task 3 in progress"}
\`\`\`

### Complete Issue (REQUIRED when done)
\`\`\`issue-action
{"action":"close","issue":${this.issueNumber},"body":"## Resolution\\n- What was implemented\\n- How it was verified\\n- Tasks completed: N"}
\`\`\`

### Ask a Question (if blocked)
\`\`\`issue-action
{"action":"question","issue":${this.issueNumber},"body":"Need clarification on..."}
\`\`\`

### Report Blocker (if cannot proceed)
\`\`\`issue-action
{"action":"blocked","issue":${this.issueNumber},"body":"Cannot proceed because...","label":"need clearance"}
\`\`\`

---

**Start NOW**: Use TodoWrite to create your task breakdown for Issue #${this.issueNumber}.
    `.trim();
  }

  /**
   * Build project context section for prompts
   */
  private async buildProjectContextSection(): Promise<string> {
    if (!this.projectContext) return "";

    const ctx = this.projectContext;
    const labelInfo = ctx.labelFilter
      ? ` (filtered by label: "${ctx.labelFilter}")`
      : "";

    const remainingList = ctx.remainingIssueTitles
      .slice(0, 5)
      .map((title) => `  - ${title}`)
      .join("\n");
    const moreText = ctx.remainingIssueTitles.length > 5
      ? `\n  ... and ${ctx.remainingIssueTitles.length - 5} more`
      : "";

    // Build description section
    const descSection = ctx.projectDescription
      ? `\n### Description\n${ctx.projectDescription}\n`
      : "";

    // Build readme section (separate from description)
    const readmeSection = ctx.projectReadme
      ? `\n### README\n${ctx.projectReadme}\n`
      : "";

    // Use PromptResolver if available
    if (this.promptResolver) {
      const variables: PromptVariables = {
        uv: {
          project_number: String(ctx.projectNumber),
          project_title: ctx.projectTitle,
          label_info: labelInfo,
          current_index: String(ctx.currentIndex),
          total_issues: String(ctx.totalIssues),
        },
        custom: {
          desc_section: descSection,
          readme_section: readmeSection,
          remaining_list: remainingList,
          more_text: moreText,
        },
      };

      const result = await this.promptResolver.resolve(
        "section.projectcontext",
        variables,
      );
      return result.content + "\n\n";
    }

    // Fallback to inline section
    return `## Project Overview

**Project #${ctx.projectNumber}**: ${ctx.projectTitle}${labelInfo}
${descSection}${readmeSection}
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
  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
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

    // Use PromptResolver if available
    if (this.promptResolver) {
      const variables: PromptVariables = {
        uv: {
          issue_number: String(this.issueNumber),
          completed_iterations: String(completedIterations),
        },
        custom: {
          project_header: projectHeader,
          cross_repo_note: crossRepoNote,
          summary_section: summarySection,
        },
      };

      const result = await this.promptResolver.resolve(
        "continuation.issue",
        variables,
      );
      return result.content;
    }

    // Fallback to inline prompt
    return this.buildInlineContinuationPrompt(
      projectHeader,
      crossRepoNote,
      summarySection,
      completedIterations,
    );
  }

  /**
   * Build inline continuation prompt (fallback when no resolver)
   */
  private buildInlineContinuationPrompt(
    projectHeader: string,
    crossRepoNote: string,
    summarySection: string,
    completedIterations: number,
  ): string {
    return `
${projectHeader}You are continuing work on Issue #${this.issueNumber}.
Iterations completed: ${completedIterations}${crossRepoNote}

${summarySection}

## Continue: Task-Driven Execution

### Check Your Progress
1. **Review TodoWrite** - What tasks are pending/in_progress?
2. If no todos exist, create them now (5-10 specific tasks)
3. Mark current task as \`in_progress\`

### Execute Next Task
1. **Delegate complex work** using Task tool:
   - \`subagent_type="Explore"\` - codebase investigation
   - \`subagent_type="general-purpose"\` - multi-step implementation
   - \`subagent_type="Plan"\` - architectural decisions
2. Use **delegate-climpt-agent** Skill for project-specific workflows
3. Mark task as \`completed\` when done, move to next

### Track & Report
- Update TodoWrite after EACH task
- Report progress via issue-action every 2-3 tasks
- Only one task should be \`in_progress\` at a time

## Issue Actions

\`\`\`issue-action
{"action":"progress","issue":${this.issueNumber},"body":"## Progress\\n- [x] Completed tasks...\\n- [ ] Current task..."}
\`\`\`

\`\`\`issue-action
{"action":"close","issue":${this.issueNumber},"body":"## Resolution\\n- Implementation summary\\n- Verification done\\n- Tasks: N completed"}
\`\`\`

---

**Now**: Check TodoWrite, pick next task, execute with delegation.
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
