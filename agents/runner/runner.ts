/**
 * Agent Runner - main execution engine
 */

import type {
  AgentDefinition,
  AgentResult,
  IterationSummary,
} from "../src_common/types.ts";
import { Logger } from "../src_common/logger.ts";
import {
  type CompletionHandler,
  createCompletionHandler,
} from "../completion/mod.ts";
import { PromptResolver } from "../prompts/resolver.ts";
import { ActionDetector } from "../actions/detector.ts";
import { ActionExecutor } from "../actions/executor.ts";
import { getAgentDir } from "./loader.ts";
import { mergeSandboxConfig } from "./sandbox-defaults.ts";

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
  private completionHandler!: CompletionHandler;
  private promptResolver!: PromptResolver;
  private actionDetector?: ActionDetector;
  private actionExecutor?: ActionExecutor;
  private logger!: Logger;
  private cwd!: string;

  constructor(definition: AgentDefinition) {
    this.definition = definition;
  }

  async initialize(options: RunnerOptions): Promise<void> {
    this.cwd = options.cwd ?? Deno.cwd();
    const agentDir = getAgentDir(this.definition.name, this.cwd);

    // Initialize logger
    this.logger = await Logger.create({
      agentName: this.definition.name,
      directory: this.definition.logging.directory,
      format: this.definition.logging.format,
    });

    // Initialize completion handler
    this.completionHandler = await createCompletionHandler(
      this.definition,
      options.args,
      agentDir,
    );

    // Initialize prompt resolver
    this.promptResolver = await PromptResolver.create({
      agentName: this.definition.name,
      agentDir,
      registryPath: this.definition.prompts.registry,
      fallbackDir: this.definition.prompts.fallbackDir,
    });

    // Initialize action system if enabled
    if (this.definition.actions?.enabled) {
      this.actionDetector = new ActionDetector(this.definition.actions);
      this.actionExecutor = new ActionExecutor(this.definition.actions, {
        agentName: this.definition.name,
        logger: this.logger,
        cwd: this.cwd,
      });
    }
  }

  async run(options: RunnerOptions): Promise<AgentResult> {
    await this.initialize(options);

    const { args: _args, plugins = [] } = options;

    this.logger.info(`Starting agent: ${this.definition.displayName}`);

    let iteration = 0;
    let sessionId: string | undefined;
    const summaries: IterationSummary[] = [];

    try {
      while (true) {
        iteration++;
        this.logger.info(`=== Iteration ${iteration} ===`);

        // Build prompt
        const lastSummary = summaries.length > 0
          ? summaries[summaries.length - 1]
          : undefined;
        const prompt = iteration === 1
          ? await this.completionHandler.buildInitialPrompt()
          : await this.completionHandler.buildContinuationPrompt(
            iteration - 1, // completedIterations
            lastSummary,
          );

        const systemPrompt = await this.promptResolver.resolveSystemPrompt({
          "uv-agent_name": this.definition.name,
          "uv-completion_criteria":
            this.completionHandler.buildCompletionCriteria().detailed,
        });

        // Execute Claude SDK query
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
        if (this.actionExecutor && summary.detectedActions.length > 0) {
          this.actionExecutor.setIteration(iteration);
          summary.actionResults = await this.actionExecutor.execute(
            summary.detectedActions,
          );
        }

        // Check completion
        if (await this.completionHandler.isComplete()) {
          this.logger.info("Agent completed");
          break;
        }

        // Max iteration check
        const maxIterations = this.getMaxIterations();
        if (iteration >= maxIterations) {
          this.logger.warn(`Max iterations (${maxIterations}) reached`);
          break;
        }
      }

      return {
        success: true,
        totalIterations: iteration,
        summaries,
        completionReason: await this.completionHandler
          .getCompletionDescription(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      this.logger.error("Agent failed", { error: errorMessage });

      return {
        success: false,
        totalIterations: iteration,
        summaries,
        completionReason: "Error occurred",
        error: errorMessage,
      };
    } finally {
      await this.logger.close();
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
        cwd: this.cwd,
        systemPrompt,
        allowedTools: this.definition.behavior.allowedTools,
        permissionMode: this.definition.behavior.permissionMode,
        settingSources: ["user", "project"],
        plugins,
        resume: sessionId,
      };

      // Configure sandbox (merge agent config with defaults)
      const sandboxConfig = mergeSandboxConfig(
        this.definition.behavior.sandboxConfig,
      );
      if (sandboxConfig.enabled === false) {
        queryOptions.dangerouslySkipPermissions = true;
      } else {
        queryOptions.sandbox = sandboxConfig;
      }

      const queryIterator = query({
        prompt,
        options: queryOptions,
      });

      for await (const message of queryIterator) {
        this.logger.logSdkMessage(message);
        this.processMessage(message, summary);
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      summary.errors.push(errorMessage);
      this.logger.error("Query execution failed", { error: errorMessage });
    }

    return summary;
  }

  private processMessage(message: unknown, summary: IterationSummary): void {
    if (typeof message !== "object" || message === null) {
      return;
    }

    const msg = message as Record<string, unknown>;
    const type = msg.type as string;

    switch (type) {
      case "assistant": {
        const content = this.extractContent(msg.message);
        if (content) {
          summary.assistantResponses.push(content);

          // Detect actions
          if (this.actionDetector) {
            const actions = this.actionDetector.detect(content);
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
