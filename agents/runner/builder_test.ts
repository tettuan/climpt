/**
 * Tests for AgentRunnerBuilder - Dependency Injection
 *
 * Focus on builder pattern, factory interfaces, and dependency injection.
 * Tests validate that builders correctly wire dependencies.
 */

import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  type AgentDependencies,
  AgentRunnerBuilder,
  createDefaultDependencies,
  DefaultLoggerFactory,
  DefaultPromptResolverFactory,
  DefaultRetryHandlerFactory,
  DefaultStepValidatorFactory,
  DefaultVerdictHandlerFactory,
  isInitializable,
  type LoggerFactory,
  type LoggerFactoryOptions,
  type PromptResolverFactory,
  type PromptResolverFactoryOptions,
  type VerdictHandlerFactory,
} from "./builder.ts";
import type { ResolvedAgentDefinition } from "../src_common/types.ts";
import type { Logger } from "../src_common/logger.ts";
import type { VerdictHandler } from "../verdict/types.ts";
import type { PromptResolver } from "../common/prompt-resolver.ts";

const logger = new BreakdownLogger("factory");

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create minimal valid agent definition for testing
 */
function createMinimalDefinition(): ResolvedAgentDefinition {
  return {
    name: "test-agent",
    displayName: "Test Agent",
    description: "Test agent for unit tests",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "./prompts/system.md",
        prompts: {
          registry: "./prompts/registry.json",
          fallbackDir: "./prompts",
        },
      },
      verdict: {
        type: "count:iteration",
        config: { maxIterations: 10 },
      },
      boundaries: {
        allowedTools: [],
        permissionMode: "plan",
      },
      execution: {},
      logging: {
        directory: "./logs",
        format: "jsonl",
      },
    },
  };
}

/**
 * Mock logger for testing
 */
function createMockLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    log: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addContext: () => {},
    getLogPath: () => "/tmp/mock.log",
    // Additional methods that may be required
  } as unknown as Logger;
}

/**
 * Mock verdict handler for testing
 */
function createMockVerdictHandler(): VerdictHandler {
  return {
    shouldComplete: () => ({ complete: false }),
    onComplete: () => {},
    getVerdictReason: () => "mock verdict",
    getCurrentIteration: () => 1,
    handleAIVerdict: () => {},
    updateState: () => {},
    getState: () => ({ iteration: 1 }),
  } as unknown as VerdictHandler;
}

/**
 * Mock prompt resolver for testing
 */
function createMockPromptResolver(): PromptResolver {
  return {
    resolve: () => Promise.resolve("mock prompt"),
    getStepsRegistry: () => Promise.resolve(null),
  } as unknown as PromptResolver;
}

// =============================================================================
// isInitializable Type Guard Tests
// =============================================================================

Deno.test("isInitializable - returns true for objects with initialize method", () => {
  const initializableObject = {
    initialize: async () => {},
  };
  logger.debug("isInitializable input", {
    hasInitialize: typeof initializableObject.initialize,
  });
  const result = isInitializable(initializableObject);
  logger.debug("isInitializable result", { result });
  assertEquals(result, true);
});

Deno.test("isInitializable - returns false for objects without initialize method", () => {
  const regularObject = {
    create: () => {},
  };
  assertEquals(isInitializable(regularObject), false);
});

Deno.test("isInitializable - returns false for null", () => {
  assertEquals(isInitializable(null), false);
});

Deno.test("isInitializable - returns false for non-objects", () => {
  assertEquals(isInitializable("string"), false);
  assertEquals(isInitializable(42), false);
  assertEquals(isInitializable(undefined), false);
});

// =============================================================================
// createDefaultDependencies Tests
// =============================================================================

Deno.test("createDefaultDependencies - returns all required factories", () => {
  logger.debug("createDefaultDependencies input", {});
  const deps = createDefaultDependencies();
  logger.debug("createDefaultDependencies result", {
    hasLogger: !!deps.loggerFactory,
    hasVerdict: !!deps.verdictHandlerFactory,
    hasPrompt: !!deps.promptResolverFactory,
  });

  assertEquals(typeof deps.loggerFactory, "object");
  assertEquals(typeof deps.loggerFactory.create, "function");

  assertEquals(typeof deps.verdictHandlerFactory, "object");
  assertEquals(typeof deps.verdictHandlerFactory.create, "function");

  assertEquals(typeof deps.promptResolverFactory, "object");
  assertEquals(typeof deps.promptResolverFactory.create, "function");
});

Deno.test("createDefaultDependencies - includes optional factories", () => {
  const deps = createDefaultDependencies();

  assertEquals(deps.stepValidatorFactory !== undefined, true);
  assertEquals(deps.retryHandlerFactory !== undefined, true);
});

Deno.test("createDefaultDependencies - factories are correct types", () => {
  const deps = createDefaultDependencies();

  assertInstanceOf(deps.loggerFactory, DefaultLoggerFactory);
  assertInstanceOf(
    deps.verdictHandlerFactory,
    DefaultVerdictHandlerFactory,
  );
  assertInstanceOf(deps.promptResolverFactory, DefaultPromptResolverFactory);
  assertInstanceOf(
    deps.stepValidatorFactory,
    DefaultStepValidatorFactory,
  );
  assertInstanceOf(deps.retryHandlerFactory, DefaultRetryHandlerFactory);
});

// =============================================================================
// Default Factory Implementation Tests
// =============================================================================

