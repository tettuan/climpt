/**
 * Agent Runner - main execution engine (slim coordinator)
 *
 * Dual-loop architecture:
 * - Flow Loop: Step advancement, handoff management, intent routing
 *   (processes work and verification steps only)
 * - Completion Loop: Closure prompt, validation, and verdict
 *   (processes closure steps with independent LLM call)
 *
 * Closure steps are detected by isClosureStep() and processed as
 * Completion Loop iterations: they use closureAdapter for prompts,
 * skip step routing, and always go through runClosureLoop().
 *
 * Supports dependency injection for testability.
 * Use AgentRunnerBuilder for convenient construction with custom dependencies.
 *
 * Responsibilities are delegated to extracted modules:
 * - QueryExecutor: SDK query execution, message processing, rate limiting
 * - FlowOrchestrator: Step routing, transitions, stepId normalization
 * - SchemaManager: Schema loading, fail-fast tracking, flow validation
 * - ClosureManager: Closure initialization, validation, AI declaration detection
 * - BoundaryHooks: Closure step boundary hook invocation
 * - ClosureAdapter: Closure step prompt adaptation
 */

import type {
  AgentResult,
  IterationSummary,
  ResolvedAgentDefinition,
  RuntimeContext,
} from "../src_common/types.ts";
import {
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentStepRoutingError,
  isAgentError,
  normalizeToAgentError,
} from "./errors.ts";
import { getAgentDir } from "./loader.ts";
import type { AgentDependencies } from "./builder.ts";
import { createDefaultDependencies } from "./builder.ts";
import {
  type AgentEvent,
  AgentEventEmitter,
  type AgentEventHandler,
} from "./events.ts";
import type { StepContext } from "../src_common/contracts.ts";
import { createVerboseLogger, type VerboseLogger } from "./verbose-logger.ts";
import { PromptLogger } from "../common/prompt-logger.ts";
import { AGENT_LIMITS } from "../shared/constants.ts";
import { STEP_PHASE } from "../shared/step-phases.ts";
import { resolveSystemPrompt } from "../prompts/system-prompt.ts";

// Extracted modules
import { QueryExecutor } from "./query-executor.ts";
import { FlowOrchestrator } from "./flow-orchestrator.ts";
import { SchemaManager } from "./schema-manager.ts";
import { ClosureManager } from "./closure-manager.ts";
import { BoundaryHooks } from "./boundary-hooks.ts";
import { ClosureAdapter } from "./closure-adapter.ts";
import { CompletionLoopProcessor } from "./completion-loop-processor.ts";
import { prC3lNoPrompt } from "../shared/errors/config-errors.ts";
import { formatIterationSummary } from "../verdict/types.ts";

export interface RunnerOptions {
  /** Working directory */
  cwd?: string;
  /** CLI arguments passed to the agent */
  args: Record<string, unknown>;
  /** Additional plugins to load */
  plugins?: string[];
  /** Enable verbose logging of SDK I/O */
  verbose?: boolean;
}

// Re-export for backward compatibility
export type { ValidationResult } from "./validation-chain.ts";

export class AgentRunner {
  private readonly definition: ResolvedAgentDefinition;
  private readonly dependencies: AgentDependencies;
  private readonly eventEmitter: AgentEventEmitter;
  private context: RuntimeContext | null = null;
  private args: Record<string, unknown> = {};
  private agentDir = "";

  // Extracted module instances
  private readonly closureManager: ClosureManager;
  private readonly schemaManager: SchemaManager;
  private readonly flowOrchestrator: FlowOrchestrator;
  private readonly queryExecutor: QueryExecutor;
  private readonly boundaryHooks: BoundaryHooks;
  private readonly closureAdapter: ClosureAdapter;
  private completionLoopProcessor!: CompletionLoopProcessor;

  // Verdict validation
  private pendingRetryPrompt: string | null = null;

  // Verbose logging for SDK I/O debugging
  private verboseLogger: VerboseLogger | null = null;

