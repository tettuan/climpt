/**
 * Issue completion handler - completes when a GitHub Issue is closed
 */

import type { IterationSummary } from "../src_common/types.ts";
import type { PromptResolver } from "../prompts/resolver.ts";
import { BaseCompletionHandler, type CompletionCriteria } from "./types.ts";

export interface IssueHandlerOptions {
  issueNumber: number;
  promptResolver: PromptResolver;
}

export class IssueCompletionHandler extends BaseCompletionHandler {
  readonly type = "issue" as const;
  private issueNumber: number;
  private promptResolver: PromptResolver;

  constructor(options: IssueHandlerOptions) {
    super();
    if (!options.issueNumber) {
      throw new Error("--issue <number> is required for issue completion type");
    }
    this.issueNumber = options.issueNumber;
    this.promptResolver = options.promptResolver;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return await this.promptResolver.resolve("initial_issue", {
      "uv-issue_number": String(this.issueNumber),
      ...this.argsToUvVars(args),
    });
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    return await this.promptResolver.resolve("continuation_issue", {
      "uv-iteration": String(iteration),
      "uv-issue_number": String(this.issueNumber),
      "uv-previous_summary": this.formatSummaries(summaries.slice(-3)),
    });
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `Close Issue #${this.issueNumber}`,
      detailed:
        `Complete the requirements in GitHub Issue #${this.issueNumber} and close it when done. Use the 'gh issue close' command when all tasks are complete.`,
    };
  }

  async isComplete(_summary: IterationSummary): Promise<boolean> {
    try {
      const result = await new Deno.Command("gh", {
        args: ["issue", "view", String(this.issueNumber), "--json", "state"],
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

  getCompletionDescription(_summary: IterationSummary): Promise<string> {
    return Promise.resolve(`Issue #${this.issueNumber} closed successfully`);
  }
}
