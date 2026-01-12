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
import {
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  isAgentError,
  normalizeToAgentError,
} from "./errors.ts";
import { ActionDetector } from "../actions/detector.ts";
import { ActionExecutor } from "../actions/executor.ts";
import { getAgentDir } from "./loader.ts";
import { mergeSandboxConfig, toSdkSandboxConfig } from "./sandbox-defaults.ts";
import type { AgentDependencies } from "./builder.ts";
import {
  createDefaultDependencies,
  DefaultActionSystemFactory,
  DefaultCompletionValidatorFactory,
  DefaultRetryHandlerFactory,
} from "./builder.ts";
import type { CompletionValidator } from "../validators/completion/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import {
  isRegistryV3,
  type StepsRegistryV3,
} from "../common/completion-types.ts";
import { join } from "@std/path";
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

export class AgentRunner {
  private readonly definition: AgentDefinition;
  private readonly dependencies: AgentDependencies;
  private readonly eventEmitter: AgentEventEmitter;
  private context: RuntimeContext | null = null;

  // V3 completion validation
  private completionValidator: CompletionValidator | null = null;
  private retryHandler: RetryHandler | null = null;
  private stepsRegistry: StepsRegistryV3 | null = null;
  private pendingRetryPrompt: string | null = null;

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
        // Ensure the factory is initialized if it's the default one
        if (actionFactory instanceof DefaultActionSystemFactory) {
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

    // Initialize V3 completion validation if registry supports it
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

        // Execute Claude SDK query
        // deno-lint-ignore no-await-in-loop
        const summary = await this.executeQuery({
          prompt,
          systemPrompt,
          plugins,
          sessionId,
          iteration,
        });

        // Emit queryExecuted event
        // deno-lint-ignore no-await-in-loop
        await this.eventEmitter.emit("queryExecuted", { summary });

        summaries.push(summary);
        sessionId = summary.sessionId;

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

          // V3 completion validation: validate conditions after close action
          if (this.hasCloseAction(summary.actionResults)) {
            const stepId = this.getCompletionStepId();
            // deno-lint-ignore no-await-in-loop
            const validation = await this.validateCompletionConditions(
              stepId,
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
        }

        // Check completion
        // If there's a pending retry prompt, completion conditions failed - don't complete yet
        let isComplete: boolean;
        if (this.pendingRetryPrompt) {
          isComplete = false;
          ctx.logger.debug("Skipping completion check due to pending retry");
        } else {
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

      const completionReason = await ctx.completionHandler
        .getCompletionDescription();
      const result: AgentResult = {
        success: true,
        // v2 fields
        iterations: iteration,
        reason: completionReason,
        // deprecated fields (for backward compatibility)
        totalIterations: iteration,
        completionReason,
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
        // v2 fields
        iterations: iteration,
        reason: errorReason,
        // deprecated fields (for backward compatibility)
        totalIterations: iteration,
        completionReason: "Error occurred",
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
  }): Promise<IterationSummary> {
    const { prompt, systemPrompt, plugins, sessionId, iteration } = options;
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

      const queryIterator = query({
        prompt,
        options: queryOptions,
      });

      for await (const message of queryIterator) {
        ctx.logger.logSdkMessage(message);
        this.processMessage(message, summary);
      }
    } catch (error) {
      const queryError = new AgentQueryError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error instanceof Error ? error : undefined,
          iteration,
        },
      );
      summary.errors.push(queryError.message);
      ctx.logger.error("Query execution failed", {
        error: queryError.message,
        code: queryError.code,
        iteration: queryError.iteration,
      });
    }

    return summary;
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
    } else if (isErrorMessage(message)) {
      summary.errors.push(message.error.message ?? "Unknown error");
    }
    // Unknown message types are silently ignored (defensive)
  }

  private extractContent(message: unknown): string {
    if (typeof message === "string") {
      return message;
    }
    if (typeof message === "object" && message !== null) {
      const msg = message as Record<string, unknown>;
      if (typeof msg.content === "string") {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((c) =>
            typeof c === "object" && c !== null &&
            (c as Record<string, unknown>).type === "text"
          )
          .map((c) => (c as Record<string, unknown>).text as string)
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
        ).maxIterations ?? 100
      );
    }
    return 100; // Default max
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
   * Initialize V3 completion validation system
   *
   * Loads steps_registry.json and creates CompletionValidator and RetryHandler
   * if the registry uses V3 format (has completionPatterns or validators).
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

      // Check if it's a V3 registry
      if (!isRegistryV3(registry)) {
        logger.debug(
          "Registry is not V3 format, skipping completion validation setup",
        );
        return;
      }

      this.stepsRegistry = registry;
      logger.info(
        "Loaded V3 steps registry with completion validation support",
      );

      // Initialize CompletionValidator factory
      const validatorFactory = this.dependencies.completionValidatorFactory;
      if (validatorFactory) {
        if (validatorFactory instanceof DefaultCompletionValidatorFactory) {
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
        if (retryFactory instanceof DefaultRetryHandlerFactory) {
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
   * Validate completion conditions for a step
   *
   * Called after a close action is detected to verify all conditions are met.
   * Returns retry prompt if validation fails.
   */
  private async validateCompletionConditions(
    stepId: string,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<{ valid: boolean; retryPrompt?: string }> {
    if (!this.completionValidator || !this.stepsRegistry) {
      return { valid: true }; // No V3 validation configured
    }

    // Get step config from V3 registry
    const stepConfig = this.stepsRegistry.stepsV3?.[stepId];
    if (!stepConfig || !stepConfig.completionConditions?.length) {
      return { valid: true }; // No completion conditions for this step
    }

    logger.info(`Validating completion conditions for step: ${stepId}`);

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
   * Check if any action result indicates a close action
   */
  private hasCloseAction(results: ActionResult[]): boolean {
    return results.some((r) =>
      r.action?.type === "issue-action" &&
      (r.action as { action?: string }).action === "close"
    );
  }

  /**
   * Get completion step ID based on completion type
   */
  private getCompletionStepId(): string {
    // For issue-based completion, use "complete.issue"
    if (this.definition.behavior.completionType === "issue") {
      return "complete.issue";
    }
    // Default fallback
    return "complete.issue";
  }
}
