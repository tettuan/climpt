/**
 * Query Executor - executes Claude SDK queries and processes responses.
 *
 * Handles:
 * - Building and executing SDK query options
 * - Processing SDK messages (assistant, tool use, result, error)
 * - Content extraction from messages
 * - Rate limit handling
 * - Tool policy hooks (PreToolUse boundary bash blocking)
 *
 * Extracted from runner.ts for separation of concerns.
 */

import type {
  AgentDefinition,
  IterationSummary,
  RuntimeContext,
} from "../src_common/types.ts";
import { isRecord, isString } from "../src_common/type-guards.ts";
import { AgentQueryError, AgentRateLimitError } from "./errors.ts";
import { calculateBackoff, isRateLimitError } from "./error-classifier.ts";
import { mergeSandboxConfig, toSdkSandboxConfig } from "./sandbox-defaults.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type {
  PromptStepDefinition,
  StepKind,
} from "../common/step-registry.ts";
import { inferStepKind } from "../common/step-registry.ts";
import {
  filterAllowedTools,
  getToolPolicy,
  isBashCommandAllowed,
} from "../common/tool-policy.ts";
import {
  isAssistantMessage,
  isErrorMessage,
  isResultMessage,
  isToolUseMessage,
} from "./message-types.ts";
import type { VerboseLogger } from "./verbose-logger.ts";
import { AGENT_LIMITS, TRUNCATION } from "../shared/constants.ts";
import type { SchemaManager } from "./schema-manager.ts";

export interface QueryExecutorDeps {
  readonly definition: AgentDefinition;
  getContext(): RuntimeContext;
  getStepsRegistry(): ExtendedStepsRegistry | null;
  getVerboseLogger(): VerboseLogger | null;
  getSchemaManager(): SchemaManager;
}

export class QueryExecutor {
  private readonly deps: QueryExecutorDeps;

  // Rate limit handling
  private rateLimitRetryCount = 0;
  private static readonly MAX_RATE_LIMIT_RETRIES =
    AGENT_LIMITS.MAX_RATE_LIMIT_RETRIES;

  constructor(deps: QueryExecutorDeps) {
    this.deps = deps;
  }

