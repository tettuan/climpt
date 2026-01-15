/**
 * Agent Runner - main execution engine
 *
 * Iteration-based agent execution with action detection and completion handling.
 *
 * Supports dependency injection for testability.
 * Use AgentRunnerBuilder for convenient construction with custom dependencies.
 */

import type {
  ActionResult,
  AgentDefinition,
  AgentResult,
  IterationSummary,
  RuntimeContext,
} from "../src_common/types.ts";
import { isRecord, isString } from "../src_common/type-guards.ts";
import {
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentRateLimitError,
  isAgentError,
  normalizeToAgentError,
} from "./errors.ts";
import { calculateBackoff, isRateLimitError } from "./error-classifier.ts";
import { ActionDetector } from "../actions/detector.ts";
import { ActionExecutor } from "../actions/executor.ts";
import { getAgentDir } from "./loader.ts";
import { mergeSandboxConfig, toSdkSandboxConfig } from "./sandbox-defaults.ts";
import type { AgentDependencies } from "./builder.ts";
import { createDefaultDependencies, isInitializable } from "./builder.ts";
import type { CompletionValidator } from "../validators/completion/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import {
  type CompletionStepConfig,
  type ExtendedStepsRegistry,
  isExtendedRegistry,
  type OutputSchemaRef,
  type StepCheckConfig,
} from "../common/completion-types.ts";
import type { PromptStepDefinition } from "../common/step-registry.ts";
import { FormatValidator } from "../loop/format-validator.ts";
import {
  CompletionChain,
  type CompletionValidationResult,
} from "./completion-chain.ts";
import type { FormatValidationResult } from "../loop/format-validator.ts";
import { join } from "@std/path";
import { SchemaResolver } from "../common/schema-resolver.ts";
import { type Closer, createCloser } from "../closer/mod.ts";
import type { CloserQueryFn } from "../closer/types.ts";
import {
  isAssistantMessage,
  isErrorMessage,
  isResultMessage,
  isToolUseMessage,
} from "./message-types.ts";
import {
  type AgentEvent,
  AgentEventEmitter,
  type AgentEventHandler,
} from "./events.ts";

export interface RunnerOptions {
  /** Working directory */
  cwd?: string;
  /** CLI arguments passed to the agent */
  args: Record<string, unknown>;
  /** Additional plugins to load */
  plugins?: string[];
}

// CompletionValidationResult is now imported from completion-chain.ts
// Re-export for backward compatibility
export type { CompletionValidationResult } from "./completion-chain.ts";

export class AgentRunner {
  private readonly definition: AgentDefinition;
  private readonly dependencies: AgentDependencies;
  private readonly eventEmitter: AgentEventEmitter;
  private context: RuntimeContext | null = null;
  private args: Record<string, unknown> = {};

  // Completion validation
  private completionValidator: CompletionValidator | null = null;
  private retryHandler: RetryHandler | null = null;
  private stepsRegistry: ExtendedStepsRegistry | null = null;
  private completionChain: CompletionChain | null = null;
  private closer: Closer | null = null;
  private pendingRetryPrompt: string | null = null;
  private readonly formatValidator = new FormatValidator();
  private formatRetryCount = 0;

  // Rate limit handling
  private rateLimitRetryCount = 0;
  private static readonly MAX_RATE_LIMIT_RETRIES = 5;

  /**
   * Create an AgentRunner with optional dependency injection.
   *
   * @param definition - Agent definition from config
   * @param dependencies - Optional dependencies for testing. Uses defaults if not provided.
   *
   * @example
   * // Standard usage (uses default dependencies)
   * const runner = new AgentRunner(definition);
   *
   * @example
   * // With custom dependencies (for testing)
   * const runner = new AgentRunner(definition, {
   *   loggerFactory: mockLoggerFactory,
   *   completionHandlerFactory: mockCompletionFactory,
   *   promptResolverFactory: mockPromptFactory,
   * });
   *
   * @example
   * // Using the builder (recommended for testing)
   * const runner = await new AgentRunnerBuilder()
   *   .withDefinition(definition)
   *   .withLoggerFactory(mockLoggerFactory)
   *   .build();
   */
  constructor(definition: AgentDefinition, dependencies?: AgentDependencies) {
    this.definition = definition;
    this.dependencies = dependencies ?? createDefaultDependencies();
    this.eventEmitter = new AgentEventEmitter();
  }

