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
  AgentSchemaResolutionError,
  AgentStepRoutingError,
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
  hasCompletionChainSupport,
  hasFlowRoutingSupport,
  type OutputSchemaRef,
} from "../common/completion-types.ts";
import type {
  PromptStepDefinition,
  StepKind,
} from "../common/step-registry.ts";
import { inferStepKind, loadStepRegistry } from "../common/step-registry.ts";
import {
  filterAllowedTools,
  getToolPolicy,
  isBashCommandAllowed,
} from "../common/tool-policy.ts";
import {
  CompletionChain,
  type CompletionValidationResult,
} from "./completion-chain.ts";
import { join } from "@std/path";
import {
  SchemaPointerError,
  SchemaResolver,
} from "../common/schema-resolver.ts";
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
import { StepGateInterpreter } from "./step-gate-interpreter.ts";
import { type RoutingResult, WorkflowRouter } from "./workflow-router.ts";
import type { StepRegistry } from "../common/step-registry.ts";

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

  // Rate limit handling
  private rateLimitRetryCount = 0;
  private static readonly MAX_RATE_LIMIT_RETRIES = 5;

  // Step flow orchestration
  private stepContext: StepContextImpl | null = null;
  private currentStepId: string | null = null;
  private stepGateInterpreter: StepGateInterpreter | null = null;
  private workflowRouter: WorkflowRouter | null = null;

  // Schema resolution failure tracking (fail-fast)
  // Maps stepId -> consecutive failure count
  private schemaFailureCount: Map<string, number> = new Map();
  // Flag to skip StepGate when schema resolution failed
  private schemaResolutionFailed = false;
  // Maximum consecutive schema failures before aborting
  private static readonly MAX_SCHEMA_FAILURES = 2;

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
        const customSystemPrompt = await ctx.promptResolver.resolveSystemPrompt(
          {
            "uv-agent_name": this.definition.name,
            "uv-completion_criteria":
              ctx.completionHandler.buildCompletionCriteria().detailed,
          },
        );

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

        // Normalize stepId in structured output (Flow owns canonical value)
        this.normalizeStructuredOutputStepId(stepId, summary, ctx);

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

        // Step transition for step flow orchestration (moved before completion check)
        // Structured gate routing can signal completion via signalCompletion
        const routingResult = this.handleStepTransition(stepId, summary, ctx);

        // R4: Fail-fast if iteration > 1 and no intent produced (no routing)
        // This prevents silent rerun of entry step when StepGate can't parse intent
        // @see agents/docs/design/08_step_flow_design.md Section 6
        if (
          iteration > 1 &&
          routingResult === null &&
          !summary.schemaResolutionFailed &&
          this.hasFlowRoutingEnabled()
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
          // @see agents/docs/design/08_step_flow_design.md Section 7.1
          // deno-lint-ignore no-await-in-loop
          await this.invokeBoundaryHook(stepId, summary, ctx);
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
    systemPrompt: string | {
      type: "preset";
      preset: "claude_code";
      append?: string;
    };
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

      // Apply stepKind-based tool gating if we have step info
      let allowedTools = this.definition.behavior.allowedTools;
      let currentStepKind: StepKind | undefined;

      if (stepId && this.stepsRegistry) {
        const stepDef = this.stepsRegistry.steps[stepId] as
          | PromptStepDefinition
          | undefined;
        if (stepDef) {
          currentStepKind = inferStepKind(stepDef);
          if (currentStepKind) {
            allowedTools = filterAllowedTools(allowedTools, currentStepKind);
            ctx.logger.info(
              `[ToolPolicy] Step "${stepId}" (${currentStepKind}): tools filtered to ${allowedTools.length} allowed`,
            );
          }
        }
      }

      const queryOptions: Record<string, unknown> = {
        cwd: ctx.cwd,
        systemPrompt,
        allowedTools,
        permissionMode: this.definition.behavior.permissionMode,
        settingSources: ["user", "project"],
        plugins,
        resume: sessionId,
        // Auto-respond to AskUserQuestion to enable autonomous execution
        // Instead of waiting for user input, delegate decision to Claude
        canUseTool: (
          toolName: string,
          input: Record<string, unknown>,
        ) => {
          if (toolName === "AskUserQuestion") {
            const autoResponse = this.definition.behavior.askUserAutoResponse ??
              "Use your best judgment to choose the optimal approach. No need to confirm again.";
            const questions = input.questions as Array<{
              question: string;
              options: Array<{ label: string }>;
            }>;
            const answers: Record<string, string> = {};
            for (const q of questions) {
              // Delegate decision to Claude using configured response
              answers[q.question] = autoResponse;
            }
            ctx.logger.info(
              "[AskUserQuestion] Auto-responding with delegation",
              { questionCount: questions.length, response: autoResponse },
            );
            return {
              behavior: "allow",
              updatedInput: { questions: input.questions, answers },
            };
          }
          // Allow other tools
          return { behavior: "allow", updatedInput: input };
        },
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
        const schema = await this.loadSchemaForStep(
          stepId,
          iteration,
          ctx.logger,
        );

        // R2: If schema resolution failed, abort iteration immediately
        // Don't let LLM produce freeform text when schemas are unavailable
        if (this.schemaResolutionFailed) {
          ctx.logger.warn(
            `[StructuredOutput] Aborting iteration: schema resolution failed for step "${stepId}"`,
          );
          summary.errors.push(
            `Schema resolution failed for step "${stepId}". Iteration aborted.`,
          );
          summary.schemaResolutionFailed = true;
          return summary;
        }

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

      // Configure PreToolUse hooks for boundary bash blocking
      // Enable based on tool policy's blockBoundaryBash setting for each stepKind
      if (currentStepKind && getToolPolicy(currentStepKind).blockBoundaryBash) {
        const boundaryBashBlockingHook = this.createBoundaryBashBlockingHook(
          currentStepKind,
          ctx,
        );
        queryOptions.hooks = {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [boundaryBashBlockingHook],
            },
          ],
        };
        ctx.logger.info(
          `[ToolPolicy] PreToolUse hooks enabled for boundary bash blocking (stepKind: ${currentStepKind})`,
        );
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

    return summary;
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
    if (this.definition.behavior.completionType === "iterationBudget") {
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
   *
   * Loads StepRegistry and initializes components based on registry capabilities:
   * - CompletionChain support (completionPatterns/validators): Initialize CompletionValidator, RetryHandler, CompletionChain
   * - Flow routing support (structuredGate in steps): Initialize StepGateInterpreter, WorkflowRouter
   *
   * A registry is always loaded if it exists and has either capability.
   */
  private async initializeCompletionValidation(
    agentDir: string,
    cwd: string,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<void> {
    const registryPath = join(agentDir, "steps_registry.json");

    try {
      // Use loadStepRegistry for unified validation (fail-fast per design/08_step_flow_design.md)
      // This validates: stepKind/allowedIntents consistency, entryStepMapping, intentSchemaRef format
      //
      // First load registry WITHOUT intent enum validation to get schemasBase
      // Then validate enums with the correct schemasDir (honoring registry.schemasBase)
      const registry = await loadStepRegistry(
        this.definition.name,
        "", // Not used when registryPath is provided
        {
          registryPath,
          validateIntentEnums: false, // Defer enum validation
        },
      );
      logger.debug(
        "Registry validation passed (stepKind, entryStep, intentSchemaRef format)",
      );

      // Honor registry.schemasBase override per builder/01_quickstart.md
      const schemasBase = registry.schemasBase ??
        `.agent/${this.definition.name}/schemas`;
      const schemasDir = join(cwd, schemasBase);

      // Now validate intent schema enums with the correct schemasDir
      const { validateIntentSchemaEnums } = await import(
        "../common/step-registry.ts"
      );
      await validateIntentSchemaEnums(registry, schemasDir);
      logger.debug(
        "Intent schema enum validation passed",
      );

      // Check for extended registry capabilities
      const hasCompletionChain = hasCompletionChainSupport(registry);
      const hasFlowRouting = hasFlowRoutingSupport(registry);

      // Fail-fast: stepMachine completion requires structuredGate on at least one step
      // Per design/08_step_flow_design.md and builder/01_quickstart.md
      if (
        this.definition.behavior.completionType === "stepMachine" &&
        !hasFlowRouting
      ) {
        throw new Error(
          `[StepFlow][ConfigError] Agent "${this.definition.name}" uses completionType "stepMachine" ` +
            `but registry has no steps with structuredGate. Add structuredGate to at least one step ` +
            `or change completionType. See design/08_step_flow_design.md.`,
        );
      }

      if (!hasCompletionChain && !hasFlowRouting) {
        logger.debug(
          "Registry has no extended capabilities (no completionPatterns, validators, or structuredGate), skipping setup",
        );
        return;
      }

      // Store registry with proper typing (use local variable for type narrowing)
      const stepsRegistry: ExtendedStepsRegistry = registry;
      this.stepsRegistry = stepsRegistry;

      const capabilities: string[] = [];
      if (hasCompletionChain) capabilities.push("CompletionChain");
      if (hasFlowRouting) capabilities.push("FlowRouting");
      logger.info(
        `Loaded steps registry with capabilities: ${capabilities.join(", ")}`,
      );

      // Initialize CompletionChain components if supported
      if (hasCompletionChain) {
        // Initialize CompletionValidator factory
        const validatorFactory = this.dependencies.completionValidatorFactory;
        if (validatorFactory) {
          if (isInitializable(validatorFactory)) {
            await validatorFactory.initialize();
          }
          this.completionValidator = validatorFactory.create({
            registry: stepsRegistry,
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
            registry: stepsRegistry,
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
          stepsRegistry: stepsRegistry,
          completionValidator: this.completionValidator,
          retryHandler: this.retryHandler,
          agentId: this.definition.name,
        });
        logger.debug("CompletionChain initialized");
      }

      // Initialize Flow routing components if supported
      if (hasFlowRouting) {
        // Validate that all Flow steps have structuredGate and transitions
        this.validateFlowSteps(stepsRegistry, logger);

        this.stepGateInterpreter = new StepGateInterpreter();
        this.workflowRouter = new WorkflowRouter(
          stepsRegistry as unknown as StepRegistry,
        );
        logger.debug("StepGateInterpreter and WorkflowRouter initialized");
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
   * Validate that all Flow steps have structuredGate, transitions, and outputSchemaRef.
   *
   * Flow steps are all steps except those prefixed with "section." (template sections).
   * Missing structuredGate, transitions, or outputSchemaRef will throw an error.
   *
   * The outputSchemaRef requirement ensures that Structured Output can be obtained,
   * which is necessary for StepGate to interpret intents. Without a schema, the
   * Flow loop cannot advance properly.
   */
  private validateFlowSteps(
    stepsRegistry: ExtendedStepsRegistry,
    logger: import("../src_common/logger.ts").Logger,
  ): void {
    const missingGate: string[] = [];
    const missingTransitions: string[] = [];
    const missingOutputSchema: string[] = [];

    for (const [stepId, stepDef] of Object.entries(stepsRegistry.steps)) {
      // Skip template sections (section.* prefix)
      if (stepId.startsWith("section.")) {
        continue;
      }

      const step = stepDef as PromptStepDefinition;

      if (!step.structuredGate) {
        missingGate.push(stepId);
      }

      if (!step.transitions) {
        missingTransitions.push(stepId);
      }

      if (!step.outputSchemaRef) {
        missingOutputSchema.push(stepId);
      }
    }

    if (
      missingGate.length > 0 ||
      missingTransitions.length > 0 ||
      missingOutputSchema.length > 0
    ) {
      const errors: string[] = [];

      if (missingGate.length > 0) {
        errors.push(
          `Steps missing structuredGate: ${missingGate.join(", ")}`,
        );
      }

      if (missingTransitions.length > 0) {
        errors.push(
          `Steps missing transitions: ${missingTransitions.join(", ")}`,
        );
      }

      if (missingOutputSchema.length > 0) {
        errors.push(
          `Steps missing outputSchemaRef: ${missingOutputSchema.join(", ")}`,
        );
      }

      throw new Error(
        `[StepFlow] Flow validation failed. All Flow steps must define ` +
          `structuredGate, transitions, and outputSchemaRef.\n${
            errors.join("\n")
          }\n` +
          `See agents/docs/design/08_step_flow_design.md for requirements.`,
      );
    }

    logger.debug(
      `Flow validation passed: ${
        Object.keys(stepsRegistry.steps).length
      } steps validated`,
    );
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
   * Check if AI declared completion via structured output.
   *
   * Only "closing" intent from Closure Step triggers completion.
   * See design/08_step_flow_design.md Section 3 and 7.1.
   *
   * Note: "complete" is accepted for backward compatibility.
   * Note: status: "completed" is NOT a completion signal - it indicates
   *       step completion, not workflow completion.
   */
  private hasAICompletionDeclaration(summary: IterationSummary): boolean {
    if (!summary.structuredOutput) {
      return false;
    }

    const so = summary.structuredOutput;

    // Only "closing" (or legacy "complete") action triggers completion validation
    // status: "completed" alone is NOT a completion signal per 08_step_flow_design.md
    if (isRecord(so.next_action)) {
      const nextAction = so.next_action as Record<string, unknown>;
      if (nextAction.action === "closing" || nextAction.action === "complete") {
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
    return "closure.issue";
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
   * For iteration 1: Uses entryStepMapping or entryStep from registry.
   * Entry step must be explicitly configured - no implicit fallback is allowed.
   *
   * For iteration > 1: Requires currentStepId to be set by structured gate routing.
   * Errors if no routing has occurred, enforcing the documented contract that
   * all Flow steps must define transitions.
   */
  private getStepIdForIteration(iteration: number): string {
    // For iteration > 1, require routed step ID
    if (iteration > 1) {
      if (!this.currentStepId) {
        throw new Error(
          `[StepFlow] No routed step ID for iteration ${iteration}. ` +
            `All Flow steps must define structuredGate with transitions. ` +
            `Check steps_registry.json for missing gate configuration.`,
        );
      }
      return this.currentStepId;
    }

    // For iteration 1: Use registry-based lookup
    const completionType = this.definition.behavior.completionType;

    // Try entryStepMapping first
    if (this.stepsRegistry?.entryStepMapping?.[completionType]) {
      return this.stepsRegistry.entryStepMapping[completionType];
    }

    // Try generic entryStep
    if (this.stepsRegistry?.entryStep) {
      return this.stepsRegistry.entryStep;
    }

    // No implicit fallback - entry step must be explicitly configured
    throw new Error(
      `[StepFlow] No entry step configured for completionType "${completionType}". ` +
        `Define either "entryStepMapping.${completionType}" or "entryStep" in steps_registry.json.`,
    );
  }

  /**
   * Load JSON Schema for a step from outputSchemaRef.
   *
   * Implements fail-fast behavior: tracks consecutive schema resolution failures
   * per step and throws AgentSchemaResolutionError after 2 consecutive failures.
   *
   * @throws AgentSchemaResolutionError after 2 consecutive failures on the same step
   */
  private async loadSchemaForStep(
    stepId: string,
    iteration: number,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<Record<string, unknown> | undefined> {
    // Reset schema failure flag at the start of each load attempt
    this.schemaResolutionFailed = false;

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

    // Validate outputSchemaRef format - must be object with file and schema properties
    const ref = stepDef.outputSchemaRef;
    if (
      typeof ref !== "object" ||
      ref === null ||
      typeof ref.file !== "string" ||
      typeof ref.schema !== "string"
    ) {
      const actualValue = JSON.stringify(ref);
      const errorMsg = `Invalid outputSchemaRef format for step "${stepId}": ` +
        `expected object with "file" and "schema" properties, got ${actualValue}. ` +
        `See agents/docs/builder/05_troubleshooting.md for correct format.`;
      logger.error(`[SchemaResolution] ${errorMsg}`);
      throw new AgentSchemaResolutionError(errorMsg, {
        stepId,
        schemaRef: actualValue,
        consecutiveFailures: 1,
        iteration,
      });
    }

    try {
      const schema = await this.loadSchemaFromRef(
        ref,
        logger,
      );
      // Success - reset failure counter for this step
      this.schemaFailureCount.set(stepId, 0);
      return schema;
    } catch (error) {
      if (error instanceof SchemaPointerError) {
        // Increment failure counter for this step
        const currentCount = this.schemaFailureCount.get(stepId) ?? 0;
        const newCount = currentCount + 1;
        this.schemaFailureCount.set(stepId, newCount);

        const schemaRef =
          `${stepDef.outputSchemaRef.file}#${stepDef.outputSchemaRef.schema}`;

        logger.error(
          `[SchemaResolution] Failed to resolve schema pointer ` +
            `(failure ${newCount}/${AgentRunner.MAX_SCHEMA_FAILURES})`,
          {
            stepId,
            schemaRef,
            pointer: error.pointer,
            file: error.file,
          },
        );

        // Check if we've hit the consecutive failure limit
        if (newCount >= AgentRunner.MAX_SCHEMA_FAILURES) {
          throw new AgentSchemaResolutionError(
            `Schema resolution failed ${newCount} consecutive times for step "${stepId}". ` +
              `Cannot resolve pointer "${error.pointer}" in ${error.file}. ` +
              `Flow halted to prevent infinite loop.`,
            {
              stepId,
              schemaRef,
              consecutiveFailures: newCount,
              cause: error,
              iteration,
            },
          );
        }

        // Set flag to skip StepGate for this iteration (StructuredOutputUnavailable)
        this.schemaResolutionFailed = true;
        logger.warn(
          `[SchemaResolution] Marking iteration as StructuredOutputUnavailable. ` +
            `StepGate will be skipped. Fix schema reference before next iteration.`,
        );
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Load schema from outputSchemaRef with full $ref resolution.
   *
   * @throws SchemaPointerError if the schema pointer cannot be resolved
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
        return undefined;
      }
      // Re-throw SchemaPointerError to trigger fail-fast behavior
      if (error instanceof SchemaPointerError) {
        throw error;
      }
      logger.warn(`Failed to load schema from ${ref.file}#${ref.schema}`, {
        error: String(error),
      });
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
   * Normalize stepId in structured output to match Flow's canonical value.
   *
   * Flow owns the authoritative stepId. The LLM only needs to provide intent
   * (next/repeat/jump/closing) and optional targetStepId. Since stepId is
   * defined with "const" in the schema, it should always match the expected
   * value. If the LLM returns a different value, we correct it rather than
   * failing, as Flow is the single source of truth.
   *
   * This ensures routing decisions aren't influenced by arbitrary LLM strings.
   *
   * @see agents/docs/design/08_step_flow_design.md
   */
  private normalizeStructuredOutputStepId(
    expectedStepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): void {
    // Skip normalization if no structured output
    if (!summary.structuredOutput) {
      return;
    }

    const structuredOutput = summary.structuredOutput;

    // Check if stepId exists in structured output
    if (!isRecord(structuredOutput) || !isString(structuredOutput.stepId)) {
      ctx.logger.debug(
        `[StepFlow] No stepId in structured output, skipping normalization`,
      );
      return;
    }

    const actualStepId = structuredOutput.stepId;

    // Normalize stepId if it differs from expected
    if (actualStepId !== expectedStepId) {
      // Get step name for telemetry
      const stepName = this.stepsRegistry?.steps[expectedStepId]?.name ??
        expectedStepId;
      // Get issue number if available
      const issueNumber = this.args.issue;

      ctx.logger.warn(
        `[StepFlow] stepId corrected: "${actualStepId}" -> "${expectedStepId}" ` +
          `(Flow owns canonical stepId)`,
        {
          step: stepName,
          expectedStepId,
          actualStepId,
          ...(issueNumber !== undefined && { issue: issueNumber }),
        },
      );

      // Correct the value (Flow is single source of truth)
      (structuredOutput as Record<string, unknown>).stepId = expectedStepId;
    } else {
      ctx.logger.debug(
        `[StepFlow] stepId matches expected: ${actualStepId}`,
      );
    }
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
   * Handle step transition using structured gate routing.
   *
   * All Flow steps must define structuredGate with transitions.
   * Returns null if prerequisites are not met (no registry, no structured output,
   * or step not found), which will cause getStepIdForIteration() to error
   * on the next iteration.
   *
   * When schemaResolutionFailed is true, StepGate routing is skipped because
   * structured output is unavailable. The step will be retried on the next
   * iteration with the same stepId.
   */
  private handleStepTransition(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): RoutingResult | null {
    // Skip StepGate when schema resolution failed (StructuredOutputUnavailable)
    if (this.schemaResolutionFailed) {
      ctx.logger.info(
        `[StepFlow] Skipping StepGate routing: StructuredOutputUnavailable for step "${stepId}"`,
      );
      // Keep currentStepId unchanged to retry the same step
      return null;
    }
    return this.tryStructuredGateRouting(stepId, summary, ctx);
  }

  /**
   * Try to route using structured gate if configured.
   */
  private tryStructuredGateRouting(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): RoutingResult | null {
    // Check prerequisites
    if (
      !this.stepsRegistry || !this.stepGateInterpreter || !this.workflowRouter
    ) {
      return null;
    }

    if (!summary.structuredOutput) {
      return null;
    }

    // Get step definition
    const stepDef = this.stepsRegistry.steps[stepId] as
      | PromptStepDefinition
      | undefined;
    if (!stepDef?.structuredGate) {
      return null;
    }

    // Get step kind for logging
    const stepKind = inferStepKind(stepDef);

    // Interpret structured output through the gate
    const interpretation = this.stepGateInterpreter.interpret(
      summary.structuredOutput,
      stepDef,
    );

    ctx.logger.info(`[StepFlow] Interpreted intent: ${interpretation.intent}`, {
      stepId,
      stepKind,
      target: interpretation.target,
      usedFallback: interpretation.usedFallback,
      reason: interpretation.reason,
    });

    // Merge handoff into step context
    if (interpretation.handoff && this.stepContext) {
      this.stepContext.set(stepId, interpretation.handoff);
      ctx.logger.debug(`[StepFlow] Stored handoff data for step: ${stepId}`, {
        handoffKeys: Object.keys(interpretation.handoff),
      });
    }

    // Route to next step
    const routing = this.workflowRouter.route(stepId, interpretation);

    // Log warning if present (e.g., handoff from initial step)
    if (routing.warning) {
      ctx.logger.warn(`[StepFlow] ${routing.warning}`);
    }

    ctx.logger.info(
      `[StepFlow] Routing decision: ${stepId} -> ${routing.nextStepId}`,
      {
        stepKind,
        intent: interpretation.intent,
        signalCompletion: routing.signalCompletion,
        reason: routing.reason,
      },
    );

    // Update current step ID
    if (!routing.signalCompletion && routing.nextStepId !== stepId) {
      this.currentStepId = routing.nextStepId;
    }

    return routing;
  }

  /**
   * Check if flow routing is enabled (StepGateInterpreter and WorkflowRouter initialized).
   * This is used for R4 fail-fast check to only enforce intent requirement when flow routing is active.
   */
  private hasFlowRoutingEnabled(): boolean {
    return this.stepGateInterpreter !== null && this.workflowRouter !== null;
  }

  // ============================================================================
  // Boundary Hook
  // ============================================================================

  /**
   * Invoke boundary hook when a closure step emits `closing` intent.
   *
   * Boundary hook is the single surface for external side effects:
   * - Issue close
   * - Release publish
   * - PR merge
   *
   * Work/Verification steps cannot mutate issues directly - all external
   * state changes must flow through this hook.
   *
   * @see agents/docs/design/08_step_flow_design.md Section 7.1
   */
  private async invokeBoundaryHook(
    stepId: string,
    summary: IterationSummary,
    ctx: RuntimeContext,
  ): Promise<void> {
    // Only invoke for closure steps
    const stepDef = this.stepsRegistry?.steps[stepId] as
      | PromptStepDefinition
      | undefined;
    const stepKind = stepDef ? inferStepKind(stepDef) : undefined;

    if (stepKind !== "closure") {
      ctx.logger.debug(
        `[BoundaryHook] Skipping: step "${stepId}" is not a closure step (kind: ${
          stepKind ?? "unknown"
        })`,
      );
      return;
    }

    // Emit boundaryHook event for external handlers
    await this.eventEmitter.emit("boundaryHook", {
      stepId,
      stepKind,
      structuredOutput: summary.structuredOutput,
    });

    ctx.logger.info(`[BoundaryHook] Invoked for closure step: ${stepId}`);

    // Delegate to completionHandler for actual side effects
    // The completionHandler is responsible for implementing the boundary actions
    // based on the agent's configuration
    if (ctx.completionHandler.onBoundaryHook) {
      await ctx.completionHandler.onBoundaryHook({
        stepId,
        stepKind,
        structuredOutput: summary.structuredOutput,
      });
    }
  }

  // ============================================================================
  // PreToolUse Hook Factory
  // ============================================================================

  /**
   * Create a PreToolUse hook callback that blocks boundary bash commands.
   *
   * This hook is used to enforce the policy that Work/Verification steps
   * cannot execute boundary actions like `gh issue close`, `gh pr merge`, etc.
   *
   * @param stepKind - Current step kind (work, verification, or closure)
   * @param ctx - Runtime context for logging
   * @returns Hook callback function for SDK PreToolUse event
   *
   * @see agents/docs/design/08_step_flow_design.md Section 2.1
   * @see agents/common/tool-policy.ts
   */
  private createBoundaryBashBlockingHook(
    stepKind: StepKind,
    ctx: RuntimeContext,
  ): (
    input: { tool_name: string; tool_input: Record<string, unknown> },
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<Record<string, unknown>> {
    return (input, _toolUseId, _options) => {
      // Only check Bash commands
      if (input.tool_name !== "Bash") {
        return Promise.resolve({});
      }

      const command = input.tool_input.command as string | undefined;
      if (!command) {
        return Promise.resolve({});
      }

      // Check if command is allowed for this step kind
      const result = isBashCommandAllowed(command, stepKind);

      if (!result.allowed) {
        ctx.logger.warn(
          `[ToolPolicy] Boundary bash command blocked in ${stepKind} step`,
          {
            command: command.substring(0, 100),
            reason: result.reason,
          },
        );

        return Promise.resolve({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: result.reason,
          },
        });
      }

      return Promise.resolve({});
    };
  }
}
