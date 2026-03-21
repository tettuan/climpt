/**
 * Composite completion handler - combines multiple completion conditions
 *
 * Supports AND/OR/FIRST operators to compose multiple completion handlers.
 * - AND: All conditions must be met
 * - OR: Any condition being met completes
 * - FIRST: First condition to complete wins
 */

import type { PromptResolver } from "../common/prompt-resolver.ts";
import type {
  AgentDefinition,
  VerdictConfigUnion,
  VerdictType,
} from "../src_common/types.ts";
import {
  BaseVerdictHandler,
  type IterationSummary,
  type VerdictCriteria,
  type VerdictHandler,
  type VerdictStepIds,
} from "./types.ts";
import { IterationBudgetVerdictHandler } from "./iteration-budget.ts";
import { KeywordSignalVerdictHandler } from "./keyword-signal.ts";
import { CheckBudgetVerdictHandler } from "./check-budget.ts";
import { StructuredSignalVerdictHandler } from "./structured-signal.ts";
import { IssueVerdictHandler } from "./issue.ts";
import { GitHubStateChecker } from "./external-state-checker.ts";
import { ExternalStateVerdictAdapter } from "./external-state-adapter.ts";
import { AGENT_LIMITS } from "../shared/constants.ts";
import {
  acVerdict008DetectStructuredConditionRequiresSignalType,
  acVerdict009PollStateConditionRequiresIssue,
  acVerdict010UnsupportedConditionTypeInComposite,
} from "../shared/errors/config-errors.ts";

export type CompositeOperator = "and" | "or" | "first";

export interface CompositeCondition {
  type: VerdictType;
  config: VerdictConfigUnion;
}

export class CompositeVerdictHandler extends BaseVerdictHandler {
  readonly type = "meta:composite" as const;
  private promptResolver?: PromptResolver;
  private uvVariables: Record<string, string> = {};
  private handlers: VerdictHandler[] = [];
  private completedConditionIndex?: number;

  constructor(
    private readonly operator: CompositeOperator,
    private readonly conditions: CompositeCondition[],
    private readonly args: Record<string, unknown>,
    private readonly _agentDir: string,
    private readonly _definition: AgentDefinition,
    private readonly stepIds?: VerdictStepIds,
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

      let handler: VerdictHandler;

      switch (condition.type) {
        case "count:iteration": {
          handler = new IterationBudgetVerdictHandler(
            config.maxIterations ??
              AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS,
            this.stepIds,
          );
          break;
        }

        case "detect:keyword": {
          handler = new KeywordSignalVerdictHandler(
            config.verdictKeyword ?? "TASK_COMPLETE",
            this.stepIds,
          );
          break;
        }

        case "count:check": {
          handler = new CheckBudgetVerdictHandler(
            config.maxChecks ?? 10,
            this.stepIds,
          );
          break;
        }

        case "detect:structured": {
          if (!config.signalType) {
            throw acVerdict008DetectStructuredConditionRequiresSignalType();
          }
          handler = new StructuredSignalVerdictHandler(
            config.signalType,
            config.requiredFields,
            this.stepIds,
          );
          break;
        }

        case "poll:state": {
          const issueNumber = this.args.issue as number | undefined;
          if (issueNumber === undefined || issueNumber === null) {
            throw acVerdict009PollStateConditionRequiresIssue();
          }
          const repo = this.args.repository as string | undefined;
          const stateChecker = new GitHubStateChecker(repo);
          const issueHandler = new IssueVerdictHandler(
            { issueNumber, repo },
            stateChecker,
          );
          handler = new ExternalStateVerdictAdapter(issueHandler, {
            issueNumber,
            repo,
            github: this._definition.runner.integrations?.github as {
              labels?: { completion?: { add?: string[]; remove?: string[] } };
              defaultClosureAction?: string;
            },
          }, this.stepIds);
          break;
        }

        default:
          throw acVerdict010UnsupportedConditionTypeInComposite(condition.type);
      }

      this.handlers.push(handler);
    }
  }

  /**
   * Supply base UV variables (CLI args + runtime) for prompt resolution.
   * Forwards to all sub-handlers.
   */
  setUvVariables(uv: Record<string, string>): void {
    this.uvVariables = uv;
    for (const handler of this.handlers) {
      handler.setUvVariables?.(uv);
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
      return (await this.promptResolver.resolve("initial.composite", {
        uv: {
          ...this.uvVariables,
          operator: this.operator,
          conditions_count: String(this.conditions.length),
        },
      })).content;
    }

    // Fallback inline prompt
    const conditionList = this.conditions
      .map((c, i) => `${i + 1}. ${c.type}`)
      .join("\n");

    return `
You are working on a task with composite completion conditions.

## Verdict Conditions (${this.operator.toUpperCase()})

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

  buildVerdictCriteria(): VerdictCriteria {
    const criteria = this.handlers.map((h) => h.buildVerdictCriteria());
    const shorts = criteria.map((c) => c.short).join(
      this.operator === "and" ? " AND " : " OR ",
    );

    return {
      short: shorts,
      detailed:
        `Composite completion: ${shorts}. Operator: ${this.operator.toUpperCase()}.`,
    };
  }

  async isFinished(): Promise<boolean> {
    const results = await Promise.all(
      this.handlers.map((h) => h.isFinished()),
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

  async getVerdictDescription(): Promise<string> {
    const complete = await this.isFinished();

    if (!complete) {
      const descriptions = await Promise.all(
        this.handlers.map((h) => h.getVerdictDescription()),
      );
      return `Composite (${this.operator}): ${descriptions.join(", ")}`;
    }

    if (this.completedConditionIndex !== undefined) {
      const completedHandler = this.handlers[this.completedConditionIndex];
      const desc = await completedHandler.getVerdictDescription();
      return `Composite completed by condition ${
        this.completedConditionIndex + 1
      }: ${desc}`;
    }

    return `Composite (${this.operator}) - All conditions met`;
  }
}
