/**
 * Facilitator completion handler - focuses on project flow facilitation
 *
 * Responsibilities:
 * - Project state monitoring (not directing)
 * - Bottleneck detection
 * - Progress reporting
 * - Smooth workflow facilitation
 *
 * Phases:
 * 1. MONITORING - Check project state, identify blockers
 * 2. INTERVENTION - Suggest actions to unblock progress
 * 3. REPORTING - Generate progress summary
 * 4. COMPLETE - Done when project flows smoothly
 */

import type { PromptResolver } from "../prompts/resolver.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type IterationSummary,
} from "./types.ts";

export type FacilitatorPhase =
  | "monitoring"
  | "intervention"
  | "reporting"
  | "complete";

export interface ProjectStatus {
  totalIssues: number;
  openIssues: number;
  closedIssues: number;
  inProgressIssues: number;
  blockedIssues: number;
  staleIssues: number;
}

export interface BlockerInfo {
  issueNumber: number;
  title: string;
  reason: string;
  suggestedAction?: string;
}

export interface FacilitatorReport {
  timestamp: string;
  projectNumber: number;
  status: ProjectStatus;
  blockers: BlockerInfo[];
  recommendations: string[];
  healthScore: number; // 0-100
}

export class FacilitatorCompletionHandler extends BaseCompletionHandler {
  readonly type = "facilitator" as const;

  private phase: FacilitatorPhase = "monitoring";
  private projectStatus: ProjectStatus | null = null;
  private blockers: BlockerInfo[] = [];
  private report: FacilitatorReport | null = null;
  private initialized = false;
  private checkCount = 0;
  private maxChecks = 10;

  private promptResolver?: PromptResolver;

  constructor(
    private readonly projectNumber: number,
    private readonly projectOwner?: string,
    private readonly checkInterval: number = 1, // iterations between checks
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
  getPhase(): FacilitatorPhase {
    return this.phase;
  }

  /**
   * Advance to next phase
   */
  advancePhase(): void {
    switch (this.phase) {
      case "monitoring":
        if (this.blockers.length > 0) {
          this.phase = "intervention";
        } else {
          this.phase = "reporting";
        }
        break;
      case "intervention":
        this.phase = "reporting";
        break;
      case "reporting":
        this.phase = "complete";
        break;
      case "complete":
        break;
    }
  }

  /**
   * Set phase back to monitoring for continuous facilitation
   */
  resetToMonitoring(): void {
    this.phase = "monitoring";
    this.blockers = [];
  }

  /**
   * Get project status with fallback for uninitialized state
   */
  private getStatus(): ProjectStatus {
    return this.projectStatus ?? {
      totalIssues: 0,
      openIssues: 0,
      closedIssues: 0,
      inProgressIssues: 0,
      blockedIssues: 0,
      staleIssues: 0,
    };
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.projectStatus = await this.fetchProjectStatus();
    } catch (_error) {
      // Error logged via completion handler flow - use fallback status
      this.projectStatus = {
        totalIssues: 0,
        openIssues: 0,
        closedIssues: 0,
        inProgressIssues: 0,
        blockedIssues: 0,
        staleIssues: 0,
      };
    }

    this.initialized = true;
  }

  private async fetchProjectStatus(): Promise<ProjectStatus> {
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
        return this.emptyStatus();
      }

      const output = new TextDecoder().decode(result.stdout);
      let data;
      try {
        data = JSON.parse(output);
      } catch {
        // Invalid JSON from gh CLI - use empty status
        return this.emptyStatus();
      }
      const items = data.items || [];

      // Calculate status from items
      const status: ProjectStatus = {
        totalIssues: items.length,
        openIssues: 0,
        closedIssues: 0,
        inProgressIssues: 0,
        blockedIssues: 0,
        staleIssues: 0,
      };