Deno.test("DefaultStepValidatorFactory - is initializable", () => {
  const factory = new DefaultStepValidatorFactory();
  assertEquals(isInitializable(factory), true);
});

Deno.test("DefaultStepValidatorFactory - throws before initialization", () => {
  const factory = new DefaultStepValidatorFactory();

  try {
    factory.create({
      registry: {
        version: "1.0.0",
      } as unknown as import("../common/validation-types.ts").ExtendedStepsRegistry,
      workingDir: "/tmp",
      logger: createMockLogger(),
      agentId: "test",
    });
    throw new Error("Expected error to be thrown");
  } catch (e) {
    assertInstanceOf(e, Error);
    assertEquals((e as Error).message.includes("not initialized"), true);
  }
});

Deno.test("DefaultRetryHandlerFactory - is initializable", () => {
  const factory = new DefaultRetryHandlerFactory();
  assertEquals(isInitializable(factory), true);
});

Deno.test("DefaultRetryHandlerFactory - throws before initialization", () => {
  const factory = new DefaultRetryHandlerFactory();

  try {
    factory.create({
      registry: {
        version: "1.0.0",
      } as unknown as import("../common/validation-types.ts").ExtendedStepsRegistry,
      workingDir: "/tmp",
      logger: createMockLogger(),
      agentId: "test",
    });
    throw new Error("Expected error to be thrown");
  } catch (e) {
    assertInstanceOf(e, Error);
    assertEquals((e as Error).message.includes("not initialized"), true);
  }
});

// =============================================================================
// AgentRunnerBuilder Tests
// =============================================================================

Deno.test("AgentRunnerBuilder - build throws without definition", async () => {
  const builder = new AgentRunnerBuilder();

  await assertRejects(
    async () => {
      await builder.build();
    },
    Error,
    "AgentDefinition is required",
  );
});

Deno.test("AgentRunnerBuilder - withDefinition sets definition", () => {
  const builder = new AgentRunnerBuilder();
  const definition = createMinimalDefinition();

  const result = builder.withDefinition(definition);

  // Builder pattern should return this for chaining
  assertEquals(result, builder);
});

Deno.test("AgentRunnerBuilder - builder methods return this for chaining", () => {
  const builder = new AgentRunnerBuilder();
  const definition = createMinimalDefinition();

  // Create mock factories
  const mockLoggerFactory: LoggerFactory = {
    create: (_options: LoggerFactoryOptions) =>
      Promise.resolve(createMockLogger()),
  };

  const mockVerdictFactory: VerdictHandlerFactory = {
    create: () => Promise.resolve(createMockVerdictHandler()),
  };

  const mockPromptFactory: PromptResolverFactory = {
    create: (_options: PromptResolverFactoryOptions) =>
      Promise.resolve(createMockPromptResolver()),
  };

  // All methods should return the builder for chaining
  const result = builder
    .withDefinition(definition)
    .withLoggerFactory(mockLoggerFactory)
    .withVerdictHandlerFactory(mockVerdictFactory)
    .withPromptResolverFactory(mockPromptFactory);

  assertEquals(result, builder);
});

Deno.test("AgentRunnerBuilder - custom factories override defaults", async () => {
  const definition = createMinimalDefinition();

  // Create mock factories that return promises
  const mockLoggerFactory: LoggerFactory = {
    create: (_options: LoggerFactoryOptions) =>
      Promise.resolve(createMockLogger()),
  };

  const mockVerdictFactory: VerdictHandlerFactory = {
    create: () => Promise.resolve(createMockVerdictHandler()),
  };

  const mockPromptFactory: PromptResolverFactory = {
    create: (_options: PromptResolverFactoryOptions) =>
      Promise.resolve(createMockPromptResolver()),
  };

  const builder = new AgentRunnerBuilder()
    .withDefinition(definition)
    .withLoggerFactory(mockLoggerFactory)
    .withVerdictHandlerFactory(mockVerdictFactory)
    .withPromptResolverFactory(mockPromptFactory);

  // Build creates the runner which uses the factories
  logger.debug("building runner with custom factories");
  const runner = await builder.build();
  logger.debug("runner built", { hasOn: typeof runner.on });

  // Verify runner was created
  assertEquals(typeof runner, "object");
  assertEquals(typeof runner.on, "function");

  // Note: Factories are called during initialization, not during build
  // The builder just stores the factories
});

// =============================================================================
// AgentDependencies Interface Tests
// =============================================================================

Deno.test("AgentDependencies - required properties are present", () => {
  const deps = createDefaultDependencies();

  // Required factories must be present
  const requiredKeys: (keyof AgentDependencies)[] = [
    "loggerFactory",
    "verdictHandlerFactory",
    "promptResolverFactory",
  ];

  for (const key of requiredKeys) {
    assertEquals(deps[key] !== undefined, true, `${key} should be defined`);
  }
});

Deno.test("AgentDependencies - optional properties can be undefined", () => {
  // Create minimal dependencies without optional factories
  const minimalDeps: AgentDependencies = {
    loggerFactory: new DefaultLoggerFactory(),
    verdictHandlerFactory: new DefaultVerdictHandlerFactory(),
    promptResolverFactory: new DefaultPromptResolverFactory(),
  };

  // Optional factories can be undefined
  assertEquals(minimalDeps.stepValidatorFactory, undefined);
  assertEquals(minimalDeps.retryHandlerFactory, undefined);
});
