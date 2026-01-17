/**
 * Tests for Agent Definition Loader
 *
 * Focus on config loading, parsing, validation, and error handling.
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  agentExists,
  getAgentDir,
  listAgents,
  loadAgentDefinition,
  validateAgentDefinition,
} from "./loader.ts";
import type { AgentDefinition } from "../src_common/types.ts";

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
    behavior: {
      systemPromptPath: "./prompts/system.md",
      completionType: "iterate",
      completionConfig: { maxIterations: 10 },
      allowedTools: ["Read", "Write"],
      permissionMode: "plan",
    },
    parameters: {},
    prompts: {
      registry: "./prompts/registry.json",
      fallbackDir: "./prompts",
    },
    logging: {
      directory: "./logs",
      format: "jsonl",
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
    // Missing required fields: version, displayName, description, behavior, prompts, logging
  };
}

// =============================================================================
// validateAgentDefinition Tests - Required Fields
// =============================================================================

Deno.test("validateAgentDefinition - valid definition passes", () => {
  const def = createValidDefinition();
  const result = validateAgentDefinition(def);

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

Deno.test("validateAgentDefinition - missing behavior fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.behavior = undefined;

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("behavior")), true);
});

Deno.test("validateAgentDefinition - missing prompts fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.prompts = undefined;

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("prompts")), true);
});

Deno.test("validateAgentDefinition - missing logging fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.logging = undefined;

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("logging")), true);
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

  const result = validateAgentDefinition(def);

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
// validateAgentDefinition Tests - Behavior Validation
// =============================================================================

Deno.test("validateAgentDefinition - missing systemPromptPath fails", () => {
  const def = createValidDefinition();
  def.behavior.systemPromptPath = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("systemPromptPath")),
    true,
  );
});

Deno.test("validateAgentDefinition - missing completionType fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.behavior.completionType = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("completionType")), true);
});

Deno.test("validateAgentDefinition - invalid completionType fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.behavior.completionType = "invalid-type";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("completionType")), true);
});

Deno.test("validateAgentDefinition - missing permissionMode fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.behavior.permissionMode = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("permissionMode")), true);
});

Deno.test("validateAgentDefinition - invalid permissionMode fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.behavior.permissionMode = "invalid-mode";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("permissionMode")), true);
});

// =============================================================================
// validateAgentDefinition Tests - Completion Type Specific
// =============================================================================

Deno.test("validateAgentDefinition - iterate type requires maxIterations", () => {
  const def = createValidDefinition();
  def.behavior.completionType = "iterate";
  def.behavior.completionConfig = {}; // Missing maxIterations

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("maxIterations")), true);
});

Deno.test("validateAgentDefinition - iterate with negative maxIterations fails", () => {
  const def = createValidDefinition();
  def.behavior.completionType = "iterate";
  def.behavior.completionConfig = { maxIterations: -1 };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("maxIterations")), true);
});

Deno.test("validateAgentDefinition - manual type requires completionKeyword", () => {
  const def = createValidDefinition();
  def.behavior.completionType = "manual";
  def.behavior.completionConfig = {}; // Missing completionKeyword

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("completionKeyword")),
    true,
  );
});

Deno.test("validateAgentDefinition - custom type requires handlerPath", () => {
  const def = createValidDefinition();
  def.behavior.completionType = "custom";
  def.behavior.completionConfig = {}; // Missing handlerPath

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("handlerPath")), true);
});

// =============================================================================
// validateAgentDefinition Tests - Legacy Type Names (Deprecated)
// =============================================================================

Deno.test("validateAgentDefinition - legacy 'issue' type generates warning", () => {
  const def = createValidDefinition();
  def.behavior.completionType = "issue";
  def.behavior.completionConfig = {};

  const result = validateAgentDefinition(def);

  // Should be valid but with deprecation warning
  assertEquals(result.valid, true);
  assertEquals(result.warnings.some((w) => w.includes("deprecated")), true);
  assertEquals(result.warnings.some((w) => w.includes("externalState")), true);
});

Deno.test("validateAgentDefinition - legacy 'facilitator' type generates warning", () => {
  const def = createValidDefinition();
  def.behavior.completionType = "facilitator";
  def.behavior.completionConfig = {
    operator: "and",
    conditions: [{ type: "iterate", config: { maxIterations: 5 } }],
  };

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, true);
  assertEquals(result.warnings.some((w) => w.includes("deprecated")), true);
  assertEquals(result.warnings.some((w) => w.includes("composite")), true);
});

// =============================================================================
// validateAgentDefinition Tests - Prompts and Logging
// =============================================================================

Deno.test("validateAgentDefinition - missing prompts.registry fails", () => {
  const def = createValidDefinition();
  def.prompts.registry = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("registry")), true);
});

Deno.test("validateAgentDefinition - missing prompts.fallbackDir fails", () => {
  const def = createValidDefinition();
  def.prompts.fallbackDir = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("fallbackDir")), true);
});

Deno.test("validateAgentDefinition - missing logging.directory fails", () => {
  const def = createValidDefinition();
  def.logging.directory = "";

  const result = validateAgentDefinition(def);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("directory")), true);
});

Deno.test("validateAgentDefinition - invalid logging.format fails", () => {
  const def = createValidDefinition();
  // @ts-ignore - intentionally testing invalid state
  def.logging.format = "xml";

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
  const result = getAgentDir("test-agent", "/home/user/project");
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