      const now = new Date();
      const staleThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const item of items) {
        const itemStatus = (item.status || "").toLowerCase();

        if (itemStatus === "done" || itemStatus === "closed") {
          status.closedIssues++;
        } else if (
          itemStatus === "in progress" || itemStatus === "in_progress"
        ) {
          status.inProgressIssues++;
          status.openIssues++;
        } else if (itemStatus === "blocked") {
          status.blockedIssues++;
          status.openIssues++;

          // Track blocker details
          this.blockers.push({
            issueNumber: item.number,
            title: item.title || `Issue #${item.number}`,
            reason: "Marked as blocked",
          });
        } else {
          status.openIssues++;
        }

        // Check for stale items (not updated in 7 days)
        if (item.updatedAt) {
          const updatedAt = new Date(item.updatedAt);
          if (now.getTime() - updatedAt.getTime() > staleThreshold) {
            status.staleIssues++;
            if (!this.blockers.find((b) => b.issueNumber === item.number)) {
              this.blockers.push({
                issueNumber: item.number,
                title: item.title || `Issue #${item.number}`,
                reason: "Stale - no updates for 7+ days",
                suggestedAction:
                  "Review and update or close if no longer needed",
              });
            }
          }
        }
      }

      return status;
    } catch {
      return this.emptyStatus();
    }
  }

  private emptyStatus(): ProjectStatus {
    return {
      totalIssues: 0,
      openIssues: 0,
      closedIssues: 0,
      inProgressIssues: 0,
      blockedIssues: 0,
      staleIssues: 0,
    };
  }

  async buildInitialPrompt(): Promise<string> {
    await this.initialize();

    switch (this.phase) {
      case "monitoring":
        return this.buildMonitoringPrompt();
      case "intervention":
        return this.buildInterventionPrompt();
      case "reporting":
        return this.buildReportingPrompt();
      case "complete":
        return this.buildCompletePrompt();
    }
  }

  private buildMonitoringPrompt(): string {
    const status = this.getStatus();
    const healthScore = this.calculateHealthScore(status);

    return `
## Project Facilitation - Monitoring Phase

**Project #${this.projectNumber}**

### Current Status

| Metric | Count |
|--------|-------|
| Total Issues | ${status.totalIssues} |
| Open | ${status.openIssues} |
| In Progress | ${status.inProgressIssues} |
| Closed | ${status.closedIssues} |
| Blocked | ${status.blockedIssues} |
| Stale (7+ days) | ${status.staleIssues} |

**Health Score: ${healthScore}/100**

### Your Task

As a facilitator, monitor the project state:

1. Review the current status metrics
2. Identify any bottlenecks or blockers
3. Check for stale issues that need attention
4. Assess overall project health

If you identify blockers, output them in the following format:

\`\`\`blocker-report
{
  "blockers": [
    {"issueNumber": 123, "title": "Issue title", "reason": "Why it's blocked", "suggestedAction": "What to do"}
  ],
  "healthAssessment": "Brief assessment"
}
\`\`\`

If no blockers are found, output:

\`\`\`blocker-report
{"blockers": [], "healthAssessment": "Project is flowing smoothly"}
\`\`\`
    `.trim();
  }

  private buildInterventionPrompt(): string {
    const blockerList = this.blockers
      .map(
        (b) =>
          `- **#${b.issueNumber}**: ${b.title}\n  - Reason: ${b.reason}${
            b.suggestedAction ? `\n  - Suggested: ${b.suggestedAction}` : ""
          }`,
      )
      .join("\n");

    return `
## Project Facilitation - Intervention Phase

**Project #${this.projectNumber}**

### Identified Blockers

${blockerList || "No specific blockers identified"}

### Your Task

As a facilitator, help unblock the project:

1. For each blocker, suggest concrete actions
2. Prioritize interventions by impact
3. Consider dependencies between issues
4. Focus on enabling progress, not directing it

Output your intervention plan:

\`\`\`intervention-plan
{
  "interventions": [
    {"issueNumber": 123, "action": "Specific action to take", "priority": "high|medium|low"}
  ],
  "summary": "Overall intervention approach"
}
\`\`\`
    `.trim();
  }

  private buildReportingPrompt(): string {
    const status = this.getStatus();
    const healthScore = this.calculateHealthScore(status);

    return `
## Project Facilitation - Reporting Phase

**Project #${this.projectNumber}**

### Status Summary

- Total: ${status.totalIssues} issues
- Progress: ${status.closedIssues}/${status.totalIssues} completed (${
      status.totalIssues > 0
        ? Math.round((status.closedIssues / status.totalIssues) * 100)
        : 0
    }%)
- Health Score: ${healthScore}/100
- Blockers addressed: ${this.blockers.length}

### Your Task

Generate a facilitation report:

1. Summarize project health
2. List key achievements
3. Note ongoing concerns
4. Provide recommendations

Output your report:

\`\`\`facilitator-report
{
  "healthScore": ${healthScore},
  "summary": "Overall project status",
  "achievements": ["Achievement 1", "Achievement 2"],
  "concerns": ["Concern 1"],
  "recommendations": ["Recommendation 1"]
}
\`\`\`
    `.trim();
  }

  private buildCompletePrompt(): string {
    return `
## Project Facilitation Complete

**Project #${this.projectNumber}**

Facilitation cycle complete. The project has been monitored and any blockers have been addressed.

Health Score: ${this.calculateHealthScore(this.getStatus())}/100
    `.trim();
  }

  private calculateHealthScore(status: ProjectStatus): number {
    if (status.totalIssues === 0) return 100;

    let score = 100;

    // Deduct for blocked issues (severe)
    score -= status.blockedIssues * 15;

    // Deduct for stale issues (moderate)
    score -= status.staleIssues * 10;

    // Bonus for completion progress
    const completionRate = status.closedIssues / status.totalIssues;
    score += completionRate * 20;

    // Ensure score is within bounds
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  buildContinuationPrompt(
    _completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    this.checkCount++;

    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return Promise.resolve(`
Continue facilitation of Project #${this.projectNumber}.
Check #${this.checkCount}/${this.maxChecks}
Phase: ${this.phase}

${summarySection}
    `.trim());
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `Facilitate project #${this.projectNumber}`,
      detailed:
        `Monitor GitHub Project #${this.projectNumber} state, identify blockers, and facilitate smooth workflow. Focus on enabling progress rather than directing it.`,
    };
  }

  async isComplete(): Promise<boolean> {
    await this.initialize();

    if (this.phase === "complete") {
      return true;
    }

    // Complete after max checks
    if (this.checkCount >= this.maxChecks) {
      return true;
    }

    return false;
  }

  async getCompletionDescription(): Promise<string> {
    await this.initialize();

    const status = this.getStatus();
    const healthScore = this.calculateHealthScore(status);

    return `Project #${this.projectNumber} facilitation - ${this.phase} phase (Health: ${healthScore}/100)`;
  }

  // Accessors for testing and external use

  getProjectStatus(): ProjectStatus | null {
    return this.projectStatus;
  }

  getBlockers(): BlockerInfo[] {
    return [...this.blockers];
  }

  getReport(): FacilitatorReport | null {
    return this.report;
  }

  setReport(report: FacilitatorReport): void {
    this.report = report;
  }

  addBlocker(blocker: BlockerInfo): void {
    this.blockers.push(blocker);
  }

  clearBlockers(): void {
    this.blockers = [];
  }
}
