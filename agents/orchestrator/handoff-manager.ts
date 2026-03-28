/**
 * Handoff Manager - Inter-agent handoff comment handling
 *
 * Resolves handoff templates and posts comments to GitHub issues
 * when agents complete execution. Extracted from Orchestrator to
 * separate handoff communication from workflow orchestration.
 */

import type { HandoffConfig } from "./workflow-types.ts";
import type { GitHubClient } from "./github-client.ts";
import { renderTemplate } from "./phase-transition.ts";

export class HandoffManager {
  #config: HandoffConfig;

  constructor(config: HandoffConfig) {
    this.#config = config;
  }

  /**
   * Resolve the template string for a given agent/outcome pair.
   *
   * Convention: tries "{agentId}{Outcome}" then "{agentId}To{Outcome}".
   * Returns undefined if no matching template exists.
   */
  resolveTemplate(agentId: string, outcome: string): string | undefined {
    const templates = this.#config.commentTemplates;
    if (!templates) return undefined;

    const capitalized = outcome.length === 0
      ? outcome
      : outcome[0].toUpperCase() + outcome.slice(1);

    const candidates = [
      `${agentId}${capitalized}`,
      `${agentId}To${capitalized}`,
    ];

    for (const key of candidates) {
      if (key in templates) return templates[key];
    }

    return undefined;
  }

  /**
   * Resolve, render, and post a handoff comment if a template matches.
   *
   * No-ops when no template matches or commentTemplates is absent.
   */
  async renderAndPost(
    github: GitHubClient,
    issueNumber: number,
    agentId: string,
    outcome: string,
    vars: Record<string, string>,
  ): Promise<void> {
    const template = this.resolveTemplate(agentId, outcome);
    if (template === undefined) return;

    const comment = renderTemplate(template, vars);
    await github.addIssueComment(issueNumber, comment);
  }
}
