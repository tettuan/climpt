/**
 * Tests for agents/config/schema-validator.ts
 *
 * Covers validateAgentSchema() and validateRegistrySchema()
 * with valid data, type mismatches, missing required fields,
 * enum violations, pattern checks, oneOf, $ref resolution, and
 * array/null type unions.
 */

import { assert, assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  validateAgentSchema,
  validateRegistrySchema,
} from "./schema-validator.ts";
import { ALL_VERDICT_TYPES } from "../src_common/types/verdict.ts";

const logger = new BreakdownLogger("schema-validator");

// =============================================================================
// Fixtures - Minimal valid agent.json
// =============================================================================

function minimalValidAgent(): Record<string, unknown> {
  return {
    version: "1.0.0",
    name: "test-agent",
    displayName: "Test Agent",
    description: "A test agent",
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: {
          registry: "steps_registry.json",
          fallbackDir: "prompts/",
        },
      },
      verdict: {
        type: "count:iteration",
        config: {
          maxIterations: 10,
        },
      },
      boundaries: {
        allowedTools: ["Read", "Write"],
        permissionMode: "default",
      },
    },
  };
}

function minimalValidRegistry(): Record<string, unknown> {
  return {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.default": {
        stepId: "initial.default",
        name: "Initial",
        c2: "initial",
        c3: "default",
        edition: "default",
        uvVariables: [],
        usesStdin: false,
        transitions: {
          next: { target: "continuation.default" },
          repeat: { target: "initial.default" },
        },
      },
      "continuation.default": {
        stepId: "continuation.default",
        name: "Continuation",
        c2: "continuation",
        c3: "default",
        edition: "default",
        uvVariables: [],
        usesStdin: false,
        transitions: {
          next: { target: "closure.default" },
          repeat: { target: "continuation.default" },
        },
      },
      "closure.default": {
        stepId: "closure.default",
        name: "Closure",
        c2: "closure",
        c3: "default",
        edition: "default",
        uvVariables: [],
        usesStdin: false,
        transitions: {
          closing: { target: null },
          repeat: { target: "closure.default" },
        },
      },
    },
    entryStepMapping: {
      issue: "initial.default",
    },
  };
}

// =============================================================================
// validateAgentSchema - Valid data
// =============================================================================

Deno.test("schema-validator/agent - valid minimal agent passes", async () => {
  const data = minimalValidAgent();
  logger.debug("validateAgentSchema input", { name: data.name });
  const result = await validateAgentSchema(data);
  logger.debug("validateAgentSchema result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("schema-validator/agent - full iterator-like agent passes", async () => {
  const data = {
    version: "1.12.0",
    name: "iterator",
    displayName: "Iterator Agent",
    description: "Autonomous development agent",
    parameters: {
      issue: {
        type: "number",
        description: "GitHub Issue number",
        required: true,
        cli: "--issue",
      },
    },
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: {
          registry: "steps_registry.json",
          fallbackDir: "prompts/",
        },
      },
      verdict: {
        type: "poll:state",
        config: { maxIterations: 500 },
      },
      boundaries: {
        allowedTools: ["Read", "Write", "Bash"],
        permissionMode: "acceptEdits",
      },
      integrations: {
        github: {
          enabled: true,
          labels: {
            requirements: "docs",
            inProgress: "in-progress",
            blocked: "need clearance",
            completion: { add: ["done"], remove: ["in-progress"] },
          },
          defaultClosureAction: "label-only",
        },
      },
      execution: {
        worktree: { enabled: true, root: "../worktree" },
      },
      logging: {
        directory: "tmp/logs/agents/iterator",
        format: "jsonl",
        maxFiles: 100,
      },
    },
  };

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

// =============================================================================
// validateAgentSchema - Missing required fields
// =============================================================================

Deno.test("schema-validator/agent - missing name reports error", async () => {
  const data = minimalValidAgent();
  delete data.name;

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, false);
  const nameError = result.errors.find((e) =>
    e.path === "name" && e.message.includes("Required")
  );
  assertEquals(nameError !== undefined, true);
});

Deno.test("schema-validator/agent - missing version reports error", async () => {
  const data = minimalValidAgent();
  delete data.version;

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, false);
  const versionError = result.errors.find((e) =>
    e.path === "version" && e.message.includes("Required")
  );
  assertEquals(versionError !== undefined, true);
});

Deno.test("schema-validator/agent - missing runner reports error", async () => {
  const data = minimalValidAgent();
  delete data.runner;

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, false);
  const runnerError = result.errors.find((e) =>
    e.path === "runner" && e.message.includes("Required")
  );
  assertEquals(runnerError !== undefined, true);
});

// =============================================================================
// validateAgentSchema - Type mismatches
// =============================================================================

Deno.test("schema-validator/agent - wrong type for name", async () => {
  const data = minimalValidAgent();
  data.name = 123;

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, false);
  const typeError = result.errors.find((e) =>
    e.path === "name" && e.message.includes("type")
  );
  assertEquals(typeError !== undefined, true);
});

Deno.test("schema-validator/agent - wrong type for version", async () => {
  const data = minimalValidAgent();
  data.version = true;

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, false);
  const typeError = result.errors.find((e) =>
    e.path === "version" && e.message.includes("type")
  );
  assertEquals(typeError !== undefined, true);
});

// =============================================================================
// validateAgentSchema - Enum violations
// =============================================================================

