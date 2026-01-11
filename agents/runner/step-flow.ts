/**
 * Step Flow Runner - executes step-based agent flows
 */

import { join } from "@std/path";
import type {
  AgentDefinition,
  CheckDefinition,
  CheckResponse,
  IterationSummary,
  PromptC3LReference,
  PromptPathReference,
  PromptReference,
  StepDefinition,
  StepFlowResult,
  StepFlowState,
  StepsRegistry,
} from "../src_common/types.ts";
import { Logger } from "../src_common/logger.ts";
import { getAgentDir } from "./loader.ts";
import { mergeSandboxConfig, toSdkSandboxConfig } from "./sandbox-defaults.ts";

export interface StepFlowOptions {
  cwd?: string;
  args: Record<string, unknown>;
  plugins?: string[];
}

/**
 * Executes step-based agent flows with state machine transitions
 */
export class StepFlowRunner {
  private definition: AgentDefinition;
  private registry!: StepsRegistry;
  private logger!: Logger;
  private cwd!: string;
  private agentDir!: string;
  private sessionId?: string;

  constructor(definition: AgentDefinition) {
    this.definition = definition;
  }

  async initialize(options: StepFlowOptions): Promise<void> {
    this.cwd = options.cwd ?? Deno.cwd();
    this.agentDir = getAgentDir(this.definition.name, this.cwd);

    // Initialize logger
    this.logger = await Logger.create({
      agentName: this.definition.name,
      directory: this.definition.logging.directory,
      format: this.definition.logging.format,
    });

    // Load steps registry
    this.registry = await this.loadRegistry();
  }

