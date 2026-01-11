/**
 * Agent Runner - main execution engine
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
import { RuntimeContextNotInitializedError } from "../src_common/types.ts";
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
      throw new RuntimeContextNotInitializedError();
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
        });
      } else {
        // Fallback to direct instantiation if no factory provided
        actionDetector = new ActionDetector(this.definition.actions);
        actionExecutor = new ActionExecutor(this.definition.actions, {
          agentName: this.definition.name,
          logger,
          cwd,
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

    const { args: _args, plugins = [] } = options;
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
          ctx.logger.warn(`Max iterations (${maxIterations}) reached`);
          break;
        }
      }

      const result: AgentResult = {
        success: true,
        totalIterations: iteration,
        summaries,
        completionReason: await ctx.completionHandler
          .getCompletionDescription(),
      };

      // Emit completed event
      await this.eventEmitter.emit("completed", { result });

      return result;
    } catch (error) {
      const errorObj = error instanceof Error
        ? error
        : new Error(String(error));
      const errorMessage = errorObj.message;
      ctx.logger.error("Agent failed", { error: errorMessage });

      // Emit error event
      await this.eventEmitter.emit("error", {
        error: errorObj,
        recoverable: false,
      });

      return {
        success: false,
        totalIterations: iteration,
        summaries,
        completionReason: "Error occurred",
        error: errorMessage,
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
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      summary.errors.push(errorMessage);
      ctx.logger.error("Query execution failed", { error: errorMessage });
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
}
