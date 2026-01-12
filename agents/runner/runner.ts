/**
 * Agent Runner - main execution engine
 *
 * Supports both legacy iteration-based execution and flow-based execution.
 * Flow-based execution is used when:
 * 1. useFlowLoop option is true
 * 2. Agent has a steps_registry.json with flow definitions
 *
 * This enables:
 * - Structured step execution (work -> validate -> complete)
 * - Pre-close commit validation through validate step
 * - Issue close only after commits are ensured
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
} from "./builder.ts";
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
import {
  createStepPromptBuilder,
  FlowAgentLoop,
  type FlowLoopContext,
} from "../loop/flow-agent-loop.ts";
import type { SdkMessage } from "../bridge/sdk-bridge.ts";
import { loadStepRegistry } from "../common/step-registry.ts";
import type {
  CheckContext,
  CompletionContract,
} from "../src_common/contracts.ts";

export interface RunnerOptions {
  /** Working directory */
  cwd?: string;
  /** CLI arguments passed to the agent */
  args: Record<string, unknown>;
  /** Additional plugins to load */
  plugins?: string[];
  /**
   * Use flow-based execution with FlowAgentLoop.
   * When true, uses step registry flow definitions for structured execution.
   * When false or undefined, uses legacy iteration-based execution.
   * Default: auto-detect based on steps_registry.json presence
   */
  useFlowLoop?: boolean;
  /**
   * Flow mode to use (e.g., "issue", "project").
   * Required when useFlowLoop is true.
   * Default: "issue"
   */
  flowMode?: string;
}

export class AgentRunner {
  private readonly definition: AgentDefinition;
  private readonly dependencies: AgentDependencies;
  private readonly eventEmitter: AgentEventEmitter;
  private context: RuntimeContext | null = null;

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

    const { args, plugins = [] } = options;
    const ctx = this.getContext();

    // Emit initialized event
    await this.eventEmitter.emit("initialized", { cwd: ctx.cwd });

    ctx.logger.info(`Starting agent: ${this.definition.displayName}`);

    // Determine execution mode: flow-based or legacy
    const useFlow = await this.shouldUseFlowLoop(options, ctx.cwd);
    if (useFlow) {
      return this.runWithFlowLoop(options, plugins, ctx, args);
    }

