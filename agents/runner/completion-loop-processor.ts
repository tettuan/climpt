/**
 * Completion Loop Processor - extracted from runner.ts for dual-loop separation.
 *
 * Handles:
 * - runClosureLoop(): Single-shot closure procedure (validation, structured signal, verdict)
 * - runClosureIteration(): Full lifecycle of a closure step (prompt, query, verdict)
 * - isClosureStep(): Determines if a step is a closure step
 *
 * All three methods were previously private on AgentRunner. Now they are
 * public on this processor and delegated from the runner via composition.
 */

import type {
  IterationSummary,
  ResolvedAgentDefinition,
  RuntimeContext,
} from "../src_common/types.ts";
import { AgentStepRoutingError, AgentValidationAbortError } from "./errors.ts";
import { STEP_PHASE } from "../shared/step-phases.ts";

import { inferStepKind } from "../common/step-registry/utils.ts";
import type { PromptStepDefinition } from "../common/step-registry/types.ts";
import { isRecord } from "../src_common/type-guards.ts";

// Extracted module types
import type { QueryExecutor } from "./query-executor.ts";
import type { FlowOrchestrator } from "./flow-orchestrator.ts";
import type { SchemaManager } from "./schema-manager.ts";
import type { ClosureManager } from "./closure-manager.ts";
import type { BoundaryHooks } from "./boundary-hooks.ts";
import type { ClosureAdapter } from "./closure-adapter.ts";
import type { AgentEventEmitter } from "./events.ts";
import type { VerboseLogger } from "./verbose-logger.ts";

export interface CompletionLoopDeps {
  readonly closureManager: ClosureManager;
  readonly boundaryHooks: BoundaryHooks;
  readonly closureAdapter: ClosureAdapter;
  readonly queryExecutor: QueryExecutor;
  readonly flowOrchestrator: FlowOrchestrator;
  readonly schemaManager: SchemaManager;
  readonly eventEmitter: AgentEventEmitter;
  readonly definition: ResolvedAgentDefinition;
  readonly args: Record<string, unknown>;
  readonly agentDir: string;
  readonly verboseLogger: VerboseLogger | null;
  readonly pendingRetryPrompt: {
    get(): string | null;
    set(value: string | null): void;
  };
  resolveSystemPromptForIteration(ctx: RuntimeContext): Promise<{
    type: "preset";
    preset: "claude_code";
    append: string;
  }>;
  buildUvVariables(iteration: number): Record<string, string>;
}

export class CompletionLoopProcessor {
  private readonly deps: CompletionLoopDeps;

  constructor(deps: CompletionLoopDeps) {
    this.deps = deps;
  }