Deno.test("schema-validator/agent - invalid verdict type rejects", async () => {
  const data = minimalValidAgent();
  (data.runner as Record<string, unknown>).verdict = {
    type: "invalidType",
    config: {},
  };

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, false);
  const enumError = result.errors.find((e) =>
    e.message.includes("enum") || e.message.includes("not in")
  );
  assertEquals(enumError !== undefined, true);
});

Deno.test("schema-validator/agent - valid verdict types pass", async () => {
  const verdictTypes = ALL_VERDICT_TYPES;
  assert(
    verdictTypes.length > 0,
    "No verdict types found — source of truth may have changed",
  );

  for (const vt of verdictTypes) {
    const data = minimalValidAgent();
    const runner = data.runner as Record<string, unknown>;
    runner.verdict = {
      type: vt,
      config: {},
    };

    const result = await validateAgentSchema(data);
    logger.debug("verdict type check", { type: vt, valid: result.valid });

    assertEquals(
      result.valid,
      true,
      `verdict type "${vt}" should pass schema validation. Errors: ${
        JSON.stringify(result.errors)
      }`,
    );
  }
});

// =============================================================================
// validateAgentSchema - Pattern validation
// =============================================================================

Deno.test("schema-validator/agent - version pattern requires semver-like", async () => {
  const data = minimalValidAgent();
  data.version = "not-a-version";

  const result = await validateAgentSchema(data);

  // Schema defines pattern: "^\\d+\\.\\d+\\.\\d+$"
  const patternError = result.errors.find((e) =>
    e.path === "version" && e.message.includes("pattern")
  );
  assertEquals(patternError !== undefined, true);
});

// =============================================================================
// validateRegistrySchema - Valid data
// =============================================================================

Deno.test("schema-validator/registry - valid minimal registry passes", async () => {
  const data = minimalValidRegistry();
  logger.debug("validateRegistrySchema input", { agentId: data.agentId });
  const result = await validateRegistrySchema(data);
  logger.debug("validateRegistrySchema result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

// =============================================================================
// validateRegistrySchema - Missing required fields
// =============================================================================

Deno.test("schema-validator/registry - missing agentId reports error", async () => {
  const data = minimalValidRegistry();
  delete data.agentId;

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.path === "agentId" && e.message.includes("Required")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("schema-validator/registry - missing version reports error", async () => {
  const data = minimalValidRegistry();
  delete data.version;

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.path === "version" && e.message.includes("Required")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("schema-validator/registry - missing steps reports error", async () => {
  const data = minimalValidRegistry();
  delete data.steps;

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.path === "steps" && e.message.includes("Required")
  );
  assertEquals(error !== undefined, true);
});

// =============================================================================
// validateRegistrySchema - Null target (terminal transition)
// =============================================================================

Deno.test("schema-validator/registry - null target in transition is valid", async () => {
  const data = minimalValidRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["closure.default"].transitions = {
    closing: { target: null },
  };

  const result = await validateRegistrySchema(data);

  // null target should be allowed (terminal transition)
  const targetErrors = result.errors.filter((e) =>
    e.path.includes("target") && e.path.includes("closure")
  );
  assertEquals(targetErrors.length, 0);
});

// =============================================================================
// validateRegistrySchema - Type mismatches
// =============================================================================

Deno.test("schema-validator/registry - wrong type for agentId", async () => {
  const data = minimalValidRegistry();
  data.agentId = 42;

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.path === "agentId" && e.message.includes("type")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("schema-validator/registry - wrong type for c1", async () => {
  const data = minimalValidRegistry();
  data.c1 = 999;

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.path === "c1" && e.message.includes("type")
  );
  assertEquals(error !== undefined, true);
});

// =============================================================================
// validateRegistrySchema - Step property validation
// =============================================================================

Deno.test("schema-validator/registry - step missing stepId reports error", async () => {
  const data = minimalValidRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  delete steps["initial.default"].stepId;

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.message.includes("Required") && e.path.includes("stepId")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("schema-validator/registry - step missing c2 reports error", async () => {
  const data = minimalValidRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  delete steps["initial.default"].c2;

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.message.includes("Required") && e.path.includes("c2")
  );
  assertEquals(error !== undefined, true);
});

// =============================================================================
// Live agent configs - Integration tests
// =============================================================================

Deno.test("schema-validator/integration - iterator agent.json passes schema", async () => {
  const text = await Deno.readTextFile(".agent/iterator/agent.json");
  const data = JSON.parse(text);

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
});

Deno.test("schema-validator/integration - iterator steps_registry.json passes schema", async () => {
  const text = await Deno.readTextFile(".agent/iterator/steps_registry.json");
  const data = JSON.parse(text);

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
});

Deno.test("schema-validator/integration - reviewer agent.json passes schema", async () => {
  const text = await Deno.readTextFile(".agent/reviewer/agent.json");
  const data = JSON.parse(text);

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
});

Deno.test("schema-validator/integration - reviewer steps_registry.json passes schema", async () => {
  const text = await Deno.readTextFile(".agent/reviewer/steps_registry.json");
  const data = JSON.parse(text);

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
});

Deno.test("schema-validator/integration - facilitator agent.json passes schema", async () => {
  const text = await Deno.readTextFile(".agent/facilitator/agent.json");
  const data = JSON.parse(text);

  const result = await validateAgentSchema(data);

  assertEquals(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
});

Deno.test("schema-validator/integration - facilitator steps_registry.json passes schema", async () => {
  const text = await Deno.readTextFile(
    ".agent/facilitator/steps_registry.json",
  );
  const data = JSON.parse(text);

  const result = await validateRegistrySchema(data);

  assertEquals(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
});
