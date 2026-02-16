/**
 * Tests for Agent Definition Loader
 *
 * Focus on config loading, parsing, validation, and error handling.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  agentExists,
  getAgentDir,
  listAgents,
  loadAgentDefinition,
  validateAgentDefinition,
} from "./loader.ts";
import type { AgentDefinition } from "../src_common/types.ts";

const logger = new BreakdownLogger("config");

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a minimal valid agent definition
 */
function createValidDefinition(): AgentDefinition {
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
      completion: {
        type: "iterationBudget",
        config: { maxIterations: 10 },
      },
      boundaries: {
        allowedTools: ["Read", "Write"],
        permissionMode: "plan",
      },
      execution: {},
      telemetry: {
        logging: {
          directory: "./logs",
          format: "jsonl",
        },
      },
    },
  };
}

/**
 * Create an invalid definition (missing required fields)
 * @internal Reserved for future test cases
 */
function _createInvalidDefinition(): Partial<AgentDefinition> {
  return {
    name: "test",
    // Missing required fields: version, displayName, description, runner
  };
}

// =============================================================================
// validateAgentDefinition Tests - Required Fields
// =============================================================================

Deno.test("validateAgentDefinition - valid definition passes", () => {
  const def = createValidDefinition();
  const result = validateAgentDefinition(def);
  logger.debug("validation result", {
    valid: result.valid,
    errors: result.errors,
  });

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("validateAgentDefinition - missing version fails", () => {
  const def = createValidDefinition();
  def.version = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("version")), true);
});

Deno.test("validateAgentDefinition - missing name fails", () => {
  const def = createValidDefinition();
  def.name = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("name")), true);
});

Deno.test("validateAgentDefinition - missing displayName fails", () => {
  const def = createValidDefinition();
  def.displayName = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("displayName")), true);
});

Deno.test("validateAgentDefinition - missing description fails", () => {
  const def = createValidDefinition();
  def.description = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("description")), true);
});

Deno.test("validateAgentDefinition - missing runner fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.runner = undefined;

  logger.debug("validateAgentDefinition input", {
    hasRunner: def.runner !== undefined,
  });
  const result = validateAgentDefinition(def);
  logger.debug("validateAgentDefinition result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("runner")), true);
});

// =============================================================================
// validateAgentDefinition Tests - Name Format
// =============================================================================

Deno.test("validateAgentDefinition - valid kebab-case name passes", () => {
  const def = createValidDefinition();
  def.name = "my-test-agent";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, true);
});

Deno.test("validateAgentDefinition - uppercase name fails", () => {
  const def = createValidDefinition();
  def.name = "TestAgent";

  logger.debug("validateAgentDefinition input", { name: def.name });
  const result = validateAgentDefinition(def);
  logger.debug("validateAgentDefinition result", {
    valid: result.valid,
    errors: result.errors,
  });

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("kebab-case")), true);
});

Deno.test("validateAgentDefinition - name starting with number fails", () => {
  const def = createValidDefinition();
  def.name = "123-agent";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("kebab-case")), true);
});

Deno.test("validateAgentDefinition - name with underscore fails", () => {
  const def = createValidDefinition();
  def.name = "test_agent";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("kebab-case")), true);
});

// =============================================================================
// validateAgentDefinition Tests - Version Format
// =============================================================================

Deno.test("validateAgentDefinition - valid semver passes", () => {
  const def = createValidDefinition();
  def.version = "1.2.3";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, true);
});

Deno.test("validateAgentDefinition - invalid semver format fails", () => {
  const def = createValidDefinition();
  def.version = "1.2";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("semver")), true);
});

Deno.test("validateAgentDefinition - semver with v prefix fails", () => {
  const def = createValidDefinition();
  def.version = "v1.0.0";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("semver")), true);
});

// =============================================================================
// validateAgentDefinition Tests - Runner Validation
// =============================================================================

Deno.test("validateAgentDefinition - missing systemPromptPath fails", () => {
  const def = createValidDefinition();
  def.runner.flow.systemPromptPath = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("systemPromptPath")),
    true,
  );
});

Deno.test("validateAgentDefinition - missing completion type fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.runner.completion.type = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("completion.type")),
    true,
  );
});

Deno.test("validateAgentDefinition - invalid completion type fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.runner.completion.type = "invalid-type";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("completion.type")),
    true,
  );
});

Deno.test("validateAgentDefinition - missing permissionMode fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.runner.boundaries.permissionMode = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("permissionMode")), true);
});

Deno.test("validateAgentDefinition - invalid permissionMode fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.runner.boundaries.permissionMode = "invalid-mode";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("permissionMode")), true);
});

// =============================================================================
// validateAgentDefinition Tests - Completion Type Specific
// =============================================================================

Deno.test("validateAgentDefinition - iterationBudget type requires maxIterations", () => {
  const def = createValidDefinition();
  def.runner.completion.type = "iterationBudget";
  def.runner.completion.config = {}; // Missing maxIterations

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("maxIterations")), true);
});

