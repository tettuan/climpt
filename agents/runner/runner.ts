/**
 * Agent Runner - main execution engine (slim coordinator)
 *
 * Dual-loop architecture:
 * - Flow Loop: Step advancement and handoff management
 * - Completion Loop: Validates completion conditions
 *
 * Supports dependency injection for testability.
 * Use AgentRunnerBuilder for convenient construction with custom dependencies.
 *
 * Responsibilities are delegated to extracted modules:
 * - QueryExecutor: SDK query execution, message processing, rate limiting
 * - FlowOrchestrator: Step routing, transitions, stepId normalization
 * - SchemaManager: Schema loading, fail-fast tracking, flow validation
 * - CompletionManager: Completion initialization, validation, AI declaration detection
 * - BoundaryHooks: Closure step boundary hook invocation
 * - ClosureAdapter: Closure step prompt adaptation
 */

import type {
  AgentDefinition,
  AgentResult,
  IterationSummary,
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

// Extracted modules
import { QueryExecutor } from "./query-executor.ts";
import { FlowOrchestrator } from "./flow-orchestrator.ts";
import { SchemaManager } from "./schema-manager.ts";
import { CompletionManager } from "./completion-manager.ts";
import { BoundaryHooks } from "./boundary-hooks.ts";
import { ClosureAdapter } from "./closure-adapter.ts";

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
export type { CompletionValidationResult } from "./completion-chain.ts";

export class AgentRunner {
  private readonly definition: AgentDefinition;
  private readonly dependencies: AgentDependencies;
  private readonly eventEmitter: AgentEventEmitter;
  private context: RuntimeContext | null = null;
  private args: Record<string, unknown> = {};

  // Extracted module instances
  private readonly completionManager: CompletionManager;
  private readonly schemaManager: SchemaManager;
  private readonly flowOrchestrator: FlowOrchestrator;
  private readonly queryExecutor: QueryExecutor;
  private readonly boundaryHooks: BoundaryHooks;
  private readonly closureAdapter: ClosureAdapter;

  // Completion validation
  private pendingRetryPrompt: string | null = null;

  // Verbose logging for SDK I/O debugging
  private verboseLogger: VerboseLogger | null = null;

  /**
   * Create an AgentRunner with optional dependency injection.
   */
  constructor(definition: AgentDefinition, dependencies?: AgentDependencies) {
    this.definition = definition;
    this.dependencies = dependencies ?? createDefaultDependencies();
    this.eventEmitter = new AgentEventEmitter();

    // Initialize extracted modules with dependency bridges
    this.completionManager = new CompletionManager({
      definition: this.definition,
      dependencies: this.dependencies,
    });

    this.schemaManager = new SchemaManager({
      definition: this.definition,
      getContext: () => this.getContext(),
      getStepsRegistry: () => this.completionManager.stepsRegistry,
    });

    this.flowOrchestrator = new FlowOrchestrator({
      definition: this.definition,
      args: this.args,
      getStepsRegistry: () => this.completionManager.stepsRegistry,
      getStepGateInterpreter: () => this.completionManager.stepGateInterpreter,
      getWorkflowRouter: () => this.completionManager.workflowRouter,
      hasFlowRoutingEnabled: () =>
        this.completionManager.hasFlowRoutingEnabled(),
    });

    this.queryExecutor = new QueryExecutor({
      definition: this.definition,
      getContext: () => this.getContext(),
      getStepsRegistry: () => this.completionManager.stepsRegistry,
      getVerboseLogger: () => this.verboseLogger,
      getSchemaManager: () => this.schemaManager,
    });

    this.boundaryHooks = new BoundaryHooks({
      getStepsRegistry: () => this.completionManager.stepsRegistry,
      getEventEmitter: () => this.eventEmitter,
    });

    this.closureAdapter = new ClosureAdapter({
      definition: this.definition,
      args: this.args,
      getStepPromptResolver: () => this.completionManager.stepPromptResolver,
      getStepsRegistry: () => this.completionManager.stepsRegistry,
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

    // Store args for later use
    this.args = options.args;

    // Initialize logger using injected factory
    const logger = await this.dependencies.loggerFactory.create({
      agentName: this.definition.name,
      directory: this.definition.logging.directory,
      format: this.definition.logging.format,
    });

    // Initialize completion handler using injected factory
    const completionHandler = await this.dependencies.completionHandlerFactory
      .create(
        this.definition,
        options.args,
        agentDir,
      );

    // Set working directory for completion handler (required for worktree mode)
    if ("setCwd" in completionHandler) {
      (completionHandler as { setCwd: (cwd: string) => void }).setCwd(cwd);
    }

    // Initialize prompt resolver using injected factory
    const promptResolver = await this.dependencies.promptResolverFactory.create(
      {
        agentName: this.definition.name,
        agentDir,
        registryPath: this.definition.prompts.registry,
        fallbackDir: this.definition.prompts.fallbackDir,
        systemPromptPath: this.definition.behavior.systemPromptPath,
      },
    );

    // Initialize Completion validation if registry supports it
    await this.completionManager.initializeCompletionValidation(
      agentDir,
      cwd,
      logger,
      this.schemaManager,
    );

    // Initialize verbose logger if enabled
    if (options.verbose) {
      this.verboseLogger = await createVerboseLogger(
        this.definition.logging.directory,
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

    // Inject prompt logger into resolver for automatic logging
    promptResolver.setPromptLogger(promptLogger);

    // Assign all context at once (atomic initialization)
    this.context = {
      completionHandler,
      promptResolver,
      logger,
      cwd,
      promptLogger,
    };
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
        if (this.verboseLogger) {
          // deno-lint-ignore no-await-in-loop
          await this.verboseLogger.logIterationStart(iteration, stepId);
        }

        // Build prompt
        const lastSummary = summaries.length > 0
          ? summaries[summaries.length - 1]
          : undefined;
        let prompt: string;
        let promptSource: "user" | "fallback";
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
          ctx.logger.debug("Using retry prompt from completion validation");
        } else if (iteration === 1) {
          // deno-lint-ignore no-await-in-loop
          prompt = await ctx.completionHandler.buildInitialPrompt();
          promptSource = "user";
          promptType = STEP_PHASE.INITIAL;
        } else {
          // Try closure adaptation for closure steps
          // deno-lint-ignore no-await-in-loop
          const closurePrompt = await this.closureAdapter
            .tryClosureAdaptation(stepId, ctx);
          if (closurePrompt) {
            prompt = closurePrompt.content;
            promptSource = closurePrompt.source;
            promptType = STEP_PHASE.CONTINUATION;
          } else {
            // deno-lint-ignore no-await-in-loop
            prompt = await ctx.completionHandler.buildContinuationPrompt(
              iteration - 1,
              lastSummary,
            );
            promptSource = "user";
            promptType = STEP_PHASE.CONTINUATION;
          }
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
                `${this.definition.behavior.completionType}/${promptType}`,
            },
            promptTimeMs,
          );
        }

        // Resolve system prompt
        // deno-lint-ignore no-await-in-loop
        const systemPromptResult = await ctx.promptResolver
          .resolveSystemPromptWithMetadata(
            {
              "uv-agent_name": this.definition.name,
              "uv-completion_criteria":
                ctx.completionHandler.buildCompletionCriteria().detailed,
            },
          );
        const customSystemPrompt = systemPromptResult.content;

        // Build system prompt with claude_code preset + custom append
        const systemPrompt = {
          type: "preset" as const,
          preset: "claude_code" as const,
          append: customSystemPrompt,
        };

        // Debug: Log system prompt structure
        ctx.logger.info("[SystemPrompt] Using preset configuration", {
          type: systemPrompt.type,
          preset: systemPrompt.preset,
          appendLength: customSystemPrompt.length,
        });

        // Emit promptBuilt event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("promptBuilt", {
          prompt,
          systemPrompt: customSystemPrompt,
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

        // Completion validation: trigger when AI declares complete via structured output
        if (this.completionManager.hasAICompletionDeclaration(summary)) {
          const completionStepId = this.completionManager
            .getCompletionStepId();
          ctx.logger.info(
            "AI declared completion, validating external conditions",
          );
          // deno-lint-ignore no-await-in-loop
          const validation = await this.completionManager
            .validateCompletionConditions(
              completionStepId,
              summary,
              ctx.logger,
            );

          if (!validation.valid) {
            this.pendingRetryPrompt = validation.retryPrompt ?? null;
            ctx.logger.info(
              "Completion conditions not met, will retry in next iteration",
            );
          }
        }

        // Step transition for step flow orchestration
        const routingResult = this.flowOrchestrator.handleStepTransition(
          stepId,
          summary,
          ctx,
        );

        // Warn if structured output was expected but not returned (all iterations)
        if (
          routingResult === null &&
          !summary.schemaResolutionFailed &&
          !summary.structuredOutput &&
          this.completionManager.hasFlowRoutingEnabled()
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
          this.completionManager.hasFlowRoutingEnabled()
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

        // Check completion - prefer routing result, fall back to legacy handler
        let isComplete: boolean;
        let completionReason: string;

        if (this.pendingRetryPrompt) {
          isComplete = false;
          // deno-lint-ignore no-await-in-loop
          completionReason = await ctx.completionHandler
            .getCompletionDescription();
          ctx.logger.debug("Skipping completion check due to pending retry");
        } else if (routingResult?.signalCompletion) {
          // Structured gate routing signaled completion
          isComplete = true;
          completionReason = routingResult.reason;
          ctx.logger.info(
            `[StepFlow] Router signaled completion: ${completionReason}`,
          );

          // Invoke boundary hook for closure steps
          // deno-lint-ignore no-await-in-loop
          await this.boundaryHooks.invokeBoundaryHook(stepId, summary, ctx);
        } else {
          // Fall back to legacy completionHandler
          if (ctx.completionHandler.setCurrentSummary) {
            ctx.completionHandler.setCurrentSummary(summary);
          }
          // deno-lint-ignore no-await-in-loop
          isComplete = await ctx.completionHandler.isComplete();
          // deno-lint-ignore no-await-in-loop
          completionReason = await ctx.completionHandler
            .getCompletionDescription();
        }

        // Emit completionChecked event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("completionChecked", {
          isComplete,
          reason: completionReason,
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

        if (isComplete) {
          ctx.logger.info(
            `Agent completed after ${iteration} iteration(s): ${completionReason}`,
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

      const completionDescription = await ctx.completionHandler
        .getCompletionDescription();
      const lastCostSummary = [...summaries].reverse().find((s) =>
        s.totalCostUsd !== undefined
      );
      const result: AgentResult = {
        success: true,
        iterations: iteration,
        reason: completionDescription,
        summaries,
        ...(lastCostSummary?.totalCostUsd !== undefined && {
          totalCostUsd: lastCostSummary.totalCostUsd,
        }),
        ...(lastCostSummary?.numTurns !== undefined && {
          numTurns: lastCostSummary.numTurns,
        }),
        ...(lastCostSummary?.durationMs !== undefined && {
          durationMs: lastCostSummary.durationMs,
        }),
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
   * Get the step context for data passing between steps.
   */
  getStepContext(): StepContext | null {
    return this.flowOrchestrator.getStepContext();
  }

  private getMaxIterations(): number {
    if (this.definition.behavior.completionType === "iterationBudget") {
      return (
        (
          this.definition.behavior.completionConfig as {
            maxIterations?: number;
          }
        ).maxIterations ?? AGENT_LIMITS.FALLBACK_MAX_ITERATIONS
      );
    }
    return AGENT_LIMITS.FALLBACK_MAX_ITERATIONS;
  }

  /**
   * Delay execution for a specified duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
