/**
 * Composite completion handler - combines multiple completion conditions
 *
 * Supports AND/OR/FIRST operators to compose multiple completion handlers.
 * - AND: All conditions must be met
 * - OR: Any condition being met completes
 * - FIRST: First condition to complete wins
 */

import type { PromptResolverAdapter as PromptResolver } from "../prompts/resolver-adapter.ts";
import type {
  AgentDefinition,
  CompletionConfigUnion,
  CompletionType,
} from "../src_common/types.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type CompletionHandler,
  type IterationSummary,
} from "./types.ts";
import { IterateCompletionHandler } from "./iterate.ts";
import { ManualCompletionHandler } from "./manual.ts";
import { CheckBudgetCompletionHandler } from "./check-budget.ts";
import { StructuredSignalCompletionHandler } from "./structured-signal.ts";
import { IssueCompletionHandler } from "./issue.ts";
import { GitHubStateChecker } from "./external-state-checker.ts";
import { ExternalStateCompletionAdapter } from "./external-state-adapter.ts";
import { AGENT_LIMITS } from "../shared/constants.ts";

export type CompositeOperator = "and" | "or" | "first";

export interface CompositeCondition {
  type: CompletionType;
  config: CompletionConfigUnion;
}

export class CompositeCompletionHandler extends BaseCompletionHandler {
  readonly type = "composite" as const;
  private promptResolver?: PromptResolver;
  private handlers: CompletionHandler[] = [];
  private completedConditionIndex?: number;

  constructor(
    private readonly operator: CompositeOperator,
    private readonly conditions: CompositeCondition[],
    private readonly args: Record<string, unknown>,
    private readonly _agentDir: string,
    private readonly _definition: AgentDefinition,
  ) {
    super();
    this.initializeHandlers();
  }

  /**
   * Initialize sub-handlers for each condition
   */
  private initializeHandlers(): void {
    for (const condition of this.conditions) {
      const config = condition.config;

      let handler: CompletionHandler;

      switch (condition.type) {
        case "iterationBudget": {
          handler = new IterateCompletionHandler(
            config.maxIterations ??
              AGENT_LIMITS.COMPLETION_FALLBACK_MAX_ITERATIONS,
          );
          break;
        }

        case "keywordSignal": {
          handler = new ManualCompletionHandler(
            config.completionKeyword ?? "TASK_COMPLETE",
          );
          break;
        }

        case "checkBudget": {
          handler = new CheckBudgetCompletionHandler(
            config.maxChecks ?? 10,
          );
          break;
        }

        case "structuredSignal": {
          if (!config.signalType) {
            throw new Error(
              "structuredSignal condition requires signalType in config",
            );
          }
          handler = new StructuredSignalCompletionHandler(
            config.signalType,
            config.requiredFields,
          );
          break;
        }

        case "externalState": {
          const issueNumber = this.args.issue as number | undefined;
          if (issueNumber === undefined || issueNumber === null) {
            throw new Error(
              "externalState condition in composite requires --issue parameter",
            );
          }
          const repo = this.args.repository as string | undefined;
          const stateChecker = new GitHubStateChecker(repo);
          const issueHandler = new IssueCompletionHandler(
            { issueNumber, repo },
            stateChecker,
          );
          handler = new ExternalStateCompletionAdapter(issueHandler, {
            issueNumber,
            repo,
            github: this._definition.github as {
              labels?: { completion?: { add?: string[]; remove?: string[] } };
              defaultClosureAction?: string;
            },
          });
          break;
        }

        default:
          throw new Error(
            `Unsupported condition type in composite: ${condition.type}`,
          );
      }

      this.handlers.push(handler);
    }
  }

  /**
   * Set prompt resolver for all sub-handlers
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
    for (const handler of this.handlers) {
      if ("setPromptResolver" in handler) {
        (handler as { setPromptResolver: (r: PromptResolver) => void })
          .setPromptResolver(resolver);
      }
    }
  }

  async buildInitialPrompt(): Promise<string> {
    // Use the first handler's initial prompt as base
    if (this.handlers.length > 0) {
      return await this.handlers[0].buildInitialPrompt();
    }

    if (this.promptResolver) {
      return await this.promptResolver.resolve("initial_composite", {
        "uv-operator": this.operator,
        "uv-conditions_count": String(this.conditions.length),
      });
    }

    // Fallback inline prompt
    const conditionList = this.conditions
      .map((c, i) => `${i + 1}. ${c.type}`)
      .join("\n");

    return `
You are working on a task with composite completion conditions.

## Completion Conditions (${this.operator.toUpperCase()})

${conditionList}

${
      this.operator === "and"
        ? "All conditions must be met for completion."
        : this.operator === "or"
        ? "Any condition being met will complete the task."
        : "First condition to complete wins."
    }

Work on the task and meet the completion criteria.
    `.trim();
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    // Use the first handler's continuation prompt as base
    if (this.handlers.length > 0) {
      return await this.handlers[0].buildContinuationPrompt(
        completedIterations,
        previousSummary,
      );
    }

    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return `
Continue working on the composite task.
Iterations completed: ${completedIterations}

${summarySection}

Work to meet the completion criteria.
    `.trim();
  }

  buildCompletionCriteria(): CompletionCriteria {
    const criteria = this.handlers.map((h) => h.buildCompletionCriteria());
    const shorts = criteria.map((c) => c.short).join(
      this.operator === "and" ? " AND " : " OR ",
    );

    return {
      short: shorts,
      detailed:
        `Composite completion: ${shorts}. Operator: ${this.operator.toUpperCase()}.`,
    };
  }

  async isComplete(): Promise<boolean> {
    const results = await Promise.all(
      this.handlers.map((h) => h.isComplete()),
    );

    switch (this.operator) {
      case "and":
        return results.every((r) => r);

      case "or":
      case "first": {
        const index = results.findIndex((r) => r);
        if (index >= 0) {
          this.completedConditionIndex = index;
          return true;
        }
        return false;
      }
    }
  }

  async getCompletionDescription(): Promise<string> {
    const complete = await this.isComplete();

    if (!complete) {
      const descriptions = await Promise.all(
        this.handlers.map((h) => h.getCompletionDescription()),
      );
      return `Composite (${this.operator}): ${descriptions.join(", ")}`;
    }

    if (this.completedConditionIndex !== undefined) {
      const completedHandler = this.handlers[this.completedConditionIndex];
      const desc = await completedHandler.getCompletionDescription();
      return `Composite completed by condition ${
        this.completedConditionIndex + 1
      }: ${desc}`;
    }

    return `Composite (${this.operator}) - All conditions met`;
  }
}
