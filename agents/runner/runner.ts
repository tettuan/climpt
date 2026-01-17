/**
 * Agent Runner - main execution engine
 *
 * Dual-loop architecture:
 * - Flow Loop: Step advancement and handoff management
 * - Completion Loop: Validates completion conditions
 *
 * Supports dependency injection for testability.
 * Use AgentRunnerBuilder for convenient construction with custom dependencies.
 */

import type {
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
import { getAgentDir } from "./loader.ts";
import { mergeSandboxConfig, toSdkSandboxConfig } from "./sandbox-defaults.ts";
import type { AgentDependencies } from "./builder.ts";
import { createDefaultDependencies, isInitializable } from "./builder.ts";
import type { CompletionValidator } from "../validators/completion/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import {
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
import { StepContextImpl } from "../loop/step-context.ts";
import type { StepContext } from "../src_common/contracts.ts";

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
  private pendingRetryPrompt: string | null = null;
  private readonly formatValidator = new FormatValidator();
  private formatRetryCount = 0;

  // Rate limit handling
  private rateLimitRetryCount = 0;
  private static readonly MAX_RATE_LIMIT_RETRIES = 5;

  // Step flow orchestration
  private stepContext: StepContextImpl | null = null;
  private currentStepId: string | null = null;

  /**
   * Create an AgentRunner with optional dependency injection.
   */
  constructor(definition: AgentDefinition, dependencies?: AgentDependencies) {
    this.definition = definition;
    this.dependencies = dependencies ?? createDefaultDependencies();
    this.eventEmitter = new AgentEventEmitter();
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
      },
    );

    // Initialize Completion validation if registry supports it
    await this.initializeCompletionValidation(agentDir, cwd, logger);

    // Assign all context at once (atomic initialization)
    this.context = {
      completionHandler,
      promptResolver,
      logger,
      cwd,
    };
  }

  async run(options: RunnerOptions): Promise<AgentResult> {
    await this.initialize(options);

    const { plugins = [] } = options;
    const ctx = this.getContext();

    // Initialize step context for step flow orchestration
    this.stepContext = new StepContextImpl();
    this.currentStepId = this.getStepIdForIteration(1);

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

        // Build prompt
        const lastSummary = summaries.length > 0
          ? summaries[summaries.length - 1]
          : undefined;
        let prompt: string;
        if (this.pendingRetryPrompt) {
          prompt = this.pendingRetryPrompt;
          this.pendingRetryPrompt = null;
          ctx.logger.debug("Using retry prompt from completion validation");
        } else if (iteration === 1) {
          // deno-lint-ignore no-await-in-loop
          prompt = await ctx.completionHandler.buildInitialPrompt();
        } else {
          // deno-lint-ignore no-await-in-loop
          prompt = await ctx.completionHandler.buildContinuationPrompt(
            iteration - 1,
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

        // Record step output for step flow orchestration
        this.recordStepOutput(stepId, summary);

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
        if (this.hasAICompletionDeclaration(summary)) {
          const completionStepId = this.getCompletionStepId();
          ctx.logger.info(
            "AI declared completion, validating external conditions",
          );
          // deno-lint-ignore no-await-in-loop
          const validation = await this.validateCompletionConditions(
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

        // Check completion
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
          ctx.logger.info(
            `Agent completed after ${iteration} iteration(s): ${completionReason}`,
          );
          break;
        }

        // Step transition for step flow orchestration
        this.handleStepTransition(stepId, summary, ctx);

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

      // Configure sandbox
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
          throw rateLimitError;
        }

        const waitTime = calculateBackoff(this.rateLimitRetryCount - 1);
        ctx.logger.warn(
          `Rate limit hit, waiting ${waitTime}ms before retry ` +
            `(attempt ${this.rateLimitRetryCount}/${AgentRunner.MAX_RATE_LIMIT_RETRIES})`,
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

    // Format validation
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
      this.formatRetryCount = 0;
    }

    await Promise.resolve();
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
    return 20;
  }

  /**
   * Initialize Completion validation system
   */
  private async initializeCompletionValidation(
    agentDir: string,
    cwd: string,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<void> {
    const registryPath = join(agentDir, "steps_registry.json");

    try {
      const content = await Deno.readTextFile(registryPath);
      const registry = JSON.parse(content);

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

      // Initialize CompletionChain
      this.completionChain = new CompletionChain({
        workingDir: cwd,
        logger,
        stepsRegistry: this.stepsRegistry,
        completionValidator: this.completionValidator,
        retryHandler: this.retryHandler,
        agentId: this.definition.name,
      });
      logger.debug("CompletionChain initialized");
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
   */
  private async validateCompletionConditions(
    stepId: string,
    _summary: IterationSummary,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<CompletionValidationResult> {
    if (!this.stepsRegistry) {
      return { valid: true };
    }

    const stepConfig = this.stepsRegistry.completionSteps?.[stepId];
    if (!stepConfig) {
      return { valid: true };
    }

    // Use CompletionChain for validation (logs internally)
    if (this.completionChain) {
      return await this.completionChain.validate(stepId, _summary);
    }

    // Fallback path - log here since CompletionChain is not used
    logger.info(`Validating completion for step: ${stepId}`);

    // Fallback to command-based validation
    if (
      !this.completionValidator ||
      !stepConfig.completionConditions?.length
    ) {
      return { valid: true };
    }

    const result = await this.completionValidator.validate(
      stepConfig.completionConditions,
    );

    if (result.valid) {
      logger.info("All completion conditions passed");
      return { valid: true };
    }

    logger.warn(`Completion validation failed: pattern=${result.pattern}`);

    if (this.retryHandler && result.pattern) {
      const retryPrompt = await this.retryHandler.buildRetryPrompt(
        stepConfig,
        result,
      );
      return { valid: false, retryPrompt };
    }

    return {
      valid: false,
      retryPrompt: `Completion conditions not met: ${
        result.error ?? result.pattern
      }`,
    };
  }

  /**
   * Build retry prompt for format validation failure
   */
  private buildFormatRetryPrompt(
    check: StepCheckConfig,
    error: string,
  ): string {
    const format = check.responseFormat;
    let formatDescription = "";

    if (format.type === "json") {
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
   */
  private hasAICompletionDeclaration(summary: IterationSummary): boolean {
    if (!summary.structuredOutput) {
      return false;
    }

    const so = summary.structuredOutput;

    if (so.status === "completed") {
      return true;
    }

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
   */
  private getCompletionStepId(): string {
    if (this.completionChain) {
      return this.completionChain.getCompletionStepId(
        this.definition.behavior.completionType,
      );
    }
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
   */
  private getStepIdForIteration(iteration: number): string {
    const completionType = this.definition.behavior.completionType;
    const prefix = iteration === 1 ? "initial" : "continuation";
    return `${prefix}.${completionType}`;
  }

  /**
   * Load JSON Schema for a step from outputSchemaRef.
   */
  private async loadSchemaForStep(
    stepId: string,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.stepsRegistry) {
      return undefined;
    }

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

  // ============================================================================
  // Step Flow Orchestration
  // ============================================================================

  /**
   * Get the step context for data passing between steps.
   */
  getStepContext(): StepContext | null {
    return this.stepContext;
  }

  /**
   * Record step output to step context.
   */
  private recordStepOutput(stepId: string, summary: IterationSummary): void {
    if (!this.stepContext) return;

    const output: Record<string, unknown> = {};

    if (summary.structuredOutput) {
      Object.assign(output, summary.structuredOutput);
    }

    output.iteration = summary.iteration;
    output.sessionId = summary.sessionId;

    if (summary.errors.length > 0) {
      output.hasErrors = true;
      output.errorCount = summary.errors.length;
    }

    this.stepContext.set(stepId, output);
    this.currentStepId = stepId;

    this.getContext().logger.debug(
      `[StepFlow] Recorded output for step: ${stepId}`,
      { outputKeys: Object.keys(output) },
    );
  }

  /**
   * Handle step transition based on completion handler.
   */
  private handleStepTransition(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): void {
    const handler = ctx.completionHandler;

    if (
      !("transition" in handler) || typeof handler.transition !== "function"
    ) {
      return;
    }

    const passed = this.determineStepPassed(summary);

    const stepResult = {
      stepId,
      passed,
      reason: this.extractStepReason(summary),
    };

    const nextStep =
      (handler as { transition: (r: typeof stepResult) => string | "complete" })
        .transition(stepResult);

    if (nextStep === "complete") {
      ctx.logger.info(`[StepFlow] Step machine reached terminal state`);
    } else if (nextStep !== stepId) {
      ctx.logger.info(`[StepFlow] Transitioning from ${stepId} to ${nextStep}`);
      this.currentStepId = nextStep;
    } else {
      ctx.logger.debug(`[StepFlow] Staying on step ${stepId} (retry)`);
    }
  }

  /**
   * Determine if step passed based on iteration summary.
   */
  private determineStepPassed(summary: IterationSummary): boolean {
    if (summary.structuredOutput) {
      const so = summary.structuredOutput;

      if (so.status === "completed" || so.status === "passed") {
        return true;
      }
      if (so.status === "failed" || so.status === "error") {
        return false;
      }

      if (so.result === "ok" || so.result === "pass" || so.result === true) {
        return true;
      }
      if (so.result === "ng" || so.result === "fail" || so.result === false) {
        return false;
      }
    }

    return summary.errors.length === 0;
  }

  /**
   * Extract reason from iteration summary for step transition.
   */
  private extractStepReason(summary: IterationSummary): string | undefined {
    if (summary.structuredOutput) {
      const so = summary.structuredOutput as Record<string, unknown>;
      if (typeof so.reason === "string") {
        return so.reason;
      }
      if (typeof so.message === "string") {
        return so.message;
      }
    }

    if (summary.errors.length > 0) {
      return summary.errors[0];
    }

    return undefined;
  }
}