Deno.test("validateAgentDefinition - iterationBudget with negative maxIterations fails", () => {
  const def = createValidDefinition();
  def.runner.completion.type = "iterationBudget";
  def.runner.completion.config = { maxIterations: -1 };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("maxIterations")), true);
});

Deno.test("validateAgentDefinition - keywordSignal type requires completionKeyword", () => {
  const def = createValidDefinition();
  def.runner.completion.type = "keywordSignal";
  def.runner.completion.config = {}; // Missing completionKeyword

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("completionKeyword")),
    true,
  );
});

Deno.test("validateAgentDefinition - custom type requires handlerPath", () => {
  const def = createValidDefinition();
  def.runner.completion.type = "custom";
  def.runner.completion.config = {}; // Missing handlerPath

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("handlerPath")), true);
});

Deno.test("validateAgentDefinition - composite type requires conditions", () => {
  const def = createValidDefinition();
  def.runner.completion.type = "composite";
  def.runner.completion.config = {
    operator: "and",
    conditions: [{ type: "iterationBudget", config: { maxIterations: 5 } }],
  };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, true);
});

// =============================================================================
// validateAgentDefinition Tests - Prompts and Logging
// =============================================================================

Deno.test("validateAgentDefinition - missing prompts.registry fails", () => {
  const def = createValidDefinition();
  def.runner.flow.prompts.registry = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("registry")), true);
});

Deno.test("validateAgentDefinition - missing prompts.fallbackDir fails", () => {
  const def = createValidDefinition();
  def.runner.flow.prompts.fallbackDir = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("fallbackDir")), true);
});

Deno.test("validateAgentDefinition - missing logging.directory fails", () => {
  const def = createValidDefinition();
  def.runner.telemetry.logging.directory = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("directory")), true);
});

Deno.test("validateAgentDefinition - invalid logging.format fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.runner.telemetry.logging.format = "xml";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("format")), true);
});

// =============================================================================
// validateAgentDefinition Tests - Parameter Validation
// =============================================================================

Deno.test("validateAgentDefinition - parameter without cli flag fails", () => {
  const def = createValidDefinition();
  def.parameters = {
    testParam: {
      type: "string",
      description: "Test parameter",
      required: true,
      cli: "", // Missing cli flag
    },
  };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("cli flag")), true);
});

Deno.test("validateAgentDefinition - parameter cli without -- prefix fails", () => {
  const def = createValidDefinition();
  def.parameters = {
    testParam: {
      type: "string",
      description: "Test parameter",
      required: true,
      cli: "param", // Missing -- prefix
    },
  };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("--")), true);
});

Deno.test("validateAgentDefinition - parameter without type fails", () => {
  const def = createValidDefinition();
  def.parameters = {
    testParam: {
      type: "" as "string",
      description: "Test parameter",
      required: true,
      cli: "--param",
    },
  };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("type")), true);
});

Deno.test("validateAgentDefinition - parameter without description generates warning", () => {
  const def = createValidDefinition();
  def.parameters = {
    testParam: {
      type: "string",
      description: "", // Missing description
      required: true,
      cli: "--param",
    },
  };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, true); // Still valid but with warning
  assertEquals(
    result.warnings.some((w) => w.includes("description")),
    true,
  );
});

Deno.test("validateAgentDefinition - required param with default generates warning", () => {
  const def = createValidDefinition();
  def.parameters = {
    testParam: {
      type: "string",
      description: "Test parameter",
      required: true,
      default: "value", // Has default but is required
      cli: "--param",
    },
  };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, true); // Still valid but with warning
  assertEquals(result.warnings.some((w) => w.includes("required")), true);
});

// =============================================================================
// getAgentDir Tests
// =============================================================================

Deno.test("getAgentDir - returns correct path", () => {
  logger.debug("getAgentDir input", {
    agentName: "test-agent",
    baseDir: "/home/user/project",
  });
  const result = getAgentDir("test-agent", "/home/user/project");
  logger.debug("getAgentDir result", { result });
  assertEquals(result, "/home/user/project/.agent/test-agent");
});

Deno.test("getAgentDir - uses cwd when not specified", () => {
  const result = getAgentDir("my-agent");
  assertEquals(result.endsWith(".agent/my-agent"), true);
});

// =============================================================================
// loadAgentDefinition Tests - Error Handling
// =============================================================================

Deno.test("loadAgentDefinition - throws for non-existent agent", async () => {
  await assertRejects(
    async () => {
      await loadAgentDefinition("non-existent-agent-12345", "/tmp");
    },
    Error,
    "not found",
  );
});

// =============================================================================
// agentExists Tests
// =============================================================================

Deno.test("agentExists - returns false for non-existent agent", async () => {
  const result = await agentExists("non-existent-agent-67890", "/tmp");
  assertEquals(result, false);
});

// =============================================================================
// listAgents Tests
// =============================================================================

Deno.test("listAgents - returns empty array when no agents dir", async () => {
  const result = await listAgents("/tmp/non-existent-path-xyz");
  assertEquals(result, []);
});