  /**
   * Subscribe to agent lifecycle events.
   *
   * @param event - The event type to subscribe to
   * @param handler - Handler function called when event occurs
   * @returns Unsubscribe function
   *
   * @example
   * const unsubscribe = runner.on("iterationStart", ({ iteration }) => {
   *   console.log(`Starting iteration ${iteration}`);
   * });
   * // Later: unsubscribe();
   */
  on<E extends AgentEvent>(
    event: E,
    handler: AgentEventHandler<E>,
  ): () => void {
    return this.eventEmitter.on(event, handler);
  }

  /**
   * Get runtime context, throwing if not initialized.
   * This replaces non-null assertions with explicit error handling.
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

    // Store args for later use (e.g., determining step ID)
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
      },
    );

    // Initialize action system if enabled
    let actionDetector: ActionDetector | undefined;
    let actionExecutor: ActionExecutor | undefined;
    if (this.definition.actions?.enabled) {
      const actionFactory = this.dependencies.actionSystemFactory;
      // Extract agentBehavior config for pre-close validation
      const agentBehavior = this.definition.behavior.preCloseValidation
        ? { preCloseValidation: this.definition.behavior.preCloseValidation }
        : undefined;

      if (actionFactory) {
        // Ensure the factory is initialized if it supports initialization
        if (isInitializable(actionFactory)) {
          await actionFactory.initialize();
        }
        actionDetector = actionFactory.createDetector(this.definition.actions);
        actionExecutor = actionFactory.createExecutor(this.definition.actions, {
          agentName: this.definition.name,
          logger,
          cwd,
          agentBehavior,
        });
      } else {
        // Fallback to direct instantiation if no factory provided
        actionDetector = new ActionDetector(this.definition.actions);
        actionExecutor = new ActionExecutor(this.definition.actions, {
          agentName: this.definition.name,
          logger,
          cwd,
          agentBehavior,
        });
      }
    }

    // Initialize Completion validation if registry supports it
    await this.initializeCompletionValidation(agentDir, cwd, logger);

    // Assign all context at once (atomic initialization)
    this.context = {
      completionHandler,
      promptResolver,
      actionDetector,
      actionExecutor,
      logger,
      cwd,
    };
  }

  async run(options: RunnerOptions): Promise<AgentResult> {
    await this.initialize(options);

    const { plugins = [] } = options;
    const ctx = this.getContext();

    // Emit initialized event
    await this.eventEmitter.emit("initialized", { cwd: ctx.cwd });

    ctx.logger.info(`Starting agent: ${this.definition.displayName}`);

    let iteration = 0;
    let sessionId: string | undefined;
    const summaries: IterationSummary[] = [];

    try {
      // Sequential execution required: each iteration depends on previous results
      while (true) {
        iteration++;

        // Emit iterationStart event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("iterationStart", { iteration });

        ctx.logger.info(`=== Iteration ${iteration} ===`);

        // Build prompt (use retry prompt if available from failed completion validation)
        const lastSummary = summaries.length > 0
          ? summaries[summaries.length - 1]
          : undefined;
        let prompt: string;
        if (this.pendingRetryPrompt) {
          prompt = this.pendingRetryPrompt;
          this.pendingRetryPrompt = null; // Clear after use
          ctx.logger.debug("Using retry prompt from completion validation");
        } else if (iteration === 1) {
          // deno-lint-ignore no-await-in-loop
          prompt = await ctx.completionHandler.buildInitialPrompt();
        } else {
          // deno-lint-ignore no-await-in-loop
          prompt = await ctx.completionHandler.buildContinuationPrompt(
            iteration - 1, // completedIterations
            lastSummary,
          );
        }

        // deno-lint-ignore no-await-in-loop
        const systemPrompt = await ctx.promptResolver.resolveSystemPrompt({
          "uv-agent_name": this.definition.name,
          "uv-completion_criteria":
            ctx.completionHandler.buildCompletionCriteria().detailed,
        });

        // Emit promptBuilt event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("promptBuilt", { prompt, systemPrompt });

        // Determine step ID for this iteration
        const stepId = this.getStepIdForIteration(iteration);

        // Execute Claude SDK query
        // deno-lint-ignore no-await-in-loop
        const summary = await this.executeQuery({
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

        // Handle rate limit retry: wait before next iteration
        if (summary.rateLimitRetry) {
          const { waitMs, attempt } = summary.rateLimitRetry;
          ctx.logger.info(
            `Waiting ${waitMs}ms for rate limit retry (attempt ${attempt})`,
          );
          // deno-lint-ignore no-await-in-loop
          await this.delay(waitMs);
          // Continue to next iteration without processing actions
          continue;
        }

        // Emit actionDetected event if actions were detected
        if (summary.detectedActions.length > 0) {
          // deno-lint-ignore no-await-in-loop
          await this.eventEmitter.emit("actionDetected", {
            actions: summary.detectedActions,
          });
        }

        // Execute detected actions
        if (ctx.actionExecutor && summary.detectedActions.length > 0) {
          ctx.actionExecutor.setIteration(iteration);
          // deno-lint-ignore no-await-in-loop
          summary.actionResults = await ctx.actionExecutor.execute(
            summary.detectedActions,
          );

          // Process completion signals from action results
          this.processCompletionSignals(ctx, summary.actionResults);

          // Emit actionExecuted event
          // deno-lint-ignore no-await-in-loop
          await this.eventEmitter.emit("actionExecuted", {
            results: summary.actionResults,
          });
        }

        // Completion validation: trigger when AI declares complete via structured output
        // This removes dependency on issue-action and uses AI's explicit declaration
        if (this.hasAICompletionDeclaration(summary)) {
          const stepId = this.getCompletionStepId();
          ctx.logger.info(
            "AI declared completion, validating external conditions",
          );
          // deno-lint-ignore no-await-in-loop
          const validation = await this.validateCompletionConditions(
            stepId,
            summary,
            ctx.logger,
          );

          if (!validation.valid) {
            // Store retry prompt for next iteration
            this.pendingRetryPrompt = validation.retryPrompt ?? null;
            ctx.logger.info(
              "Completion conditions not met, will retry in next iteration",
            );
          }
        }

        // Check completion
        // If there's a pending retry prompt, completion conditions failed - don't complete yet
        let isComplete: boolean;
        if (this.pendingRetryPrompt) {
          isComplete = false;
          ctx.logger.debug("Skipping completion check due to pending retry");
        } else {
          // Pass current summary to handler for structured output context
          if (ctx.completionHandler.setCurrentSummary) {
            ctx.completionHandler.setCurrentSummary(summary);
          }
          // deno-lint-ignore no-await-in-loop
          isComplete = await ctx.completionHandler.isComplete();
        }
        // deno-lint-ignore no-await-in-loop
        const completionReason = await ctx.completionHandler
          .getCompletionDescription();

        // Emit completionChecked event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("completionChecked", {
          isComplete,
          reason: completionReason,
        });

        // Emit iterationEnd event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("iterationEnd", { iteration, summary });

        if (isComplete) {
          ctx.logger.info("Agent completed");
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
      const result: AgentResult = {
        success: true,
        iterations: iteration,
        reason: completionDescription,
        summaries,
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
      return {
        success: false,
        iterations: iteration,
        reason: errorReason,
        summaries,
        error: errorReason,
      };
    } finally {
      await ctx.logger.close();
    }
  }

  private async executeQuery(options: {
    prompt: string;
    systemPrompt: string;
    plugins: string[];
    sessionId?: string;
    iteration: number;
    stepId?: string;
  }): Promise<IterationSummary> {
    const { prompt, systemPrompt, plugins, sessionId, iteration, stepId } =
      options;
    const ctx = this.getContext();

    const summary: IterationSummary = {
      iteration,
      sessionId: undefined,
      assistantResponses: [],
      toolsUsed: [],
      detectedActions: [],
      errors: [],
    };

    try {
      // Dynamic import of Claude Code SDK
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const queryOptions: Record<string, unknown> = {
        cwd: ctx.cwd,
        systemPrompt,
        allowedTools: this.definition.behavior.allowedTools,
        permissionMode: this.definition.behavior.permissionMode,
        settingSources: ["user", "project"],
        plugins,
        resume: sessionId,
      };

      // Configure sandbox (merge agent config with defaults, convert to SDK format)
      const sandboxConfig = mergeSandboxConfig(
        this.definition.behavior.sandboxConfig,
      );
      if (sandboxConfig.enabled === false) {
        queryOptions.dangerouslySkipPermissions = true;
      } else {
        queryOptions.sandbox = toSdkSandboxConfig(sandboxConfig);
      }

      // Configure structured output if step has outputSchemaRef
      if (stepId) {
        const schema = await this.loadSchemaForStep(stepId, ctx.logger);
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

      const queryIterator = query({
        prompt,
        options: queryOptions,
      });

      for await (const message of queryIterator) {
        ctx.logger.logSdkMessage(message);
        this.processMessage(message, summary);
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);

      // Check for rate limit error
      if (isRateLimitError(errorMessage)) {
        this.rateLimitRetryCount++;

        if (this.rateLimitRetryCount >= AgentRunner.MAX_RATE_LIMIT_RETRIES) {
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
          // Throw to stop the agent
          throw rateLimitError;
        }

        const waitTime = calculateBackoff(this.rateLimitRetryCount - 1);
        ctx.logger.warn(
          `Rate limit hit, waiting ${waitTime}ms before retry ` +
            `(attempt ${this.rateLimitRetryCount}/${AgentRunner.MAX_RATE_LIMIT_RETRIES})`,
        );

        // Wait and signal retry needed
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

    // Format validation: check response format if step has responseFormat config
    if (stepId) {
      const formatResult = await this.validateResponseFormat(stepId, summary);
      if (formatResult && !formatResult.valid) {
        summary.errors.push(formatResult.error ?? "Format validation failed");
        ctx.logger.debug("[FormatValidator] Format validation failed", {
          stepId,
          error: formatResult.error,
        });
      }
    }

    return summary;
  }

  /**
   * Validate response format for a step.
   *
   * Checks if the step has a responseFormat config in its check definition.
   * Returns validation result or undefined if no format check is configured.
   */
  private async validateResponseFormat(
    stepId: string,
    summary: IterationSummary,
  ): Promise<FormatValidationResult | undefined> {
    const checkConfig = this.getStepCheckConfig(stepId);
    if (!checkConfig?.responseFormat) {
      return undefined;
    }

    const result = this.formatValidator.validate(
      summary,
      checkConfig.responseFormat,
    );

    if (!result.valid) {
      const maxRetries = checkConfig.onFail?.maxRetries ?? 3;
      if (this.formatRetryCount < maxRetries) {
        this.formatRetryCount++;
        this.pendingRetryPrompt = this.buildFormatRetryPrompt(
          checkConfig,
          result.error ?? "Format validation failed",
        );
        this.getContext().logger.info(
          `[FormatValidator] Will retry (attempt ${this.formatRetryCount}/${maxRetries})`,
        );
      } else {
        this.getContext().logger.warn(
          `[FormatValidator] Max retries reached (${maxRetries})`,
        );
      }
    } else {
      // Reset retry count on success
      this.formatRetryCount = 0;
    }

    await Promise.resolve(); // Ensure async signature
    return result;
  }

