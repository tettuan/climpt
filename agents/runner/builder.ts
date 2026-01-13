/**
 * AgentRunnerBuilder - Builder pattern for testable AgentRunner construction
 *
 * This module provides dependency injection support for AgentRunner,
 * enabling easier testing through mock factories.
 */

import type {
  ActionConfig,
  AgentDefinition,
  LoggingConfig,
} from "../src_common/types.ts";
import type { CompletionHandler } from "../completion/types.ts";
import type { Logger } from "../src_common/logger.ts";
import type { PromptResolver } from "../prompts/resolver.ts";
import type { ActionDetector } from "../actions/detector.ts";
import type { ActionExecutor, ExecutorOptions } from "../actions/executor.ts";
import type { CompletionValidator } from "../validators/completion/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";

// ============================================================================
// Factory Interfaces
// ============================================================================

/**
 * Interface for factories that require async initialization.
 *
 * Factories implementing this interface must have `initialize()` called
 * before `create()` can be used. This pattern supports lazy loading and
 * dynamic imports while providing a consistent initialization API.
 */
export interface Initializable {
  /**
   * Initialize the factory (load dependencies, etc.)
   * Must be called before create() for factories that implement this.
   */
  initialize(): Promise<void>;
}

/**
 * Type guard to check if a factory is initializable.
 */
export function isInitializable(obj: unknown): obj is Initializable {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "initialize" in obj &&
    typeof (obj as Initializable).initialize === "function"
  );
}

/**
 * Factory interface for Logger creation.
 * Allows injection of mock loggers for testing.
 */
export interface LoggerFactory {
  create(options: LoggerFactoryOptions): Promise<Logger>;
}

/**
 * Options for Logger creation via factory.
 * Named differently from src_common/logger.ts LoggerOptions to avoid export conflicts.
 */
export interface LoggerFactoryOptions {
  agentName: string;
  directory: string;
  format: LoggingConfig["format"];
}

/**
 * Factory interface for CompletionHandler creation.
 * Allows injection of mock completion handlers for testing.
 */
export interface CompletionHandlerFactory {
  create(
    definition: AgentDefinition,
    args: Record<string, unknown>,
    agentDir: string,
  ): Promise<CompletionHandler>;
}

/**
 * Factory interface for PromptResolver creation.
 * Allows injection of mock prompt resolvers for testing.
 */
export interface PromptResolverFactory {
  create(options: PromptResolverFactoryOptions): Promise<PromptResolver>;
}

/**
 * Options for PromptResolver creation via factory.
 * Named differently from prompts/resolver.ts PromptResolverOptions to avoid export conflicts.
 */
export interface PromptResolverFactoryOptions {
  agentName: string;
  agentDir: string;
  registryPath: string;
  fallbackDir?: string;
}

/**
 * Factory interface for Action system components.
 * Allows injection of mock detectors and executors for testing.
 */
export interface ActionSystemFactory {
  createDetector(config: ActionConfig): ActionDetector;
  createExecutor(
    config: ActionConfig,
    options: ExecutorOptions,
  ): ActionExecutor;
}

/**
 * Options for CompletionValidator creation via factory.
 */
export interface CompletionValidatorFactoryOptions {
  registry: ExtendedStepsRegistry;
  workingDir: string;
  logger: Logger;
  agentId: string;
}

/**
 * Factory interface for CompletionValidator creation.
 * Allows injection of mock validators for testing.
 */
export interface CompletionValidatorFactory {
  create(options: CompletionValidatorFactoryOptions): CompletionValidator;
}

/**
 * Options for RetryHandler creation via factory.
 */
export interface RetryHandlerFactoryOptions {
  registry: ExtendedStepsRegistry;
  workingDir: string;
  logger: Logger;
  agentId: string;
}

/**
 * Factory interface for RetryHandler creation.
 * Allows injection of mock handlers for testing.
 */
export interface RetryHandlerFactory {
  create(options: RetryHandlerFactoryOptions): RetryHandler;
}

// Re-export ExecutorOptions for external use
export type { ExecutorOptions };

// ============================================================================
// Dependencies Interface
// ============================================================================

/**
 * All injectable dependencies for AgentRunner.
 * Using readonly to ensure immutability after creation.
 */
export interface AgentDependencies {
  readonly loggerFactory: LoggerFactory;
  readonly completionHandlerFactory: CompletionHandlerFactory;
  readonly promptResolverFactory: PromptResolverFactory;
  readonly actionSystemFactory?: ActionSystemFactory;
  readonly completionValidatorFactory?: CompletionValidatorFactory;
  readonly retryHandlerFactory?: RetryHandlerFactory;
}

/**
 * Mutable version of AgentDependencies for internal builder use.
 * This allows the builder to collect factories before creating the final immutable object.
 */