  private async loadRegistry(): Promise<StepsRegistry> {
    const registryPath = join(
      this.agentDir,
      this.definition.prompts.registry,
    );

    try {
      const content = await Deno.readTextFile(registryPath);
      return JSON.parse(content) as StepsRegistry;
    } catch (error) {
      throw new Error(
        `Failed to load steps registry: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async run(options: StepFlowOptions): Promise<StepFlowResult> {
    await this.initialize(options);

    const { args, plugins = [] } = options;

    this.logger.info(`Starting step flow: ${this.definition.displayName}`);

    const state: StepFlowState = {
      currentStepId: this.registry.entryStep,
      stepIteration: 0,
      totalIterations: 0,
      retryCount: 0,
      history: [],
    };

    try {
      while (true) {
        const step = this.registry.steps[state.currentStepId];
        if (!step) {
          throw new Error(`Step not found: ${state.currentStepId}`);
        }

        state.stepIteration++;
        state.totalIterations++;

        this.logger.info(
          `=== Step: ${step.name} (${step.id}) - Iteration ${state.stepIteration} ===`,
        );

        // Execute step prompt
        // Note: Sequential execution required - step must complete before check
        // deno-lint-ignore no-await-in-loop
        const _summary = await this.executeStepPrompt(step, args, plugins);

        // Check if step has completion check
        if (step.check) {
          // deno-lint-ignore no-await-in-loop
          const checkResult = await this.executeCheck(
            step.check,
            args,
            plugins,
          );
          const transition = this.determineTransition(
            checkResult,
            step.check,
            state,
          );

          // Record history
          state.history.push({
            stepId: step.id,
            iteration: state.stepIteration,
            checkResult,
            transition: transition.type,
            timestamp: new Date(),
          });

          // Handle transition
          if (transition.type === "complete") {
            this.logger.info("Step flow completed successfully");
            return {
              success: true,
              finalStepId: state.currentStepId,
              state,
              completionReason: `Completed at step: ${step.name}`,
            };
          }

          if (transition.type === "next" && transition.nextStepId) {
            state.currentStepId = transition.nextStepId;
            state.stepIteration = 0;
            state.retryCount = 0;
            continue;
          }

          if (transition.type === "fallback" && transition.nextStepId) {
            this.logger.warn(
              `Falling back from ${step.id} to ${transition.nextStepId}`,
            );
            state.currentStepId = transition.nextStepId;
            state.stepIteration = 0;
            state.retryCount = 0;
            continue;
          }

          if (transition.type === "retry") {
            state.retryCount++;
            this.logger.info(
              `Retrying step ${step.id} (attempt ${state.retryCount})`,
            );
            continue;
          }
        } else {
          // No check defined - record and check iteration limits
          state.history.push({
            stepId: step.id,
            iteration: state.stepIteration,
            transition: "next",
            timestamp: new Date(),
          });
        }

        // Check iteration limits
        const maxIterations = step.iterations?.max ?? 1;
        if (state.stepIteration >= maxIterations) {
          // No check or max iterations reached - this is an error state
          // unless it's the final step with no next
          this.logger.warn(
            `Max iterations (${maxIterations}) reached for step ${step.id}`,
          );

          // If there's no check and we've done all iterations, treat as error
          if (!step.check) {
            return {
              success: false,
              finalStepId: state.currentStepId,
              state,
              completionReason:
                `Max iterations reached without completion check`,
              error:
                `Step ${step.id} has no check defined and reached max iterations`,
            };
          }
        }

        // Safety check for infinite loops
        if (state.totalIterations > 100) {
          return {
            success: false,
            finalStepId: state.currentStepId,
            state,
            completionReason: "Max total iterations exceeded",
            error: "Exceeded 100 total iterations - possible infinite loop",
          };
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      this.logger.error("Step flow failed", { error: errorMessage });

      return {
        success: false,
        finalStepId: state.currentStepId,
        state,
        completionReason: "Error occurred",
        error: errorMessage,
      };
    } finally {
      await this.logger.close();
    }
  }

  private async executeStepPrompt(
    step: StepDefinition,
    args: Record<string, unknown>,
    plugins: string[],
  ): Promise<IterationSummary> {
    const promptContent = await this.resolvePrompt(step.prompt, args);
    const systemPrompt = await this.resolveSystemPrompt(args);

    return await this.executeQuery({
      prompt: promptContent,
      systemPrompt,
      plugins,
    });
  }

  private async executeCheck(
    check: CheckDefinition,
    args: Record<string, unknown>,
    plugins: string[],
  ): Promise<CheckResponse> {
    const checkPrompt = await this.resolvePrompt(check.prompt, args);
    const systemPrompt = await this.resolveSystemPrompt(args);

    const summary = await this.executeQuery({
      prompt: checkPrompt,
      systemPrompt,
      plugins,
    });

    // Parse check response from assistant output
    return this.parseCheckResponse(summary.assistantResponses, check);
  }

  private parseCheckResponse(
    responses: string[],
    check: CheckDefinition,
  ): CheckResponse {
    const lastResponse = responses[responses.length - 1] ?? "";

    // Try to find JSON block in response
    const jsonMatch = lastResponse.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]) as CheckResponse;
        return this.normalizeCheckResponse(parsed, check);
      } catch {
        // Fall through to default
      }
    }

    // Try to parse entire response as JSON
    try {
      const parsed = JSON.parse(lastResponse) as CheckResponse;
      return this.normalizeCheckResponse(parsed, check);
    } catch {
      // Fall through to default
    }

    // Try to detect keywords
    const lowerResponse = lastResponse.toLowerCase();
    if (
      lowerResponse.includes('"result": "ok"') ||
      lowerResponse.includes('"result":"ok"') ||
      lowerResponse.includes("result: ok")
    ) {
      return { result: "ok", message: "Detected OK in response" };
    }
    if (
      lowerResponse.includes('"result": "ng"') ||
      lowerResponse.includes('"result":"ng"') ||
      lowerResponse.includes("result: ng")
    ) {
      return { result: "ng", message: "Detected NG in response" };
    }

    // Default to NG if we can't parse
    return { result: "ng", message: "Could not parse check response" };
  }

  private normalizeCheckResponse(
    response: CheckResponse,
    _check: CheckDefinition,
  ): CheckResponse {
    // Normalize result to ok/ng
    let result: "ok" | "ng";

    if (typeof response.result === "boolean") {
      result = response.result ? "ok" : "ng";
    } else if (response.result === "pass" || response.result === "ok") {
      result = "ok";
    } else {
      result = "ng";
    }

    return {
      ...response,
      result,
    };
  }

  private determineTransition(
    checkResult: CheckResponse,
    check: CheckDefinition,
    state: StepFlowState,
  ): { type: "next" | "fallback" | "retry" | "complete"; nextStepId?: string } {
    const passed = checkResult.result === "ok" || checkResult.result === "pass";
    const transition = passed ? check.onPass : check.onFail;

    if (transition.complete) {
      return { type: "complete" };
    }

    if (transition.next) {
      return { type: "next", nextStepId: transition.next };
    }

    if (transition.fallback) {
      return { type: "fallback", nextStepId: transition.fallback };
    }

    if (transition.retry) {
      const maxRetries = transition.maxRetries ?? 0;
      if (maxRetries === 0 || state.retryCount < maxRetries) {
        return { type: "retry" };
      }
      // Max retries exceeded - treat as failure
      this.logger.warn(`Max retries (${maxRetries}) exceeded`);
    }

    // Default: treat as complete if no transition specified
    return { type: "complete" };
  }

  private async resolvePrompt(
    ref: PromptReference,
    args: Record<string, unknown>,
  ): Promise<string> {
    const path = this.buildPromptPath(ref);
    const fullPath = join(this.agentDir, this.registry.basePath, path);

    try {
      const content = await Deno.readTextFile(fullPath);
      return this.substituteVariables(content, args);
    } catch {
      throw new Error(`Failed to load prompt: ${fullPath}`);
    }
  }

  private buildPromptPath(ref: PromptReference): string {
    if ("path" in ref) {
      return (ref as PromptPathReference).path;
    }

    const c3l = ref as PromptC3LReference;
    const edition = c3l.edition ?? "default";
    return join(c3l.c1, c3l.c2, c3l.c3, `f_${edition}.md`);
  }

  private async resolveSystemPrompt(
    args: Record<string, unknown>,
  ): Promise<string> {
    const systemPath = join(
      this.agentDir,
      this.definition.behavior.systemPromptPath,
    );

    try {
      const content = await Deno.readTextFile(systemPath);
      return this.substituteVariables(content, args);
    } catch {
      return `You are ${this.definition.displayName}. ${this.definition.description}`;
    }
  }

  private substituteVariables(
    content: string,
    args: Record<string, unknown>,
  ): string {
    // Build UV variables from args
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      vars[`uv-${key}`] = String(value);
    }

    // Replace {{variable}} and {variable} patterns
    return content
      .replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const varKey = key.trim();
        return vars[varKey] ?? vars[`uv-${varKey}`] ?? `{{${key}}}`;
      })
      .replace(/\{([^}]+)\}/g, (_, key) => {
        const varKey = key.trim();
        if (varKey.startsWith("uv-")) {
          return vars[varKey] ?? `{${key}}`;
        }
        return vars[`uv-${varKey}`] ?? vars[varKey] ?? `{${key}}`;
      });
  }

  private async executeQuery(options: {
    prompt: string;
    systemPrompt: string;
    plugins: string[];
  }): Promise<IterationSummary> {
    const { prompt, systemPrompt, plugins } = options;

    const summary: IterationSummary = {
      iteration: 0,
      sessionId: undefined,
      assistantResponses: [],
      toolsUsed: [],
      detectedActions: [],
      errors: [],
    };

    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const queryOptions: Record<string, unknown> = {
        cwd: this.cwd,
        systemPrompt,
        allowedTools: this.definition.behavior.allowedTools,
        permissionMode: this.definition.behavior.permissionMode,
        settingSources: ["user", "project"],
        plugins,
        resume: this.sessionId,
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
        this.logger.logSdkMessage(message);
        this.processMessage(message, summary);
      }

      // Update session ID for continuity
      if (summary.sessionId) {
        this.sessionId = summary.sessionId;
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
            typeof c === "object" &&
            c !== null &&
            (c as Record<string, unknown>).type === "text"
          )
          .map((c) => (c as Record<string, unknown>).text as string)
          .join("\n");
      }
    }
    return "";
  }
}