  /**
   * Completion Loop - single-shot closure procedure.
   *
   * Encapsulates the four phases of completion:
   * Phase 1: Pre-flight State Validation (external conditions check via StepValidator)
   *          — runs in runClosureIteration BEFORE the LLM closure call.
   *          If fail → retry without calling LLM.
   * Phase 2: Closure Prompt (handled externally via closureAdapter)
   * Phase 3: Format Validation (structured output check via FormatValidator)
   *          — runs AFTER the LLM closure call against outputSchema.
   *          If fail → format retry prompt.
   * Phase 4: Verdict (handler decision + boundary hooks)
   *
   * Called when a completion signal is detected (closing intent,
   * AI verdict declaration, or legacy handler check).
   */
  public async runClosureLoop(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
    closingReason?: string,
  ): Promise<{ done: boolean; reason: string; retryPrompt?: string }> {
    ctx.logger.info("[CompletionLoop] Enter", { stepId });

    // Stage 2: Validation
    const closureStepId = this.deps.closureManager.getClosureStepId();
    const validation = await this.deps.closureManager.validateConditions(
      closureStepId,
      summary,
      ctx.logger,
    );

    ctx.logger.info("[CompletionLoop] Validation result", {
      valid: validation.valid,
      stepId: closureStepId,
    });

    if (!validation.valid) {
      const action = validation.action ?? "retry";

      // Dispatch based on onFailure action
      if (action === "abort") {
        ctx.logger.error(
          "[CompletionLoop] Validation abort: unrecoverable or maxAttempts exceeded",
        );
        throw new AgentValidationAbortError(
          `Validation aborted for step "${closureStepId}": ${
            validation.retryPrompt ?? "validation failed"
          }`,
          { stepId: closureStepId },
        );
      }

      if (action === "skip") {
        ctx.logger.warn(
          "[CompletionLoop] Validation skip: treating as passed per onFailure config",
        );
        // Fall through to Stage 2.5 / Stage 3 as if validation passed
      } else {
        // action === "retry" (default)
        ctx.logger.info(
          "Validation conditions not met, will retry in next iteration",
        );
        ctx.logger.info("[CompletionLoop] Exit", { stepId, done: false });
        return {
          done: false,
          reason: "Validation conditions not met",
          retryPrompt: validation.retryPrompt ?? undefined,
        };
      }
    }

    // Stage 2.5: Structured signal from closure step output
    // Guard: only closure steps may emit closing/repeat signals.
    // Non-closure steps with closing intent are a routing error.
    ctx.logger.info("[CompletionLoop] Structured output extraction", {
      hasStructuredOutput: !!summary.structuredOutput,
    });

    if (!closingReason && summary.structuredOutput) {
      const so = summary.structuredOutput;
      const nextAction = so.next_action;
      if (isRecord(nextAction)) {
        const action = (nextAction as Record<string, unknown>).action;
        if (action === "closing" || action === "repeat") {
          const stepDef = this.deps.closureManager.stepsRegistry
            ?.steps[stepId] as PromptStepDefinition | undefined;
          const stepKind = stepDef ? inferStepKind(stepDef) : undefined;

          if (stepKind !== "closure") {
            throw new AgentStepRoutingError(
              `Non-closure step "${stepId}" (kind: ${stepKind ?? "unknown"}) ` +
                `emitted closing signal "${action}". ` +
                `Only closure steps may emit closing/repeat signals.`,
              { stepId },
            );
          }

          if (action === "closing") {
            ctx.logger.info(
              `[CompletionLoop] Closure step structured signal: closing`,
            );
            await this.deps.boundaryHooks.invokeBoundaryHook(
              stepId,
              summary,
              ctx,
            );
            ctx.logger.info("[CompletionLoop] Exit", { stepId, done: true });
            return {
              done: true,
              reason: "Closure step emitted closing signal",
            };
          }
          // action === "repeat"
          ctx.logger.info(
            `[CompletionLoop] Closure step structured signal: repeat`,
          );
          ctx.logger.info("[CompletionLoop] Exit", { stepId, done: false });
          return { done: false, reason: "Closure step requested repeat" };
        } else if (action) {
          ctx.logger.debug(
            "[CompletionLoop] Structured signal action ignored",
            {
              action,
            },
          );
        }
      }
    }

    // Stage 3: Verdict
    if (closingReason) {
      // Router signaled closing - definitive
      ctx.logger.info(
        `[CompletionLoop] Router signaled closing: ${closingReason}`,
      );
      await this.deps.boundaryHooks.invokeBoundaryHook(stepId, summary, ctx);
      ctx.logger.info("[CompletionLoop] Exit", { stepId, done: true });
      return { done: true, reason: closingReason };
    }

    // Handler-based verdict
    if (ctx.verdictHandler.setCurrentSummary) {
      ctx.verdictHandler.setCurrentSummary(summary);
    }
    const isFinished = await ctx.verdictHandler.isFinished();
    const reason = await ctx.verdictHandler.getVerdictDescription();

    if (isFinished) {
      ctx.logger.info(`[CompletionLoop] Handler verdict: ${reason}`);
      await this.deps.boundaryHooks.invokeBoundaryHook(stepId, summary, ctx);
      ctx.logger.info("[CompletionLoop] Exit", { stepId, done: true });
      return { done: true, reason };
    }

    ctx.logger.info("[CompletionLoop] Exit", { stepId, done: false });
    return { done: false, reason };
  }

