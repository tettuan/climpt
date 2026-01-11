/**
 * Agent Runner - main execution engine
 */

import type {
  AgentDefinition,
  AgentResult,
  IterationSummary,
  RuntimeContext,
} from "../src_common/types.ts";
import { RuntimeContextNotInitializedError } from "../src_common/types.ts";
import { Logger } from "../src_common/logger.ts";
import { createCompletionHandler } from "../completion/mod.ts";
import { PromptResolver } from "../prompts/resolver.ts";
import { ActionDetector } from "../actions/detector.ts";
import { ActionExecutor } from "../actions/executor.ts";
import { getAgentDir } from "./loader.ts";
import { mergeSandboxConfig, toSdkSandboxConfig } from "./sandbox-defaults.ts";

export interface RunnerOptions {
  /** Working directory */
  cwd?: string;
  /** CLI arguments passed to the agent */
  args: Record<string, unknown>;
  /** Additional plugins to load */
  plugins?: string[];
}

export class AgentRunner {
  private definition: AgentDefinition;
  private context: RuntimeContext | null = null;

  constructor(definition: AgentDefinition) {
    this.definition = definition;
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

    // Initialize logger
    const logger = await Logger.create({
      agentName: this.definition.name,
      directory: this.definition.logging.directory,
      format: this.definition.logging.format,
    });

    // Initialize completion handler
    const completionHandler = await createCompletionHandler(
      this.definition,
      options.args,
      agentDir,
    );

    // Initialize prompt resolver
    const promptResolver = await PromptResolver.create({
      agentName: this.definition.name,
      agentDir,
      registryPath: this.definition.prompts.registry,
      fallbackDir: this.definition.prompts.fallbackDir,
    });

    // Initialize action system if enabled
    let actionDetector: ActionDetector | undefined;
    let actionExecutor: ActionExecutor | undefined;
    if (this.definition.actions?.enabled) {
      actionDetector = new ActionDetector(this.definition.actions);
      actionExecutor = new ActionExecutor(this.definition.actions, {
        agentName: this.definition.name,
        logger,
        cwd,
      });
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

    ctx.logger.info(`Starting agent: ${this.definition.displayName}`);

    let iteration = 0;
    let sessionId: string | undefined;
    const summaries: IterationSummary[] = [];

    try {
      // Sequential execution required: each iteration depends on previous results
      while (true) {
        iteration++;
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

        // Execute Claude SDK query
        // deno-lint-ignore no-await-in-loop
        const summary = await this.executeQuery({
          prompt,
          systemPrompt,
          plugins,
          sessionId,
          iteration,
        });

        summaries.push(summary);
        sessionId = summary.sessionId;

        // Execute detected actions
        if (ctx.actionExecutor && summary.detectedActions.length > 0) {
          ctx.actionExecutor.setIteration(iteration);
          // deno-lint-ignore no-await-in-loop
          summary.actionResults = await ctx.actionExecutor.execute(
            summary.detectedActions,
          );
        }

        // Check completion
        // deno-lint-ignore no-await-in-loop
        if (await ctx.completionHandler.isComplete()) {
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

      return {
        success: true,
        totalIterations: iteration,
        summaries,
        completionReason: await ctx.completionHandler
          .getCompletionDescription(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      ctx.logger.error("Agent failed", { error: errorMessage });

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
    if (typeof message !== "object" || message === null) {
      return;
    }

    const msg = message as Record<string, unknown>;
    const type = msg.type as string;
    const ctx = this.getContext();

    switch (type) {
      case "assistant": {
        const content = this.extractContent(msg.message);
        if (content) {
          summary.assistantResponses.push(content);

          // Detect actions
          if (ctx.actionDetector) {
            const actions = ctx.actionDetector.detect(content);
            summary.detectedActions.push(...actions);
          }
        }
        break;
      }

      case "tool_use":
        summary.toolsUsed.push(msg.tool_name as string);
        break;

      case "result":
        summary.sessionId = msg.session_id as string;
        break;

      case "error": {
        const errorObj = msg.error as Record<string, unknown>;
        summary.errors.push(
          (errorObj?.message as string) ?? "Unknown error",
        );
        break;
      }
    }
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
