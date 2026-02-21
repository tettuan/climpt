/**
 * AgentRunnerBuilder - Builder pattern for testable AgentRunner construction
 *
 * This module provides dependency injection support for AgentRunner,
 * enabling easier testing through mock factories.
 */

import type {
  AgentDefinition,
  LoggingConfig,
  ResolvedAgentDefinition,
} from "../src_common/types.ts";
import type { CompletionHandler } from "../completion/types.ts";
import type { Logger } from "../src_common/logger.ts";
import type { PromptResolverAdapter as PromptResolver } from "../prompts/resolver-adapter.ts";
import type { CompletionValidator } from "../validators/completion/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";

// ============================================================================
// Factory Interfaces
// ============================================================================

/**
 * Interface for factories that require async initialization.
 */
export interface Initializable {
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
 */
export interface LoggerFactory {
  create(options: LoggerFactoryOptions): Promise<Logger>;
}

/**
 * Options for Logger creation via factory.
 */
export interface LoggerFactoryOptions {
  agentName: string;
  directory: string;
  format: LoggingConfig["format"];
}

/**
 * Factory interface for CompletionHandler creation.
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
 */
export interface PromptResolverFactory {
  create(options: PromptResolverFactoryOptions): Promise<PromptResolver>;
}

/**
 * Options for PromptResolver creation via factory.
 */
export interface PromptResolverFactoryOptions {
  agentName: string;
  agentDir: string;
  registryPath: string;
  fallbackDir?: string;
  systemPromptPath?: string;
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
 */
export interface RetryHandlerFactory {
  create(options: RetryHandlerFactoryOptions): RetryHandler;
}

// ============================================================================
// Dependencies Interface
// ============================================================================

/**
 * All injectable dependencies for AgentRunner.
 */
export interface AgentDependencies {
  readonly loggerFactory: LoggerFactory;
  readonly completionHandlerFactory: CompletionHandlerFactory;
  readonly promptResolverFactory: PromptResolverFactory;
  readonly completionValidatorFactory?: CompletionValidatorFactory;
  readonly retryHandlerFactory?: RetryHandlerFactory;
}

/**
 * Mutable version of AgentDependencies for internal builder use.
 */
interface MutableAgentDependencies {
  loggerFactory?: LoggerFactory;
  completionHandlerFactory?: CompletionHandlerFactory;
  promptResolverFactory?: PromptResolverFactory;
  completionValidatorFactory?: CompletionValidatorFactory;
  retryHandlerFactory?: RetryHandlerFactory;
}

// ============================================================================
// Default Factory Implementations
// ============================================================================

/**
 * Default factory implementation for Logger.
 */
export class DefaultLoggerFactory implements LoggerFactory {
  async create(options: LoggerFactoryOptions): Promise<Logger> {
    const { Logger } = await import("../src_common/logger.ts");
    return Logger.create(options);
  }
}

/**
 * Default factory implementation for CompletionHandler.
 */
export class DefaultCompletionHandlerFactory
  implements CompletionHandlerFactory {
  async create(
    definition: AgentDefinition,
    args: Record<string, unknown>,
    agentDir: string,
  ): Promise<CompletionHandler> {
    const { createRegistryCompletionHandler } = await import(
      "../completion/mod.ts"
    );
    return createRegistryCompletionHandler(definition, args, agentDir);
  }
}

/**
 * Default factory implementation for PromptResolver.
 */
export class DefaultPromptResolverFactory implements PromptResolverFactory {
  async create(options: PromptResolverFactoryOptions): Promise<PromptResolver> {
    const { PromptResolverAdapter } = await import(
      "../prompts/resolver-adapter.ts"
    );
    return PromptResolverAdapter.create(options);
  }
}

/**
 * Default factory implementation for CompletionValidator.
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
 */
export function createDefaultDependencies(): AgentDependencies {
  return {
    loggerFactory: new DefaultLoggerFactory(),
    completionHandlerFactory: new DefaultCompletionHandlerFactory(),
    promptResolverFactory: new DefaultPromptResolverFactory(),
    completionValidatorFactory: new DefaultCompletionValidatorFactory(),
    retryHandlerFactory: new DefaultRetryHandlerFactory(),
  };
}

// ============================================================================
// Builder Class
// ============================================================================

type AgentRunnerType = import("./runner.ts").AgentRunner;

/**
 * Builder for creating AgentRunner instances with dependency injection.
 */
export class AgentRunnerBuilder {
  private definition?: ResolvedAgentDefinition;
  private dependencies: MutableAgentDependencies = {};

  /**
   * Set the agent definition.
   */
  withDefinition(def: ResolvedAgentDefinition): this {
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
   * Build the AgentRunner with configured dependencies.
   */
  async build(): Promise<AgentRunnerType> {
    if (!this.definition) {
      throw new Error(
        "AgentDefinition is required. Call withDefinition() first.",
      );
    }

    const deps = this.buildDependencies();

    // Dynamic import to avoid circular dependencies
    const { AgentRunner } = await import("./runner.ts");
    return new AgentRunner(this.definition, deps);
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
      completionValidatorFactory:
        this.dependencies.completionValidatorFactory ??
          defaults.completionValidatorFactory,
      retryHandlerFactory: this.dependencies.retryHandlerFactory ??
        defaults.retryHandlerFactory,
    };
  }
}