  /**
   * Completion Loop iteration - handles the ENTIRE lifecycle of a closure step.
   *
   * Encapsulates: prompt resolution, LLM query, post-query processing, and verdict.
   * This is a "単発の手続き" (single-shot procedure) per design.
   *
   * Prompt priority:
   * 1. pendingRetryPrompt (from previous validation failure)
   * 2. closureAdapter.tryClosureAdaptation() (C3L closure prompt)
   * 3. handler.buildContinuationPrompt() (Completion Loop fallback)
   */
  public async runClosureIteration(
    stepId: string,
    iteration: number,
    summaries: IterationSummary[],
    ctx: RuntimeContext,
    plugins: string[] = [],
  ): Promise<{
    done: boolean;
    reason: string;
    retryPrompt?: string;
    summary: IterationSummary;
    isRateLimitRetry?: boolean;
  }> {
    ctx.logger.info("[CompletionLoop] Iteration enter", { stepId, iteration });

    // Propagate iteration to verdict handler (same rationale as Flow Loop entry
    // in runner.ts: count:iteration handlers rely on this for isFinished()).
    ctx.verdictHandler.setCurrentIteration?.(iteration);

    const lastSummary = summaries.length > 0
      ? summaries[summaries.length - 1]
      : undefined;

    // Step 1: Prompt resolution
    let prompt: string;
    let promptSource: "user";
    let promptType:
      | "retry"
      | typeof STEP_PHASE.INITIAL
      | typeof STEP_PHASE.CONTINUATION;
    const promptStartTime = performance.now();

    const pendingRetry = this.deps.pendingRetryPrompt.get();
    if (pendingRetry) {
      prompt = pendingRetry;
      promptSource = "user";
      promptType = "retry";
      this.deps.pendingRetryPrompt.set(null);
      ctx.logger.debug(
        "[CompletionLoop] Using retry prompt from validation",
      );
    } else {
      // Try C3L closure prompt via closureAdapter
      const closurePrompt = await this.deps.closureAdapter
        .tryClosureAdaptation(
          stepId,
          ctx,
          this.deps.buildUvVariables(iteration),
        );
      if (closurePrompt) {
        prompt = closurePrompt.content;
        promptSource = closurePrompt.source;
        ctx.logger.info(
          `[CompletionLoop] Closure prompt resolved for "${stepId}"`,
          { source: closurePrompt.source },
        );
      } else {
        // Fallback: handler continuation prompt (design: "Completion Loop用プロンプトの生成")
        ctx.verdictHandler.setUvVariables?.(
          this.deps.buildUvVariables(iteration),
        );
        prompt = await ctx.verdictHandler.buildContinuationPrompt(
          iteration - 1,
          lastSummary,
        );
        promptSource = "user";
      }
      promptType = STEP_PHASE.CONTINUATION;
    }

    const promptTimeMs = performance.now() - promptStartTime;

    // Step 2: Prompt logging
    if (ctx.promptLogger) {
      await ctx.promptLogger.logResolution(
        {
          stepId,
          source: promptSource,
          content: prompt,
          promptPath:
            `${this.deps.definition.runner.verdict.type}/${promptType}`,
        },
        promptTimeMs,
      );
    }

    // Step 3: System prompt
    const systemPrompt = await this.deps.resolveSystemPromptForIteration(ctx);

    ctx.logger.info("[SystemPrompt] Using preset configuration", {
      type: systemPrompt.type,
      preset: systemPrompt.preset,
      appendLength: systemPrompt.append.length,
    });

    // Step 4: Events
    await this.deps.eventEmitter.emit("promptBuilt", {
      prompt,
      systemPrompt: systemPrompt.append,
    });

    // Verbose: Log prompt and system prompt
    if (this.deps.verboseLogger) {
      await this.deps.verboseLogger.logPrompt(prompt);
      await this.deps.verboseLogger.logSystemPrompt(systemPrompt);
    }

    // Step 4.5: Pre-flight state validation (Phase 1)
    // Validate state conditions BEFORE the LLM call.
    // Format validation (Phase 2) runs post-LLM in runClosureLoop.
    const closureStepId = this.deps.closureManager.getClosureStepId();
    const preFlightResult = await this.deps.closureManager
      .validateStateConditions(
        closureStepId,
        ctx.logger,
      );
    if (!preFlightResult.valid) {
      ctx.logger.info("[CompletionLoop] Pre-flight state validation failed", {
        stepId: closureStepId,
      });
      return {
        done: false,
        reason: preFlightResult.retryPrompt ?? "State validation failed",
        retryPrompt: preFlightResult.retryPrompt,
        summary: summaries[summaries.length - 1] ?? {
          iteration,
          assistantResponses: [],
          toolsUsed: [],
          errors: [],
        },
        isRateLimitRetry: false,
      };
    }

    // Step 5: LLM query
    const summary = await this.deps.queryExecutor.executeQuery({
      prompt,
      systemPrompt,
      plugins,
      sessionId: lastSummary?.sessionId,
      iteration,
      stepId,
    });

    // Step 6: Event
    await this.deps.eventEmitter.emit("queryExecuted", { summary });

    // Step 7: Post-query processing
    summaries.push(summary);

    // Sync schema resolution state to flow orchestrator
    this.deps.flowOrchestrator.setSchemaResolutionFailed(
      this.deps.schemaManager.schemaResolutionFailed,
    );

    // Normalize stepId in structured output
    this.deps.flowOrchestrator.normalizeStructuredOutputStepId(
      stepId,
      summary,
      ctx,
    );

    // Record step output
    this.deps.flowOrchestrator.recordStepOutput(stepId, summary, ctx);

    // Step 8: Rate limit check
    if (summary.rateLimitRetry) {
      const { waitMs, attempt } = summary.rateLimitRetry;
      ctx.logger.info(
        `Waiting ${waitMs}ms for rate limit retry (attempt ${attempt})`,
      );
      await this.delay(waitMs);
      ctx.logger.info("[CompletionLoop] Iteration exit", {
        stepId,
        iteration,
        isRateLimitRetry: true,
      });
      return {
        done: false,
        reason: "rate_limit_retry",
        summary,
        isRateLimitRetry: true,
      };
    }

    // Step 9: Verdict (Stages 2+3 via runClosureLoop)
    const verdict = await this.runClosureLoop(stepId, summary, ctx);
    ctx.logger.info("[CompletionLoop] Iteration exit", {
      stepId,
      iteration,
      done: verdict.done,
    });
    return {
      done: verdict.done,
      reason: verdict.reason,
      retryPrompt: verdict.retryPrompt,
      summary,
    };
  }

  /**
   * Check if a step is a closure step (stepKind: "closure").
   * Closure steps are processed by the Completion Loop, not the Flow Loop.
   */
  public isClosureStep(stepId: string): boolean {
    const registry = this.deps.closureManager.stepsRegistry;
    if (!registry?.steps) return false;
    const stepDef = registry.steps[stepId] as
      | PromptStepDefinition
      | undefined;
    if (!stepDef) return false;
    return inferStepKind(stepDef) === "closure";
  }

  /**
   * Delay execution for a specified duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