  /**
   * Execute a Claude SDK query and return an IterationSummary.
   */
  async executeQuery(options: {
    prompt: string;
    systemPrompt: string | {
      type: "preset";
      preset: "claude_code";
      append?: string;
    };
    plugins: string[];
    sessionId?: string;
    iteration: number;
    stepId?: string;
  }): Promise<IterationSummary> {
    const { prompt, systemPrompt, plugins, sessionId, iteration, stepId } =
      options;
    const ctx = this.deps.getContext();

    const summary: IterationSummary = {
      iteration,
      sessionId: undefined,
      assistantResponses: [],
      toolsUsed: [],
      errors: [],
    };

    try {
      // Dynamic import of Claude Code SDK
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      // Apply stepKind-based tool gating if we have step info
      let allowedTools = this.deps.definition.runner.boundaries.allowedTools;
      let currentStepKind: StepKind | undefined;
      const stepsRegistry = this.deps.getStepsRegistry();

      if (stepId && stepsRegistry) {
        const stepDef = stepsRegistry.steps[stepId] as
          | PromptStepDefinition
          | undefined;
        if (stepDef) {
          currentStepKind = inferStepKind(stepDef);
          if (currentStepKind) {
            allowedTools = filterAllowedTools(allowedTools, currentStepKind);
            ctx.logger.info(
              `[ToolPolicy] Step "${stepId}" (${currentStepKind}): tools filtered to ${allowedTools.length} allowed`,
            );
          }
        }
      }

      const queryOptions: Record<string, unknown> = {
        cwd: ctx.cwd,
        systemPrompt,
        allowedTools,
        permissionMode: this.deps.definition.runner.boundaries.permissionMode,
        settingSources: ["user", "project"],
        plugins,
        resume: sessionId,
        // Auto-respond to AskUserQuestion to enable autonomous execution
        canUseTool: (
          toolName: string,
          input: Record<string, unknown>,
        ) => {
          if (toolName === "AskUserQuestion") {
            const autoResponse =
              this.deps.definition.runner.boundaries.askUserAutoResponse ??
                "Use your best judgment to choose the optimal approach. No need to confirm again.";
            const questions = input.questions as Array<{
              question: string;
              options: Array<{ label: string }>;
            }>;
            const answers: Record<string, string> = {};
            for (const q of questions) {
              answers[q.question] = autoResponse;
            }
            ctx.logger.info(
              "[AskUserQuestion] Auto-responding with delegation",
              { questionCount: questions.length, response: autoResponse },
            );
            return {
              behavior: "allow",
              updatedInput: { questions: input.questions, answers },
            };
          }
          // Allow other tools
          return { behavior: "allow", updatedInput: input };
        },
      };

      // Configure sandbox
      const sandboxConfig = mergeSandboxConfig(
        this.deps.definition.runner.boundaries.sandbox,
      );
      if (sandboxConfig.enabled === false) {
        queryOptions.dangerouslySkipPermissions = true;
      } else {
        queryOptions.sandbox = toSdkSandboxConfig(sandboxConfig);
      }

      // Configure structured output if step has outputSchemaRef
      const schemaManager = this.deps.getSchemaManager();
      if (stepId) {
        const schema = await schemaManager.loadSchemaForStep(
          stepId,
          iteration,
          ctx.logger,
        );

        // R2: If schema resolution failed, abort iteration immediately
        if (schemaManager.schemaResolutionFailed) {
          ctx.logger.warn(
            `[StructuredOutput] Aborting iteration: schema resolution failed for step "${stepId}"`,
          );
          summary.errors.push(
            `Schema resolution failed for step "${stepId}". Iteration aborted.`,
          );
          summary.schemaResolutionFailed = true;
          return summary;
        }

        if (schema) {
          queryOptions.outputFormat = {
            type: "json_schema",
            schema,
          };
          ctx.logger.info(
            `[StructuredOutput] Using schema for step: ${stepId}`,
          );
        }
      }

      // Configure PreToolUse hooks for boundary bash blocking
      if (currentStepKind && getToolPolicy(currentStepKind).blockBoundaryBash) {
        const boundaryBashBlockingHook = this.createBoundaryBashBlockingHook(
          currentStepKind,
          ctx,
        );
        queryOptions.hooks = {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [boundaryBashBlockingHook],
            },
          ],
        };
        ctx.logger.info(
          `[ToolPolicy] PreToolUse hooks enabled for boundary bash blocking (stepKind: ${currentStepKind})`,
        );
      }

      // Verbose: Log full SDK request options
      const verboseLogger = this.deps.getVerboseLogger();
      if (verboseLogger) {
        await verboseLogger.logSdkRequest({
          ...queryOptions,
          canUseTool: "[Function]",
        });
      }

      const queryIterator = query({
        prompt,
        options: queryOptions,
      });

      for await (const message of queryIterator) {
        ctx.logger.logSdkMessage(message);

        // Verbose: Log raw SDK message
        if (verboseLogger) {
          await verboseLogger.logSdkMessage(message);
        }

        this.processMessage(message, summary);
      }