    // Legacy execution path
    return this.runLegacy(options, plugins, ctx);
  }

  /**
   * Determine if flow-based execution should be used.
   */
  private async shouldUseFlowLoop(
    options: RunnerOptions,
    _cwd: string,
  ): Promise<boolean> {
    // Explicit option takes precedence
    if (options.useFlowLoop !== undefined) {
      return options.useFlowLoop;
    }

    // Auto-detect: check if steps_registry.json exists with flow definitions
    try {
      const registry = await loadStepRegistry(
        this.definition.name,
        ".",
        { registryPath: `.agent/${this.definition.name}/steps_registry.json` },
      );
      const mode = options.flowMode ?? "issue";
      return registry.flow?.[mode] !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Run with FlowAgentLoop for structured step-based execution.
   * Ensures steps execute in order: work -> validate -> complete
   * The validate step ensures commits are made before issue close.
   */
  private async runWithFlowLoop(
    options: RunnerOptions,
    plugins: string[],
    ctx: RuntimeContext,
    args: Record<string, unknown>,
  ): Promise<AgentResult> {
    const mode = options.flowMode ?? "issue";
    ctx.logger.info(`Using flow-based execution (mode: ${mode})`);

    try {
      // Load step registry
      const registry = await loadStepRegistry(
        this.definition.name,
        ".",
        { registryPath: `.agent/${this.definition.name}/steps_registry.json` },
      );

      // Create completion handler adapter for CompletionContract
      const completionContract = this.createCompletionContract(ctx);

      // Create flow loop context
      const flowContext: FlowLoopContext = {
        definition: this.definition,
        cwd: ctx.cwd,
        args,
        completionHandler: completionContract,
        buildSystemPrompt: () => {
          return ctx.promptResolver.resolveSystemPrompt({
            "uv-agent_name": this.definition.name,
            "uv-completion_criteria":
              ctx.completionHandler.buildCompletionCriteria().detailed,
          });
        },
        buildStepPrompt: createStepPromptBuilder({
          resolve: (
            stepId: string,
            variables: Record<string, string>,
          ) => {
            return ctx.promptResolver.resolve(stepId, variables);
          },
        }),
        registry,
      };

      // Create query function for FlowAgentLoop
      const queryFn = this.createQueryFunction(plugins, ctx);

      // Execute flow
      const flowLoop = new FlowAgentLoop();
      const flowResult = await flowLoop.executeWithFlow(
        flowContext,
        queryFn,
        {
          agentId: this.definition.name,
          mode,
        },
      );

      // Convert FlowLoopResult to AgentResult
      const result: AgentResult = {
        success: flowResult.success,
        iterations: flowResult.iterations,
        reason: flowResult.reason,
        totalIterations: flowResult.iterations,
        completionReason: flowResult.reason,
        summaries: flowResult.summaries,
      };

      // Emit completed event
      await this.eventEmitter.emit("completed", { result });

      ctx.logger.info(
        `Flow execution completed: ${flowResult.stepsExecuted.join(" -> ")}`,
      );

      return result;
    } catch (error) {
      const agentError = normalizeToAgentError(error, { iteration: 0 });
      ctx.logger.error("Flow execution failed", {
        error: agentError.message,
        code: agentError.code,
      });

      return {
        success: false,
        iterations: 0,
        reason: agentError.message,
        totalIterations: 0,
        completionReason: "Flow execution error",
        summaries: [],
        error: agentError.message,
      };
    } finally {
      await ctx.logger.close();
    }
  }

  /**
   * Create a CompletionContract adapter from the legacy completion handler.
   */
  private createCompletionContract(_ctx: RuntimeContext): CompletionContract {
    return {
      check: (_checkContext: CheckContext) => {
        // Use the legacy completion handler's state
        // Note: This is a sync wrapper, actual check happens via isComplete()
        return { complete: false };
      },
      transition: () => "continue" as const,
    };
  }

  /**
   * Create a query function for FlowAgentLoop.
   */
  private createQueryFunction(
    plugins: string[],
    ctx: RuntimeContext,
  ): (
    prompt: string,
    systemPrompt: string,
    sessionId?: string,
  ) => AsyncIterable<SdkMessage> {
    const definition = this.definition;
    const normalizeMsg = this.normalizeToSdkMessage.bind(this);
    return async function* (
      prompt: string,
      systemPrompt: string,
      sessionId?: string,
    ): AsyncIterable<SdkMessage> {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const queryOptions: Record<string, unknown> = {
        cwd: ctx.cwd,
        systemPrompt,
        allowedTools: definition.behavior.allowedTools,
        permissionMode: definition.behavior.permissionMode,
        settingSources: ["user", "project"],
        plugins,
        resume: sessionId,
      };

      // Configure sandbox
      const sandboxConfig = mergeSandboxConfig(
        definition.behavior.sandboxConfig,
      );
      if (sandboxConfig.enabled === false) {
        queryOptions.dangerouslySkipPermissions = true;
      } else {
        queryOptions.sandbox = toSdkSandboxConfig(sandboxConfig);
      }

      const queryIterator = query({ prompt, options: queryOptions });

      for await (const message of queryIterator) {
        ctx.logger.logSdkMessage(message);

        // Normalize message to SdkMessage format
        yield normalizeMsg(message);
      }
    };
  }

  /**
   * Normalize SDK message to SdkMessage type.
   */
  private normalizeToSdkMessage(message: unknown): SdkMessage {
    if (isAssistantMessage(message)) {
      return { type: "assistant", message: message.message } as SdkMessage;
    }
    if (isToolUseMessage(message)) {
      return { type: "tool_use", tool_name: message.tool_name } as SdkMessage;
    }
    if (isResultMessage(message)) {
      return { type: "result", session_id: message.session_id } as SdkMessage;
    }
    if (isErrorMessage(message)) {
      return { type: "error", error: message.error } as SdkMessage;
    }
    return { type: "unknown", raw: message } as SdkMessage;
  }

  /**
   * Legacy iteration-based execution.
   */
  private async runLegacy(
    _options: RunnerOptions,
    plugins: string[],
    ctx: RuntimeContext,
  ): Promise<AgentResult> {
    ctx.logger.info("Using legacy iteration-based execution");

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

        // Build prompt
        const lastSummary = summaries.length > 0
          ? summaries[summaries.length - 1]
          : undefined;
        const prompt = iteration === 1
          // deno-lint-ignore no-await-in-loop
          ? await ctx.completionHandler.buildInitialPrompt()
          // deno-lint-ignore no-await-in-loop
          : await ctx.completionHandler.buildContinuationPrompt(
            iteration - 1, // completedIterations
            lastSummary,
          );

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
        }

        // Check completion
        // deno-lint-ignore no-await-in-loop
        const isComplete = await ctx.completionHandler.isComplete();
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
}