  /**
   * Create an AgentRunner with optional dependency injection.
   */
  constructor(
    definition: ResolvedAgentDefinition,
    dependencies?: AgentDependencies,
  ) {
    this.definition = definition;
    this.dependencies = dependencies ?? createDefaultDependencies();
    this.eventEmitter = new AgentEventEmitter();

    // Initialize extracted modules with dependency bridges
    this.closureManager = new ClosureManager({
      definition: this.definition,
      dependencies: this.dependencies,
    });

    this.schemaManager = new SchemaManager({
      definition: this.definition,
      getContext: () => this.getContext(),
      getStepsRegistry: () => this.closureManager.stepsRegistry,
    });

    this.flowOrchestrator = new FlowOrchestrator({
      definition: this.definition,
      args: this.args,
      getStepsRegistry: () => this.closureManager.stepsRegistry,
      getStepGateInterpreter: () => this.closureManager.stepGateInterpreter,
      getWorkflowRouter: () => this.closureManager.workflowRouter,
      hasFlowRoutingEnabled: () => this.closureManager.hasFlowRoutingEnabled(),
    });

    this.queryExecutor = new QueryExecutor({
      definition: this.definition,
      getContext: () => this.getContext(),
      getStepsRegistry: () => this.closureManager.stepsRegistry,
      getVerboseLogger: () => this.verboseLogger,
      getSchemaManager: () => this.schemaManager,
    });

    this.boundaryHooks = new BoundaryHooks({
      getStepsRegistry: () => this.closureManager.stepsRegistry,
      getEventEmitter: () => this.eventEmitter,
    });

    this.closureAdapter = new ClosureAdapter({
      definition: this.definition,
      args: this.args,
      getStepPromptResolver: () => this.closureManager.stepPromptResolver,
      getStepsRegistry: () => this.closureManager.stepsRegistry,
    });
  }

  /**
   * Subscribe to agent lifecycle events.
   */
  on<E extends AgentEvent>(
    event: E,
    handler: AgentEventHandler<E>,
  ): () => void {
    return this.eventEmitter.on(event, handler);
  }

  /**
   * Get runtime context, throwing if not initialized.
   */
  private getContext(): RuntimeContext {
    if (this.context === null) {
      throw new AgentNotInitializedError();
    }
    return this.context;
  }

  async initialize(options: RunnerOptions): Promise<void> {
    const cwd = options.cwd ?? Deno.cwd();
    const agentDir = getAgentDir(this.definition.name, cwd);

    // Store args and agentDir for later use
    this.args = options.args;
    this.agentDir = agentDir;

    // Initialize logger using injected factory
    const logger = await this.dependencies.loggerFactory.create({
      agentName: this.definition.name,
      directory: this.definition.runner.logging.directory,
      format: this.definition.runner.logging.format,
    });

    // Initialize verdict handler using injected factory
    const verdictHandler = await this.dependencies.verdictHandlerFactory
      .create(
        this.definition,
        options.args,
        agentDir,
      );

    // Set working directory for verdict handler (required for worktree mode)
    if ("setCwd" in verdictHandler) {
      (verdictHandler as { setCwd: (cwd: string) => void }).setCwd(cwd);
    }

    // Initialize prompt resolver using injected factory
    const promptResolver = await this.dependencies.promptResolverFactory.create(
      {
        agentName: this.definition.name,
        agentDir,
        registryPath: this.definition.runner.flow.prompts.registry,
      },
    );

    // Initialize validation if registry supports it
    await this.closureManager.initializeValidation(
      agentDir,
      cwd,
      logger,
      this.schemaManager,
    );

    // Initialize verbose logger if enabled
    if (options.verbose) {
      this.verboseLogger = await createVerboseLogger(
        this.definition.runner.logging.directory,
        this.definition.name,
      );
      logger.info("[Verbose] Verbose logging enabled", {
        logPath: this.verboseLogger.getLogPath(),
      });
    }

    // Initialize prompt logger for usage analysis
    const promptLogger = new PromptLogger(logger, {
      logSuccess: true,
      logFailures: true,
      logVariables: true,
    });

    // Assign all context at once (atomic initialization)
    this.context = {
      verdictHandler: verdictHandler,
      promptResolver,
      logger,
      cwd,
      promptLogger,
    };

    // Completion Loop processor — extracted from runner for dual-loop separation
    this.completionLoopProcessor = new CompletionLoopProcessor({
      closureManager: this.closureManager,
      boundaryHooks: this.boundaryHooks,
      closureAdapter: this.closureAdapter,
      queryExecutor: this.queryExecutor,
      flowOrchestrator: this.flowOrchestrator,
      schemaManager: this.schemaManager,
      eventEmitter: this.eventEmitter,
      definition: this.definition,
      args: this.args,
      agentDir: this.agentDir,
      verboseLogger: this.verboseLogger,
      pendingRetryPrompt: {
        get: () => this.pendingRetryPrompt,
        set: (v: string | null) => {
          this.pendingRetryPrompt = v;
        },
      },
      resolveSystemPromptForIteration: (ctx) =>
        this.resolveSystemPromptForIteration(ctx),
      buildUvVariables: (iteration) => this.buildUvVariables(iteration),
    });
  }