interface MutableAgentDependencies {
  loggerFactory?: LoggerFactory;
  completionHandlerFactory?: CompletionHandlerFactory;
  promptResolverFactory?: PromptResolverFactory;
  actionSystemFactory?: ActionSystemFactory;
  completionValidatorFactory?: CompletionValidatorFactory;
  retryHandlerFactory?: RetryHandlerFactory;
}

// ============================================================================
// Default Factory Implementations
// ============================================================================

/**
 * Default factory implementation for Logger.
 * Wraps the static Logger.create() method.
 */
export class DefaultLoggerFactory implements LoggerFactory {
  async create(options: LoggerFactoryOptions): Promise<Logger> {
    // Dynamic import to avoid circular dependencies
    const { Logger } = await import("../src_common/logger.ts");
    return Logger.create(options);
  }
}

/**
 * Default factory implementation for CompletionHandler.
 * Wraps the createCompletionHandler factory function.
 */
export class DefaultCompletionHandlerFactory
  implements CompletionHandlerFactory {
  async create(
    definition: AgentDefinition,
    args: Record<string, unknown>,
    agentDir: string,
  ): Promise<CompletionHandler> {
    // Dynamic import to avoid circular dependencies
    const { createCompletionHandler } = await import("../completion/mod.ts");
    return createCompletionHandler(definition, args, agentDir);
  }
}

/**
 * Default factory implementation for PromptResolver.
 * Wraps the static PromptResolver.create() method.
 */
export class DefaultPromptResolverFactory implements PromptResolverFactory {
  async create(options: PromptResolverFactoryOptions): Promise<PromptResolver> {
    // Dynamic import to avoid circular dependencies
    const { PromptResolver } = await import("../prompts/resolver.ts");
    return PromptResolver.create(options);
  }
}

/**
 * Default factory implementation for Action system components.
 * Wraps the ActionDetector and ActionExecutor constructors.
 */
export class DefaultActionSystemFactory
  implements ActionSystemFactory, Initializable {
  private ActionDetectorClass: typeof ActionDetector | null = null;
  private ActionExecutorClass: typeof ActionExecutor | null = null;

  private async ensureImported(): Promise<void> {
    if (!this.ActionDetectorClass || !this.ActionExecutorClass) {
      // Dynamic import to avoid circular dependencies
      const detectorModule = await import("../actions/detector.ts");
      const executorModule = await import("../actions/executor.ts");
      this.ActionDetectorClass = detectorModule.ActionDetector;
      this.ActionExecutorClass = executorModule.ActionExecutor;
    }
  }

  createDetector(config: ActionConfig): ActionDetector {
    // Note: For synchronous creation, we need pre-imported classes
    // This will throw if ensureImported() wasn't called
    if (!this.ActionDetectorClass) {
      throw new Error(
        "ActionDetectorClass not imported. Call ensureImported() first.",
      );
    }
    return new this.ActionDetectorClass(config);
  }

  createExecutor(
    config: ActionConfig,
    options: ExecutorOptions,
  ): ActionExecutor {
    // Note: For synchronous creation, we need pre-imported classes
    if (!this.ActionExecutorClass) {
      throw new Error(
        "ActionExecutorClass not imported. Call ensureImported() first.",
      );
    }
    return new this.ActionExecutorClass(config, options);
  }

  /**
   * Async initialization to import classes.
   * Must be called before createDetector/createExecutor.
   */
  async initialize(): Promise<void> {
    await this.ensureImported();
  }
}

/**
 * Default factory implementation for CompletionValidator.
 * Wraps the createCompletionValidator factory function.
 */
export class DefaultCompletionValidatorFactory
  implements CompletionValidatorFactory, Initializable {
  private createFn:
    | ((
      registry: import("../validators/completion/types.ts").ValidatorRegistry,
      ctx:
        import("../validators/completion/types.ts").CompletionValidatorContext,
    ) => CompletionValidator)
    | null = null;

  async initialize(): Promise<void> {
    const mod = await import("../validators/completion/validator.ts");
    this.createFn = mod.createCompletionValidator;
  }

  create(options: CompletionValidatorFactoryOptions): CompletionValidator {
    if (!this.createFn) {
      throw new Error(
        "DefaultCompletionValidatorFactory not initialized. Call initialize() first.",
      );
    }
    return this.createFn(
      {
        validators: options.registry.validators ?? {},
        completionPatterns: options.registry.completionPatterns,
      },
      {
        workingDir: options.workingDir,
        logger: options.logger,
        agentId: options.agentId,
      },
    );
  }
}

/**
 * Default factory implementation for RetryHandler.
 * Wraps the createRetryHandler factory function.
 */