      // Detect missing structuredOutput when outputFormat was configured
      if (queryOptions.outputFormat && !summary.structuredOutput) {
        ctx.logger.warn(
          `[StructuredOutput] outputFormat was set but no structured_output received from SDK. ` +
            `The LLM may have returned natural language instead of JSON. ` +
            `Step: ${stepId ?? "unknown"}`,
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);

      // Check for rate limit error
      if (isRateLimitError(errorMessage)) {
        this.rateLimitRetryCount++;

        if (this.rateLimitRetryCount >= QueryExecutor.MAX_RATE_LIMIT_RETRIES) {
          const rateLimitError = new AgentRateLimitError(
            `Rate limit exceeded after ${this.rateLimitRetryCount} retries`,
            {
              attempts: this.rateLimitRetryCount,
              cause: error instanceof Error ? error : undefined,
              iteration,
            },
          );
          summary.errors.push(rateLimitError.message);
          ctx.logger.error("Rate limit retries exhausted", {
            error: rateLimitError.message,
            attempts: this.rateLimitRetryCount,
          });
          throw rateLimitError;
        }

        const waitTime = calculateBackoff(this.rateLimitRetryCount - 1);
        ctx.logger.warn(
          `Rate limit hit, waiting ${waitTime}ms before retry ` +
            `(attempt ${this.rateLimitRetryCount}/${QueryExecutor.MAX_RATE_LIMIT_RETRIES})`,
        );

        summary.errors.push(`Rate limit hit, will retry after ${waitTime}ms`);
        summary.rateLimitRetry = {
          waitMs: waitTime,
          attempt: this.rateLimitRetryCount,
        };
      } else {
        // Non-rate-limit error: reset counter
        this.rateLimitRetryCount = 0;

        const queryError = new AgentQueryError(errorMessage, {
          cause: error instanceof Error ? error : undefined,
          iteration,
        });
        summary.errors.push(queryError.message);
        ctx.logger.error("Query execution failed", {
          error: queryError.message,
          code: queryError.code,
          iteration: queryError.iteration,
        });
      }
    }

    return summary;
  }

  private processMessage(message: unknown, summary: IterationSummary): void {
    const ctx = this.deps.getContext();

    if (isAssistantMessage(message)) {
      const content = this.extractContent(message.message);
      if (content) {
        summary.assistantResponses.push(content);
      }
    } else if (isToolUseMessage(message)) {
      summary.toolsUsed.push(message.tool_name);
    } else if (isResultMessage(message)) {
      summary.sessionId = message.session_id;
      if (message.structured_output) {
        summary.structuredOutput = message.structured_output;
        ctx.logger.info("[StructuredOutput] Got structured output from result");
      }
      if (message.total_cost_usd !== undefined) {
        summary.totalCostUsd = message.total_cost_usd;
      }
      if (message.num_turns !== undefined) {
        summary.numTurns = message.num_turns;
      }
      if (message.duration_ms !== undefined) {
        summary.durationMs = message.duration_ms;
      }
    } else if (isErrorMessage(message)) {
      summary.errors.push(message.error.message ?? "Unknown error");
    }
  }

  private extractContent(message: unknown): string {
    if (isString(message)) {
      return message;
    }
    if (isRecord(message)) {
      if (isString(message.content)) {
        return message.content;
      }
      if (Array.isArray(message.content)) {
        return message.content
          .filter((c): c is Record<string, unknown> =>
            isRecord(c) && c.type === "text"
          )
          .map((c) => isString(c.text) ? c.text : "")
          .join("\n");
      }
    }
    return "";
  }

  /**
   * Create a PreToolUse hook callback that blocks boundary bash commands.
   */
  private createBoundaryBashBlockingHook(
    stepKind: StepKind,
    ctx: RuntimeContext,
  ): (
    input: { tool_name: string; tool_input: Record<string, unknown> },
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<Record<string, unknown>> {
    return (input, _toolUseId, _options) => {
      // Only check Bash commands
      if (input.tool_name !== "Bash") {
        return Promise.resolve({});
      }

      const command = input.tool_input.command as string | undefined;
      if (!command) {
        return Promise.resolve({});
      }

      // Check if command is allowed for this step kind
      const result = isBashCommandAllowed(command, stepKind);

      if (!result.allowed) {
        ctx.logger.warn(
          `[ToolPolicy] Boundary bash command blocked in ${stepKind} step`,
          {
            command: command.substring(0, TRUNCATION.BASH_COMMAND),
            reason: result.reason,
          },
        );

        return Promise.resolve({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: result.reason,
          },
        });
      }

      return Promise.resolve({});
    };
  }
}