  async run(options: RunnerOptions): Promise<AgentResult> {
    await this.initialize(options);

    const { plugins = [] } = options;
    const ctx = this.getContext();

    // Initialize step context for step flow orchestration
    this.flowOrchestrator.initializeStepContext();

    // Emit initialized event
    await this.eventEmitter.emit("initialized", { cwd: ctx.cwd });

    ctx.logger.info(`Starting agent: ${this.definition.displayName}`);

    let iteration = 0;
    let sessionId: string | undefined;
    const summaries: IterationSummary[] = [];
    let completedNormally = false;

    try {
      // Flow loop: Sequential execution
      while (true) {
        iteration++;

        // Emit iterationStart event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("iterationStart", { iteration });

        ctx.logger.info(`=== Iteration ${iteration} ===`);

        // Verbose: Log iteration start
        const stepId = this.flowOrchestrator.getStepIdForIteration(iteration);

        ctx.logger.info("[FlowLoop] Enter", { iteration, stepId });

        // Determine if this is a closure step (Completion Loop processing)
        const isClosureIteration = this.completionLoopProcessor.isClosureStep(
          stepId,
        );

        if (this.verboseLogger) {
          // deno-lint-ignore no-await-in-loop
          await this.verboseLogger.logIterationStart(iteration, stepId);
        }

        // Completion Loop: separate procedure (design: "単発の手続き")
        if (isClosureIteration) {
          // deno-lint-ignore no-await-in-loop
          const result = await this.completionLoopProcessor.runClosureIteration(
            stepId,
            iteration,
            summaries,
            ctx,
            plugins,
          );

          sessionId = result.summary.sessionId;

          if (result.isRateLimitRetry) {
            iteration--;
            continue;
          }

          const isFinished = result.done;
          const verdictReason = result.reason;
          if (!result.done && result.retryPrompt) {
            this.pendingRetryPrompt = result.retryPrompt;
          }

          // Emit verdictChecked event
          // deno-lint-ignore no-await-in-loop
          await this.eventEmitter.emit("verdictChecked", {
            isComplete: isFinished,
            reason: verdictReason,
          });

          // Emit iterationEnd event
          // deno-lint-ignore no-await-in-loop
          await this.eventEmitter.emit("iterationEnd", {
            iteration,
            summary: result.summary,
          });

          // Verbose: Log iteration end with summary
          if (this.verboseLogger) {
            // deno-lint-ignore no-await-in-loop
            await this.verboseLogger.logIterationEnd(iteration, {
              toolsUsed: result.summary.toolsUsed,
              errors: result.summary.errors,
            });
            // deno-lint-ignore no-await-in-loop
            await this.verboseLogger.logSdkResult({
              sessionId: result.summary.sessionId,
              structuredOutput: result.summary.structuredOutput,
              assistantResponses: result.summary.assistantResponses,
              toolsUsed: result.summary.toolsUsed,
              errors: result.summary.errors,
              totalCostUsd: result.summary.totalCostUsd,
              numTurns: result.summary.numTurns,
              durationMs: result.summary.durationMs,
            });
          }

          if (isFinished) {
            completedNormally = true;
            ctx.logger.info(
              `Agent completed after ${iteration} iteration(s): ${verdictReason}`,
            );
            break;
          }

          // Max iteration check
          const maxIterations = this.getMaxIterations();
          if (iteration >= maxIterations) {
            const maxIterError = new AgentMaxIterationsError(
              maxIterations,
              iteration,
            );
            ctx.logger.warn(maxIterError.message);

            // deno-lint-ignore no-await-in-loop
            await this.eventEmitter.emit("error", {
              error: maxIterError,
              recoverable: maxIterError.recoverable,
            });

            break;
          }

          continue; // Skip rest of Flow Loop body
        }

        // === Flow Loop: work/verification steps only ===

        // Build prompt
        let prompt: string;
        let promptSource: "user";
        let promptType:
          | "retry"
          | typeof STEP_PHASE.INITIAL
          | typeof STEP_PHASE.CONTINUATION;
        const promptStartTime = performance.now();

        if (this.pendingRetryPrompt) {
          prompt = this.pendingRetryPrompt;
          promptSource = "user";
          promptType = "retry";
          this.pendingRetryPrompt = null;
          ctx.logger.debug("Using retry prompt from validation");
        } else {
          // Flow Loop: C3L prompt resolution only (design: "プロンプト参照は C3L 形式のみ")
          // Channel 3: Inject verdict handler UV variables for Flow Loop prompts
          const uvVars = this.buildUvVariables(iteration);
          ctx.verdictHandler.setUvVariables?.(uvVars);
          this.enrichWithChannel3Variables(uvVars, iteration, summaries);
          // deno-lint-ignore no-await-in-loop
          const flowPrompt = await this.closureManager
            .resolveFlowStepPrompt(stepId, uvVars);
          if (flowPrompt) {
            prompt = flowPrompt.content;
            promptSource = flowPrompt.source;
            ctx.logger.info(
              `[FlowLoop] C3L prompt resolved for "${stepId}"`,
              { source: flowPrompt.source, promptPath: flowPrompt.promptPath },
            );
          } else {
            throw prC3lNoPrompt(stepId, iteration);
          }
          promptType = iteration === 1
            ? STEP_PHASE.INITIAL
            : STEP_PHASE.CONTINUATION;
        }

        const promptTimeMs = performance.now() - promptStartTime;

        // Log step prompt for usage analysis
        if (ctx.promptLogger) {
          // deno-lint-ignore no-await-in-loop
          await ctx.promptLogger.logResolution(
            {
              stepId,
              source: promptSource,
              content: prompt,
              promptPath:
                `${this.definition.runner.verdict.type}/${promptType}`,
            },
            promptTimeMs,
          );
        }

        // Resolve system prompt
        // deno-lint-ignore no-await-in-loop
        const systemPrompt = await this.resolveSystemPromptForIteration(ctx);

        ctx.logger.info("[SystemPrompt] Using preset configuration", {
          type: systemPrompt.type,
          preset: systemPrompt.preset,
          appendLength: systemPrompt.append.length,
        });

        // Emit promptBuilt event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("promptBuilt", {
          prompt,
          systemPrompt: systemPrompt.append,
        });

        // Verbose: Log prompt and system prompt
        if (this.verboseLogger) {
          // deno-lint-ignore no-await-in-loop
          await this.verboseLogger.logPrompt(prompt);
          // deno-lint-ignore no-await-in-loop
          await this.verboseLogger.logSystemPrompt(systemPrompt);
        }

        // Execute Claude SDK query
        // deno-lint-ignore no-await-in-loop
        const summary = await this.queryExecutor.executeQuery({
          prompt,
          systemPrompt,
          plugins,
          sessionId,
          iteration,
          stepId,
        });

        // Emit queryExecuted event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("queryExecuted", { summary });

        summaries.push(summary);
        sessionId = summary.sessionId;

        // Sync schema resolution state to flow orchestrator
        this.flowOrchestrator.setSchemaResolutionFailed(
          this.schemaManager.schemaResolutionFailed,
        );

        // Normalize stepId in structured output (Flow owns canonical value)
        this.flowOrchestrator.normalizeStructuredOutputStepId(
          stepId,
          summary,
          ctx,
        );

        // Record step output for step flow orchestration
        this.flowOrchestrator.recordStepOutput(stepId, summary, ctx);

        // Handle rate limit retry
        if (summary.rateLimitRetry) {
          const { waitMs, attempt } = summary.rateLimitRetry;
          ctx.logger.info(
            `Waiting ${waitMs}ms for rate limit retry (attempt ${attempt})`,
          );
          // deno-lint-ignore no-await-in-loop
          await this.delay(waitMs);
          continue;
        }

        // Step transition (Flow Loop only — work/verification steps)
        const routingResult = this.flowOrchestrator.handleStepTransition(
          stepId,
          summary,
          ctx,
        );

        // Warn if structured output was expected but not returned
        if (
          routingResult === null &&
          !summary.schemaResolutionFailed &&
          !summary.structuredOutput &&
          this.closureManager.hasFlowRoutingEnabled()
        ) {
          ctx.logger.warn(
            `[StructuredOutput] No structured output returned for iteration ${iteration} on step "${stepId}". ` +
              `LLM may have returned natural language instead of JSON.`,
          );
        }

        // R4: Fail-fast if iteration > 1 and no intent produced (no routing)
        if (
          iteration > 1 &&
          routingResult === null &&
          !summary.schemaResolutionFailed &&
          this.closureManager.hasFlowRoutingEnabled()
        ) {
          const errorMsg =
            `[StepFlow] No intent produced for iteration ${iteration} on step "${stepId}". ` +
            `Flow steps must produce structured output with a valid intent. ` +
            `Check that the step's schema includes next_action.action and the LLM returns valid JSON.`;
          ctx.logger.error(errorMsg);
          throw new AgentStepRoutingError(errorMsg, {
            stepId,
            iteration,
          });
        }

        // Verdict: check completion via runClosureLoop()
        let isFinished: boolean;
        let verdictReason: string;

        if (this.pendingRetryPrompt) {
          // Previous completion attempt returned retry prompt
          isFinished = false;
          // deno-lint-ignore no-await-in-loop
          verdictReason = await ctx.verdictHandler
            .getVerdictDescription();
          ctx.logger.debug("Skipping completion check due to pending retry");
        } else {
          const closingTriggered = routingResult?.signalClosing ||
            this.closureManager.hasAIVerdictDeclaration(summary);

          if (
            closingTriggered || !this.closureManager.hasFlowRoutingEnabled()
          ) {
            const closingReason = routingResult?.signalClosing
              ? routingResult.reason
              : undefined;
            // deno-lint-ignore no-await-in-loop
            const verdict = await this.completionLoopProcessor.runClosureLoop(
              stepId,
              summary,
              ctx,
              closingReason,
            );
            isFinished = verdict.done;
            verdictReason = verdict.reason;
            if (!verdict.done && verdict.retryPrompt) {
              this.pendingRetryPrompt = verdict.retryPrompt;
            }
          } else {
            // Flow routing active, no closing signal — continue flow
            isFinished = false;
            // deno-lint-ignore no-await-in-loop
            verdictReason = await ctx.verdictHandler
              .getVerdictDescription();
          }
        }

        // Emit verdictChecked event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("verdictChecked", {
          isComplete: isFinished,
          reason: verdictReason,
        });

        // Emit iterationEnd event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("iterationEnd", { iteration, summary });

        // Verbose: Log iteration end with summary
        if (this.verboseLogger) {
          // deno-lint-ignore no-await-in-loop
          await this.verboseLogger.logIterationEnd(iteration, {
            toolsUsed: summary.toolsUsed,
            errors: summary.errors,
          });
          // deno-lint-ignore no-await-in-loop
          await this.verboseLogger.logSdkResult({
            sessionId: summary.sessionId,
            structuredOutput: summary.structuredOutput,
            assistantResponses: summary.assistantResponses,
            toolsUsed: summary.toolsUsed,
            errors: summary.errors,
            totalCostUsd: summary.totalCostUsd,
            numTurns: summary.numTurns,
            durationMs: summary.durationMs,
          });
        }

        if (isFinished) {
          completedNormally = true;
          ctx.logger.info(
            `Agent completed after ${iteration} iteration(s): ${verdictReason}`,
          );
          break;
        }

        // Max iteration check
        const maxIterations = this.getMaxIterations();
        if (iteration >= maxIterations) {
          const maxIterError = new AgentMaxIterationsError(
            maxIterations,
            iteration,
          );
          ctx.logger.warn(maxIterError.message);

          // Emit error event for max iterations
          // deno-lint-ignore no-await-in-loop
          await this.eventEmitter.emit("error", {
            error: maxIterError,
            recoverable: maxIterError.recoverable,
          });

          break;
        }
      }

      const verdictDescription = await ctx.verdictHandler
        .getVerdictDescription();
      const lastCostSummary = [...summaries].reverse().find((s) =>
        s.totalCostUsd !== undefined
      );
      const lastRateLimitInfo = [...summaries].reverse().find((s) =>
        s.rateLimitInfo !== undefined
      )?.rateLimitInfo;

      // Collect all errors across iterations for surfacing
      const allErrors = summaries.flatMap((s) => s.errors);
      const hasLlmResponses = summaries.some((s) =>
        s.assistantResponses.length > 0
      );

      // Log accumulated errors
      if (allErrors.length > 0) {
        ctx.logger.error("Accumulated errors across iterations", {
          count: allErrors.length,
          errors: allErrors,
        });
      }

      // Log zero-LLM-response condition
      if (!hasLlmResponses && iteration > 0) {
        ctx.logger.error(
          "No LLM responses received across all iterations -- " +
            "check SDK availability, API key, and network connectivity",
          { iterations: iteration },
        );
      }

      // Determine success: only true when completion condition was met
      const success = completedNormally;
      let reason: string;
      let error: string | undefined;

      if (completedNormally) {
        reason = verdictDescription;
      } else {
        const maxIterations = this.getMaxIterations();
        if (iteration >= maxIterations) {
          reason =
            `Maximum iterations (${maxIterations}) reached without completion`;
        } else {
          reason = "Agent loop exited without meeting completion condition";
        }
        // Surface accumulated errors
        if (allErrors.length > 0) {
          error = allErrors.join("; ");
        } else if (!hasLlmResponses) {
          error = "No LLM responses received across all iterations";
        }
      }

      // Extract verdict from verdict handler for orchestrator routing
      const verdictValue = ctx.verdictHandler.getLastVerdict();

      const result: AgentResult = {
        success,
        iterations: iteration,
        reason,
        summaries,
        ...(error && { error }),
        ...(lastCostSummary?.totalCostUsd !== undefined && {
          totalCostUsd: lastCostSummary.totalCostUsd,
        }),
        ...(lastCostSummary?.numTurns !== undefined && {
          numTurns: lastCostSummary.numTurns,
        }),
        ...(lastCostSummary?.durationMs !== undefined && {
          durationMs: lastCostSummary.durationMs,
        }),
        ...(lastRateLimitInfo && { rateLimitInfo: lastRateLimitInfo }),
        ...(verdictValue && { verdict: verdictValue }),
      };

      // Emit completed event
      await this.eventEmitter.emit("completed", { result });

      return result;
    } catch (error) {
      // Normalize error to AgentError for structured handling
      const agentError = normalizeToAgentError(error, { iteration });
      ctx.logger.error("Agent failed", {
        error: agentError.message,
        code: agentError.code,
        iteration: agentError.iteration,
      });

      // Emit error event with structured error
      await this.eventEmitter.emit("error", {
        error: agentError,
        recoverable: isAgentError(error) ? error.recoverable : false,
      });

      const errorReason = agentError.message;
      const lastCostSummaryOnError = [...summaries].reverse().find((s) =>
        s.totalCostUsd !== undefined
      );
      const lastRateLimitInfoOnError = [...summaries].reverse().find((s) =>
        s.rateLimitInfo !== undefined
      )?.rateLimitInfo;
      return {
        success: false,
        iterations: iteration,
        reason: errorReason,
        summaries,
        error: errorReason,
        ...(lastCostSummaryOnError?.totalCostUsd !== undefined && {
          totalCostUsd: lastCostSummaryOnError.totalCostUsd,
        }),
        ...(lastCostSummaryOnError?.numTurns !== undefined && {
          numTurns: lastCostSummaryOnError.numTurns,
        }),
        ...(lastCostSummaryOnError?.durationMs !== undefined && {
          durationMs: lastCostSummaryOnError.durationMs,
        }),
        ...(lastRateLimitInfoOnError && {
          rateLimitInfo: lastRateLimitInfoOnError,
        }),
      };
    } finally {
      // Close verbose logger if enabled
      if (this.verboseLogger) {
        await this.verboseLogger.close();
        ctx.logger.info("[Verbose] Verbose log saved", {
          logPath: this.verboseLogger.getLogPath(),
        });
      }
      await ctx.logger.close();
    }
  }

  /**
   * Resolve system prompt for an iteration.
   * Shared between Flow Loop and Completion Loop.
   */
  private async resolveSystemPromptForIteration(
    ctx: RuntimeContext,
  ): Promise<{
    type: "preset";
    preset: "claude_code";
    append: string;
  }> {
    const result = await resolveSystemPrompt({
      agentDir: this.agentDir,
      systemPromptPath: this.definition.runner.flow.systemPromptPath,
      // These variables are injected directly into the system prompt template,
      // outside UV Channels 1-4 (CLI params, runtime, VerdictHandler, StepContext).
      // They use the "uv-" prefix for template placeholder consistency
      // (e.g. {uv-verdict_criteria}), but bypass the Channel pipeline because
      // system prompt resolution occurs before step-level UV Channel processing.
      variables: {
        "uv-agent_name": this.definition.name,
        "uv-verdict_criteria":
          ctx.verdictHandler.buildVerdictCriteria().detailed,
      },
    });
    return {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: result.content,
    };
  }

  /**
   * Get the step context for data passing between steps.
   */
  getStepContext(): StepContext | null {
    return this.flowOrchestrator.getStepContext();
  }

  private getMaxIterations(): number {
    const maxIterations = (
      this.definition.runner.verdict.config as {
        maxIterations?: number;
      }
    ).maxIterations;
    if (maxIterations !== undefined) {
      return maxIterations;
    }
    return AGENT_LIMITS.FALLBACK_MAX_ITERATIONS;
  }

  /**
   * Build UV variables from CLI args for stepPromptResolver.
   */
  private buildUvVariables(iteration: number): Record<string, string> {
    const uv: Record<string, string> = {};
    // Generic: map all CLI parameters declared in agent.json to UV variables
    for (const [key, value] of Object.entries(this.args)) {
      if (value !== undefined && value !== null) {
        uv[key] = String(value);
      }
    }
    // Runtime variables
    uv.iteration = String(iteration);
    if (iteration > 1) {
      uv.completed_iterations = String(iteration - 1);
    }
    // Verdict keyword from agent config (for detect:keyword templates)
    const verdictConfig = this.definition.runner?.verdict
      ?.config as Record<string, unknown> | undefined;
    if (verdictConfig?.verdictKeyword) {
      uv.completion_keyword = String(verdictConfig.verdictKeyword);
    }
    // Channel 4: StepContext handoff - resolve inputs from previous step outputs
    const currentStepId = this.flowOrchestrator.currentStepId;
    if (currentStepId && this.closureManager.stepsRegistry) {
      const stepDef = this.closureManager.stepsRegistry.steps[currentStepId];
      if (stepDef?.inputs && this.flowOrchestrator.stepContext) {
        const handoffUv = this.flowOrchestrator.stepContext.toUV(
          stepDef.inputs,
        );
        const logger = this.getContext().logger;
        for (const [key, value] of Object.entries(handoffUv)) {
          if (key in uv) {
            logger.warn(
              `[UV] Channel 4 handoff key "${key}" collides with existing UV key; preserving Channel 1 value`,
              {
                key,
                channel1Value: uv[key],
                channel4Value: value,
              },
            );
          } else {
            uv[key] = value;
          }
        }
      }
    }
    return uv;
  }

  /**
   * Enrich UV variables with Channel 3 verdict handler variables.
   *
   * Channel 3 variables (max_iterations, remaining, previous_summary,
   * check_count, max_checks) are normally injected by verdict handlers
   * inside buildContinuationPrompt(). In the Flow Loop, prompts are
   * resolved via C3L (resolveFlowStepPrompt) without calling
   * buildContinuationPrompt, so we extract the same variables here
   * from the verdict config and runtime state.
   *
   * @param uv - UV dict to enrich (mutated in place)
   * @param iteration - Current iteration number
   * @param summaries - All iteration summaries so far
   */
  private enrichWithChannel3Variables(
    uv: Record<string, string>,
    iteration: number,
    summaries: IterationSummary[],
  ): void {
    const verdictConfig = this.definition.runner?.verdict
      ?.config as Record<string, unknown> | undefined;

    // count:iteration — max_iterations, remaining
    if (verdictConfig?.maxIterations !== undefined) {
      const max = Number(verdictConfig.maxIterations);
      uv.max_iterations = String(max);
      uv.remaining = String(Math.max(0, max - iteration));
    }

    // count:check — max_checks, check_count
    if (verdictConfig?.maxChecks !== undefined) {
      uv.max_checks = String(verdictConfig.maxChecks);
      // check_count mirrors iteration in the Flow Loop context
      uv.check_count = String(iteration);
    }

    // previous_summary — formatted summary of the last iteration
    if (iteration > 1 && summaries.length > 0) {
      const lastSummary = summaries[summaries.length - 1];
      uv.previous_summary = formatIterationSummary(lastSummary);
    } else {
      uv.previous_summary = "";
    }
  }

  /**
   * Delay execution for a specified duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