export class DefaultRetryHandlerFactory
  implements RetryHandlerFactory, Initializable {
  private createFn:
    | ((
      registry: ExtendedStepsRegistry,
      ctx: { workingDir: string; logger: Logger; agentId: string },
    ) => RetryHandler)
    | null = null;

  async initialize(): Promise<void> {
    const mod = await import("../retry/retry-handler.ts");
    this.createFn = mod.createRetryHandler;
  }

  create(options: RetryHandlerFactoryOptions): RetryHandler {
    if (!this.createFn) {
      throw new Error(
        "DefaultRetryHandlerFactory not initialized. Call initialize() first.",
      );
    }
    return this.createFn(options.registry, {
      workingDir: options.workingDir,
      logger: options.logger,
      agentId: options.agentId,
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create default dependencies for AgentRunner.
 * Used when no custom dependencies are provided.
 */
export function createDefaultDependencies(): AgentDependencies {
  return {
    loggerFactory: new DefaultLoggerFactory(),
    completionHandlerFactory: new DefaultCompletionHandlerFactory(),
    promptResolverFactory: new DefaultPromptResolverFactory(),
    actionSystemFactory: new DefaultActionSystemFactory(),
    completionValidatorFactory: new DefaultCompletionValidatorFactory(),
    retryHandlerFactory: new DefaultRetryHandlerFactory(),
  };
}

// ============================================================================
// Builder Class
// ============================================================================

// Forward declaration - AgentRunner is imported dynamically to avoid circular deps
type AgentRunnerType = import("./runner.ts").AgentRunner;

/**
 * Builder for creating AgentRunner instances with dependency injection.
 *
 * @example
 * // Create with defaults
 * const runner = await new AgentRunnerBuilder()
 *   .withDefinition(definition)
 *   .build();
 *
 * @example
 * // Create with custom factories for testing
 * const runner = await new AgentRunnerBuilder()
 *   .withDefinition(definition)
 *   .withLoggerFactory(mockLoggerFactory)
 *   .withCompletionHandlerFactory(mockCompletionFactory)
 *   .build();
 */
export class AgentRunnerBuilder {
  private definition?: AgentDefinition;
  private dependencies: MutableAgentDependencies = {};

  /**
   * Set the agent definition.
   */
  withDefinition(def: AgentDefinition): this {
    this.definition = def;
    return this;
  }

  /**
   * Set a custom logger factory.
   */
  withLoggerFactory(factory: LoggerFactory): this {
    this.dependencies.loggerFactory = factory;
    return this;
  }

  /**
   * Set a custom completion handler factory.
   */
  withCompletionHandlerFactory(factory: CompletionHandlerFactory): this {
    this.dependencies.completionHandlerFactory = factory;
    return this;
  }

  /**
   * Set a custom prompt resolver factory.
   */
  withPromptResolverFactory(factory: PromptResolverFactory): this {
    this.dependencies.promptResolverFactory = factory;
    return this;
  }

  /**
   * Set a custom action system factory.
   */
  withActionSystemFactory(factory: ActionSystemFactory): this {
    this.dependencies.actionSystemFactory = factory;
    return this;
  }

  /**
   * Build the AgentRunner with configured dependencies.
   * @throws Error if AgentDefinition is not set
   */
  async build(): Promise<AgentRunnerType> {
    if (!this.definition) {
      throw new Error(
        "AgentDefinition is required. Call withDefinition() first.",
      );
    }

    const deps = this.buildDependencies();

    // Initialize factories that support initialization
    if (isInitializable(deps.actionSystemFactory)) {
      await deps.actionSystemFactory.initialize();
    }

    // Dynamic import to avoid circular dependencies
    const { AgentRunner } = await import("./runner.ts");
    return new AgentRunner(this.definition, deps);
  }

  /**
   * Set a custom completion validator factory.
   */
  withCompletionValidatorFactory(factory: CompletionValidatorFactory): this {
    this.dependencies.completionValidatorFactory = factory;
    return this;
  }

  /**
   * Set a custom retry handler factory.
   */
  withRetryHandlerFactory(factory: RetryHandlerFactory): this {
    this.dependencies.retryHandlerFactory = factory;
    return this;
  }

  /**
   * Build dependencies by merging custom factories with defaults.
   */
  private buildDependencies(): AgentDependencies {
    const defaults = createDefaultDependencies();
    return {
      loggerFactory: this.dependencies.loggerFactory ?? defaults.loggerFactory,
      completionHandlerFactory: this.dependencies.completionHandlerFactory ??
        defaults.completionHandlerFactory,
      promptResolverFactory: this.dependencies.promptResolverFactory ??
        defaults.promptResolverFactory,
      actionSystemFactory: this.dependencies.actionSystemFactory ??
        defaults.actionSystemFactory,
      completionValidatorFactory:
        this.dependencies.completionValidatorFactory ??
          defaults.completionValidatorFactory,
      retryHandlerFactory: this.dependencies.retryHandlerFactory ??
        defaults.retryHandlerFactory,
    };
  }
}
