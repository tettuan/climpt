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
  type CompletionStepConfig,
  type ExtendedStepsRegistry,
  isExtendedRegistry,
  type StepCheckConfig,
} from "../common/completion-types.ts";
import {
  type FormatValidationResult,
  FormatValidator,
} from "../loop/format-validator.ts";
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

/**
 * Result of completion validation
 */
export interface CompletionValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Retry prompt if validation failed */
  retryPrompt?: string;
  /** Format validation result (if applicable) */
  formatValidation?: FormatValidationResult;
}

export class AgentRunner {
  private readonly definition: AgentDefinition;
  private readonly dependencies: AgentDependencies;
  private readonly eventEmitter: AgentEventEmitter;
  private context: RuntimeContext | null = null;

  // Completion validation
  private completionValidator: CompletionValidator | null = null;
  private retryHandler: RetryHandler | null = null;
  private stepsRegistry: ExtendedStepsRegistry | null = null;
  private pendingRetryPrompt: string | null = null;
  private readonly formatValidator = new FormatValidator();
  private formatRetryCount = 0;

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

          // Completion validation: validate conditions after close action
          if (this.hasCloseAction(summary.actionResults)) {
            const stepId = this.getCompletionStepId();
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
   * Validate completion using structured output query.
   *
   * Executes a query with outputFormat to get validated JSON response.
   * The agent runs validation checks (git status, type check) and
   * returns results in the schema-defined format.
   */
  private async validateWithStructuredOutput(
    stepConfig: CompletionStepConfig,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<CompletionValidationResult> {
    const ctx = this.getContext();

    logger.info("[StructuredOutput] Running validation query with schema");

    try {
      // Dynamic import of Claude Code SDK
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const prompt = this.buildValidationPrompt();

      const queryOptions: Record<string, unknown> = {
        cwd: ctx.cwd,
        allowedTools: ["Bash", "Read"],
        permissionMode: "auto",
        outputFormat: {
          type: "json_schema",
          schema: stepConfig.outputSchema,
        },
      };

      let structuredOutput: Record<string, unknown> | undefined;
      let queryError: string | undefined;

      const queryIterator = query({
        prompt,
        options: queryOptions,
      });

      for await (const message of queryIterator) {
        ctx.logger.logSdkMessage(message);

        const msg = message as Record<string, unknown>;

        if (msg.type === "result") {
          if (msg.subtype === "success" && msg.structured_output) {
            structuredOutput = msg.structured_output as Record<string, unknown>;
            logger.info("[StructuredOutput] Got validation result");
          } else if (msg.subtype === "error_max_structured_output_retries") {
            queryError = "Could not produce valid validation output";
            logger.error("[StructuredOutput] Failed to produce valid output");
          }
        }
      }

      if (!structuredOutput) {
        return {
          valid: false,
          retryPrompt: queryError ?? "Validation query failed",
        };
      }

      // Check validation results from structured output
      return this.checkValidationResults(structuredOutput, logger);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("[StructuredOutput] Query failed", { error: errorMessage });
      return {
        valid: false,
        retryPrompt: `Validation query failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Build the prompt for validation query
   */
  private buildValidationPrompt(): string {
    return `Run the following validation checks and report the results:

1. **Git status**: Run \`git status --porcelain\` to check for uncommitted changes
   - Set git_clean to true only if the output is empty
   - Include the actual output in evidence.git_status_output

2. **Type check**: Run \`deno task check\` or \`deno check\`
   - Set type_check_passed to true only if exit code is 0
   - Include relevant output in evidence.type_check_output

Report your findings in the required JSON format with:
- validation.git_clean: boolean
- validation.type_check_passed: boolean
- evidence: actual command outputs`;
  }

  /**
   * Check validation results from structured output
   */
  private checkValidationResults(
    output: Record<string, unknown>,
    logger: import("../src_common/logger.ts").Logger,
  ): CompletionValidationResult {
    const validation = output.validation as Record<string, boolean> | undefined;

    if (!validation) {
      return {
        valid: false,
        retryPrompt: "Missing validation field in response",
      };
    }

    const errors: string[] = [];

    // Check required fields
    if (validation.git_clean !== true) {
      errors.push(
        "git_clean is false - please commit or stash changes before closing",
      );
    }

    if (validation.type_check_passed !== true) {
      errors.push("type_check_passed is false - please fix type errors");
    }

    // Check optional fields (only fail if explicitly false)
    if (validation.tests_passed === false) {
      errors.push("tests_passed is false - please fix failing tests");
    }

    if (validation.lint_passed === false) {
      errors.push("lint_passed is false - please fix lint errors");
    }

    if (validation.format_check_passed === false) {
      errors.push("format_check_passed is false - please run formatter");
    }

    if (errors.length > 0) {
      logger.warn("[StructuredOutput] Validation failed", { errors });
      return {
        valid: false,
        retryPrompt: `Completion validation failed:\n${
          errors.map((e) => `- ${e}`).join("\n")
        }`,
      };
    }

    logger.info("[StructuredOutput] All validation checks passed");
    return { valid: true };
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
   * Check if any action result indicates a close action
   *
   * IssueActionHandler returns ActionResult with:
   * - action.type === "issue-action"
   * - result: { action: "close", issue: number, closed: boolean }
   */
  private hasCloseAction(results: ActionResult[]): boolean {
    return results.some((r) => {
      if (r.action?.type !== "issue-action") return false;

      // Check if result contains a close action
      // IssueActionHandler sets result.action = "close" for close actions
      const result = r.result as { action?: string } | undefined;
      return result?.action === "close";
    });
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
