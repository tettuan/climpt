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
import type { VerdictHandler } from "../verdict/types.ts";
import type { Logger } from "../src_common/logger.ts";
import type { PromptResolver } from "../common/prompt-resolver.ts";
import type { StepValidator } from "../validators/step/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";

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
 * Factory interface for VerdictHandler creation.
 */
export interface VerdictHandlerFactory {
  create(
    definition: AgentDefinition,
    args: Record<string, unknown>,
    agentDir: string,
  ): Promise<VerdictHandler>;
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
}

/**
 * Options for StepValidator creation via factory.
 */
export interface StepValidatorFactoryOptions {
  registry: ExtendedStepsRegistry;
  workingDir: string;
  logger: Logger;
  agentId: string;
}

/**
 * Factory interface for StepValidator creation.
 */
export interface StepValidatorFactory {
  create(options: StepValidatorFactoryOptions): StepValidator;
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
  readonly verdictHandlerFactory: VerdictHandlerFactory;
  readonly promptResolverFactory: PromptResolverFactory;
  readonly stepValidatorFactory?: StepValidatorFactory;
  readonly retryHandlerFactory?: RetryHandlerFactory;
}

/**
 * Mutable version of AgentDependencies for internal builder use.
 */
interface MutableAgentDependencies {
  loggerFactory?: LoggerFactory;
  verdictHandlerFactory?: VerdictHandlerFactory;
  promptResolverFactory?: PromptResolverFactory;
  stepValidatorFactory?: StepValidatorFactory;
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
 * Default factory implementation for VerdictHandler.
 */
export class DefaultVerdictHandlerFactory implements VerdictHandlerFactory {
  async create(
    definition: AgentDefinition,
    args: Record<string, unknown>,
    agentDir: string,
  ): Promise<VerdictHandler> {
    const { createRegistryVerdictHandler } = await import(
      "../verdict/mod.ts"
    );
    return createRegistryVerdictHandler(definition, args, agentDir);
  }
}

/**
 * Default factory implementation for PromptResolver.
 */
export class DefaultPromptResolverFactory implements PromptResolverFactory {
  async create(options: PromptResolverFactoryOptions): Promise<PromptResolver> {
    const { join } = await import("@std/path");
    const { loadStepRegistry } = await import(
      "../common/step-registry.ts"
    );
    const { PromptResolver } = await import(
      "../common/prompt-resolver.ts"
    );

    // T38 / critique-6 N#5: the SR-LOAD-003 swallow is owned by the
    // loader (`allowMissing: true`). The PromptResolver factory only
    // needs `c1` for prompt path suffixing, so a fabricated empty
    // registry is acceptable when the file is absent. All other
    // ConfigError codes (SR-VALID-* legacy shape / field validation,
    // SR-LOAD-002 agentId mismatch, SR-INTENT-*) and any
    // non-ConfigError exception still propagate from the loader.
    //
    // T29 / critique-5 B#2: schemasDir is type-required for the strict
    // (default) loader variant. The resolver factory operates inside an
    // agent's directory, so schemasDir = `<agentDir>/schemas` per
    // PATHS.SCHEMAS_DIR convention.
    const { PATHS } = await import("../shared/paths.ts");
    const registry = await loadStepRegistry(
      options.agentName,
      options.agentDir,
      {
        registryPath: join(options.agentDir, options.registryPath),
        schemasDir: join(options.agentDir, PATHS.SCHEMAS_DIR),
        allowMissing: true,
      },
    );
    return new PromptResolver(registry, {
      workingDir: Deno.cwd(),
      configSuffix: registry.c1,
    });
  }
}

/**
 * Default factory implementation for StepValidator.
 */
export class DefaultStepValidatorFactory
  implements StepValidatorFactory, Initializable {
  private createFn:
    | ((
      registry: import("../validators/step/types.ts").ValidatorRegistry,
      ctx: import("../validators/step/types.ts").StepValidatorContext,
    ) => StepValidator)
    | null = null;

  async initialize(): Promise<void> {
    const mod = await import("../validators/step/validator.ts");
    this.createFn = mod.createStepValidator;
  }

  create(options: StepValidatorFactoryOptions): StepValidator {
    if (!this.createFn) {
      throw new Error(
        "DefaultStepValidatorFactory not initialized. Call initialize() first.",
      );
    }
    return this.createFn(
      {
        validators: options.registry.validators ?? {},
        failurePatterns: options.registry.failurePatterns,
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
    verdictHandlerFactory: new DefaultVerdictHandlerFactory(),
    promptResolverFactory: new DefaultPromptResolverFactory(),
    stepValidatorFactory: new DefaultStepValidatorFactory(),
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
   * Set a custom verdict handler factory.
   */
  withVerdictHandlerFactory(factory: VerdictHandlerFactory): this {
    this.dependencies.verdictHandlerFactory = factory;
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
   * Set a custom step validator factory.
   */
  withStepValidatorFactory(factory: StepValidatorFactory): this {
    this.dependencies.stepValidatorFactory = factory;
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
      verdictHandlerFactory: this.dependencies.verdictHandlerFactory ??
        defaults.verdictHandlerFactory,
      promptResolverFactory: this.dependencies.promptResolverFactory ??
        defaults.promptResolverFactory,
      stepValidatorFactory: this.dependencies.stepValidatorFactory ??
        defaults.stepValidatorFactory,
      retryHandlerFactory: this.dependencies.retryHandlerFactory ??
        defaults.retryHandlerFactory,
    };
  }
}