  /**
   * Get step check configuration from registry.
   */
  private getStepCheckConfig(stepId: string): StepCheckConfig | undefined {
    if (!this.stepsRegistry?.completionSteps) {
      return undefined;
    }
    const stepConfig = this.stepsRegistry.completionSteps[stepId];
    return stepConfig?.check;
  }

  private processMessage(message: unknown, summary: IterationSummary): void {
    const ctx = this.getContext();

    if (isAssistantMessage(message)) {
      const content = this.extractContent(message.message);
      if (content) {
        summary.assistantResponses.push(content);

        // Detect actions
        if (ctx.actionDetector) {
          const actions = ctx.actionDetector.detect(content);
          summary.detectedActions.push(...actions);
        }
      }
    } else if (isToolUseMessage(message)) {
      summary.toolsUsed.push(message.tool_name);
    } else if (isResultMessage(message)) {
      summary.sessionId = message.session_id;
      if (message.structured_output) {
        summary.structuredOutput = message.structured_output;
        ctx.logger.info("[StructuredOutput] Got structured output from result");
      }
    } else if (isErrorMessage(message)) {
      summary.errors.push(message.error.message ?? "Unknown error");
    }
    // Unknown message types are silently ignored (defensive)
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

  private getMaxIterations(): number {
    if (this.definition.behavior.completionType === "iterate") {
      return (
        (
          this.definition.behavior.completionConfig as {
            maxIterations?: number;
          }
        ).maxIterations ?? 20
      );
    }
    return 20; // Default max
  }

  /**
   * Process completion signals from action results
   * Updates CompletionHandler state based on detected signals
   */
  private processCompletionSignals(
    ctx: RuntimeContext,
    results: ActionResult[],
  ): void {
    for (const result of results) {
      if (!result.completionSignal) continue;

      const { type } = result.completionSignal;

      // Interface-based check for type safety
      const handler = ctx.completionHandler;

      switch (type) {
        case "phase-advance":
          if ("advancePhase" in handler) {
            (handler as { advancePhase: () => void }).advancePhase();
            ctx.logger.info("Completion signal: phase advanced");
          }
          break;
        case "complete":
          ctx.logger.info("Completion signal: direct complete received");
          break;
      }
    }
  }

  /**
   * Initialize Completion validation system
   *
   * Loads steps_registry.json and creates CompletionValidator and RetryHandler
   * if the registry uses extended format (has completionPatterns or validators).
   */
  private async initializeCompletionValidation(
    agentDir: string,
    cwd: string,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<void> {
    // Load steps_registry.json from agent directory
    const registryPath = join(agentDir, "steps_registry.json");

    try {
      const content = await Deno.readTextFile(registryPath);
      const registry = JSON.parse(content);

      // Check if it's a extended registry
      if (!isExtendedRegistry(registry)) {
        logger.debug(
          "Registry is not extended format, skipping completion validation setup",
        );
        return;
      }

      this.stepsRegistry = registry;
      logger.info(
        "Loaded extended steps registry with completion validation support",
      );

      // Initialize CompletionValidator factory
      const validatorFactory = this.dependencies.completionValidatorFactory;
      if (validatorFactory) {
        if (isInitializable(validatorFactory)) {
          await validatorFactory.initialize();
        }
        this.completionValidator = validatorFactory.create({
          registry: this.stepsRegistry,
          workingDir: cwd,
          logger,
          agentId: this.definition.name,
        });
        logger.debug("CompletionValidator initialized");
      }

      // Initialize RetryHandler factory
      const retryFactory = this.dependencies.retryHandlerFactory;
      if (retryFactory) {
        if (isInitializable(retryFactory)) {
          await retryFactory.initialize();
        }
        this.retryHandler = retryFactory.create({
          registry: this.stepsRegistry,
          workingDir: cwd,
          logger,
          agentId: this.definition.name,
        });
        logger.debug("RetryHandler initialized");
      }

      // Initialize CompletionChain with all validators
      this.completionChain = new CompletionChain({
        workingDir: cwd,
        logger,
        stepsRegistry: this.stepsRegistry,
        completionValidator: this.completionValidator,
        retryHandler: this.retryHandler,
        agentId: this.definition.name,
      });
      logger.debug("CompletionChain initialized");

      // Initialize Closer for AI-based completion judgment
      this.closer = createCloser({
        workingDir: cwd,
        agentId: this.definition.name,
        logger: {
          debug: (msg) => logger.debug(msg),
          info: (msg) => logger.info(msg),
          warn: (msg) => logger.warn(msg),
          error: (msg) => logger.error(msg),
        },
      });
      logger.debug("Closer initialized");
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.debug(
          `Steps registry not found at ${registryPath}, using default completion`,
        );
      } else {
        logger.warn(`Failed to load steps registry: ${error}`);
      }
    }
  }

  /**
   * Validate completion conditions for a step.
   *
   * Called after a close action is detected to verify all conditions are met.
   * Validates using:
   * 1. Structured output query (if outputSchema is defined) - SDK-level validation
   * 2. Fallback to command-based validators (if no outputSchema)
   *
   * Returns retry prompt if validation fails.
   */
  private async validateCompletionConditions(
    stepId: string,
    _summary: IterationSummary,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<CompletionValidationResult> {
    if (!this.stepsRegistry) {
      return { valid: true }; // No validation configured
    }

    // Get step config from extended registry
    const stepConfig = this.stepsRegistry.completionSteps?.[stepId];
    if (!stepConfig) {
      return { valid: true }; // No step config for this step
    }

    logger.info(`Validating completion for step: ${stepId}`);

    // 1. Use structured output query if outputSchema is defined
    if (stepConfig.outputSchema) {
      return await this.validateWithStructuredOutput(stepConfig, logger);
    }

    // 2. Fallback to command-based validation
    if (
      !this.completionValidator ||
      !stepConfig.completionConditions?.length
    ) {
      return { valid: true }; // No completion conditions to check
    }

    // Run completion validators
    const result = await this.completionValidator.validate(
      stepConfig.completionConditions,
    );

    if (result.valid) {
      logger.info("All completion conditions passed");
      return { valid: true };
    }

    logger.warn(`Completion validation failed: pattern=${result.pattern}`);

    // Build retry prompt if RetryHandler is available
    if (this.retryHandler && result.pattern) {
      const retryPrompt = await this.retryHandler.buildRetryPrompt(
        stepConfig,
        result,
      );
      return { valid: false, retryPrompt };
    }

    // Fallback: return generic failure message
    return {
      valid: false,
      retryPrompt: `Completion conditions not met: ${
        result.error ?? result.pattern
      }`,
    };
  }

  /**
   * Validate completion using Closer subsystem.
   *
   * Closer executes a query with C3L prompt that instructs AI to:
   * 1. Analyze current state
   * 2. Identify incomplete items
   * 3. Execute remaining completion work (tests, type check, lint, etc.)
   * 4. Report final status via structured output
   */
  private async validateWithStructuredOutput(
    _stepConfig: CompletionStepConfig,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<CompletionValidationResult> {
    const ctx = this.getContext();

    logger.info("[Closer] Running completion validation");

    // Closer must be initialized
    if (!this.closer) {
      logger.warn("[Closer] Not initialized, falling back to valid");
      return { valid: true };
    }

    try {
      // Create CloserQueryFn wrapper around SDK query
      const queryFn = await this.createCloserQueryFn(ctx, logger);

      // Call closer with current context
      const result = await this.closer.check(
        {
          structuredOutput: {}, // Current context (closer prompt does the work)
          stepId: "complete.issue",
          c3l: { c2: "complete", c3: "issue" },
        },
        queryFn,
      );

      if (result.complete) {
        logger.info("[Closer] Completion verified", {
          summary: result.output.summary,
        });
        return { valid: true };
      }

      // Build retry prompt from pending actions
      const retryPrompt = this.buildCloserRetryPrompt(result);
      logger.warn("[Closer] Completion not achieved", {
        summary: result.output.summary,
        pendingActions: result.output.pendingActions,
      });

      return { valid: false, retryPrompt };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("[Closer] Validation failed", { error: errorMessage });
      return {
        valid: false,
        retryPrompt: `Completion validation failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Create CloserQueryFn wrapper for SDK query.
   *
   * Converts SDK async iterator to Promise-based interface expected by Closer.
   */
  private async createCloserQueryFn(
    ctx: RuntimeContext,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<CloserQueryFn> {
    // Dynamic import of Claude Code SDK
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    return async (
      prompt: string,
      options: { outputSchema: Record<string, unknown> },
    ) => {
      const queryOptions: Record<string, unknown> = {
        cwd: ctx.cwd,
        allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
        permissionMode: "auto",
        outputFormat: {
          type: "json_schema",
          schema: options.outputSchema,
        },
      };

      try {
        const queryIterator = query({ prompt, options: queryOptions });

        for await (const message of queryIterator) {
          ctx.logger.logSdkMessage(message);

          if (!isRecord(message)) continue;

          if (message.type === "result") {
            if (
              message.subtype === "success" &&
              isRecord(message.structured_output)
            ) {
              return { structuredOutput: message.structured_output };
            } else if (
              message.subtype === "error_max_structured_output_retries"
            ) {
              return { error: "Could not produce valid structured output" };
            }
          }
        }

        return { error: "No structured output received" };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error("[CloserQueryFn] Query failed", { error: errorMessage });
        return { error: errorMessage };
      }
    };
  }

  /**
   * Build retry prompt from Closer result.
   */
  private buildCloserRetryPrompt(
    result: import("../closer/types.ts").CloserResult,
  ): string {
    const { output } = result;
    const lines: string[] = ["Completion validation failed:"];

    // Add incomplete checklist items
    const incomplete = output.checklist.filter((item) => !item.completed);
    if (incomplete.length > 0) {
      lines.push("\nIncomplete items:");
      for (const item of incomplete) {
        lines.push(`- ${item.description}`);
        if (item.evidence) {
          lines.push(`  Evidence: ${item.evidence}`);
        }
      }
    }

    // Add pending actions
    if (output.pendingActions && output.pendingActions.length > 0) {
      lines.push("\nRequired actions:");
      for (const action of output.pendingActions) {
        lines.push(`- ${action}`);
      }
    }

    // Add summary
    if (output.summary) {
      lines.push(`\nSummary: ${output.summary}`);
    }

    return lines.join("\n");
  }

  /**
   * Build retry prompt for format validation failure
   */
  private buildFormatRetryPrompt(
    check: StepCheckConfig,
    error: string,
  ): string {
    // If retryPrompt config is defined, could use C3L to load template
    // For now, return a generic retry prompt
    const format = check.responseFormat;
    let formatDescription = "";

    if (format.type === "action-block" && format.blockType) {
      formatDescription =
        `Expected format: \`\`\`${format.blockType}\n{...}\n\`\`\``;
      if (format.requiredFields) {
        const fields = Object.entries(format.requiredFields)
          .map(([k, v]) => `"${k}": ${JSON.stringify(v)}`)
          .join(", ");
        formatDescription += `\nRequired fields: { ${fields} }`;
      }
    } else if (format.type === "json") {
      formatDescription = "Expected format: JSON block";
    } else if (format.type === "text-pattern" && format.pattern) {
      formatDescription = `Expected pattern: ${format.pattern}`;
    }

    return `The response format was invalid: ${error}

${formatDescription}

Please provide a response in the correct format.`;
  }

  /**
   * Check if AI declared completion via structured output.
   *
   * Checks for:
   * - status === "completed"
   * - next_action.action === "complete"
   *
   * This replaces the issue-action dependency for triggering completion validation.
   */
  private hasAICompletionDeclaration(summary: IterationSummary): boolean {
    if (!summary.structuredOutput) {
      return false;
    }

    const so = summary.structuredOutput;

    // Check status field
    if (so.status === "completed") {
      return true;
    }

    // Check next_action.action field
    if (isRecord(so.next_action)) {
      const nextAction = so.next_action as Record<string, unknown>;
      if (nextAction.action === "complete") {
        return true;
      }
    }

    return false;
  }

  /**
   * Get completion step ID based on completion type.
   * Delegates to CompletionChain when available.
   */
  private getCompletionStepId(): string {
    if (this.completionChain) {
      return this.completionChain.getCompletionStepId(
        this.definition.behavior.completionType,
      );
    }
    // Fallback
    return "complete.issue";
  }

  /**
   * Delay execution for a specified duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get step ID for a given iteration.
   *
   * Maps iteration number to step ID based on completionType from agent definition.
   * The completionType defines "what completion means" for this agent.
   *
   * Step ID format:
   * - iteration 1: initial.{completionType}
   * - iteration 2+: continuation.{completionType}
   */
  private getStepIdForIteration(iteration: number): string {
    const completionType = this.definition.behavior.completionType;
    const prefix = iteration === 1 ? "initial" : "continuation";
    return `${prefix}.${completionType}`;
  }

  /**
   * Load JSON Schema for a step from outputSchemaRef.
   *
   * Looks up the step in the registry, then loads the schema from the
   * external file specified in outputSchemaRef.
   *
   * @param stepId - Step identifier (e.g., "initial.issue")
   * @param logger - Logger instance
   * @returns Loaded schema or undefined if not available
   */
  private async loadSchemaForStep(
    stepId: string,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.stepsRegistry) {
      return undefined;
    }

    // Look up step definition in registry
    const stepDef = this.stepsRegistry.steps[stepId] as
      | PromptStepDefinition
      | undefined;
    if (!stepDef?.outputSchemaRef) {
      logger.debug(`No outputSchemaRef for step: ${stepId}`);
      return undefined;
    }

    return await this.loadSchemaFromRef(stepDef.outputSchemaRef, logger);
  }

  /**
   * Load schema from outputSchemaRef with full $ref resolution.
   *
   * This method resolves all $ref pointers (both internal and external)
   * and ensures additionalProperties: false is set on all object types,
   * as required by Claude SDK's structured output feature.
   *
   * @param ref - Schema reference with file and schema name
   * @param logger - Logger instance
   * @returns Fully resolved schema or undefined on error
   */
  private async loadSchemaFromRef(
    ref: OutputSchemaRef,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<Record<string, unknown> | undefined> {
    const ctx = this.getContext();
    const schemasBase = this.stepsRegistry?.schemasBase ??
      `.agent/${this.definition.name}/schemas`;
    const schemasDir = join(ctx.cwd, schemasBase);

    try {
      const resolver = new SchemaResolver(schemasDir);
      const schema = await resolver.resolve(ref.file, ref.schema);

      logger.debug(`Loaded and resolved schema: ${ref.file}#${ref.schema}`);
      return schema;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.debug(`Schema file not found: ${join(schemasDir, ref.file)}`);
      } else {
        logger.warn(`Failed to load schema from ${ref.file}#${ref.schema}`, {
          error: String(error),
        });
      }
      return undefined;
    }
  }
}
