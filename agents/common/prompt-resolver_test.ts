/**
 * Prompt Resolver Tests
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  parseFrontmatter,
  PromptResolver,
  removeFrontmatter,
} from "./prompt-resolver.ts";
import type {
  BreakdownErrorKind,
  C3LPath,
  PromptLoadResult,
  PromptVariables as LoaderVariables,
} from "./c3l-prompt-loader.ts";
import { addStepDefinition, createEmptyRegistry } from "./step-registry.ts";
import { BreakdownLogger } from "@tettuan/breakdownlogger";

const logger = new BreakdownLogger("prompt-resolver");

// =============================================================================
// Test Agent Setup/Teardown
// =============================================================================

const TEST_AGENT_ID = "test-agent";
const TEST_AGENT_DIR = `.agent/${TEST_AGENT_ID}`;
const TEST_CONFIG_APP = `.agent/climpt/config/${TEST_AGENT_ID}-steps-app.yml`;
const TEST_CONFIG_USER = `.agent/climpt/config/${TEST_AGENT_ID}-steps-user.yml`;
const REGISTRY_CONFIG_PATH = ".agent/climpt/config/registry_config.json";

interface RegistryConfig {
  registries: Record<string, string>;
}

// Use a real temporary directory so c3lLoader.load() returns {ok: false} without
// an OS error (as opposed to "/nonexistent" which triggers a chdir error).
const testTmpDir: string = Deno.makeTempDirSync({
  prefix: "prompt-resolver-test-",
});

let originalRegistryConfig: string | null = null;

async function setupTestAgent(): Promise<void> {
  // Create test-agent directory
  await Deno.mkdir(TEST_AGENT_DIR, { recursive: true });

  // Create test-agent registry.json
  const registry = {
    agentId: TEST_AGENT_ID,
    version: "1.0.0",
    c1: "steps",
    steps: {},
  };
  await Deno.writeTextFile(
    `${TEST_AGENT_DIR}/registry.json`,
    JSON.stringify(registry, null, 2),
  );

  // Create test-agent-steps-app.yml
  const appConfig = `# Test Agent Config (auto-generated for tests)
working_dir: ".agent/${TEST_AGENT_ID}"
app_prompt:
  base_dir: "prompts/steps"
app_schema:
  base_dir: "schema/steps"
`;
  await Deno.writeTextFile(TEST_CONFIG_APP, appConfig);

  // Create test-agent-steps-user.yml
  const userConfig = `# Test Agent User Config (auto-generated for tests)
params:
  two:
    directiveType:
      pattern: "^(initial|continuation|section)$"
    layerType:
      pattern: "^(issue|project|iterate)$"
`;
  await Deno.writeTextFile(TEST_CONFIG_USER, userConfig);

  // Update registry_config.json
  try {
    originalRegistryConfig = await Deno.readTextFile(REGISTRY_CONFIG_PATH);
    const config: RegistryConfig = JSON.parse(originalRegistryConfig);
    if (!config.registries[TEST_AGENT_ID]) {
      config.registries[TEST_AGENT_ID] = `${TEST_AGENT_DIR}/registry.json`;
      await Deno.writeTextFile(
        REGISTRY_CONFIG_PATH,
        JSON.stringify(config, null, 2) + "\n",
      );
    }
  } catch {
    // registry_config.json doesn't exist or can't be read
  }
}

// Setup before all tests
await setupTestAgent();

// Teardown after all tests (using unload event)
globalThis.addEventListener("unload", () => {
  // Note: async operations may not complete in unload
  // Use Deno.removeSync for synchronous cleanup
  try {
    Deno.removeSync(TEST_AGENT_DIR, { recursive: true });
  } catch {
    // Ignore
  }
  try {
    Deno.removeSync(TEST_CONFIG_APP);
  } catch {
    // Ignore
  }
  try {
    Deno.removeSync(TEST_CONFIG_USER);
  } catch {
    // Ignore
  }
  // Clean up temp directory used in place of "/nonexistent"
  try {
    Deno.removeSync(testTmpDir, { recursive: true });
  } catch {
    // Ignore
  }
  // Restore original registry_config.json
  if (originalRegistryConfig !== null) {
    try {
      Deno.writeTextFileSync(REGISTRY_CONFIG_PATH, originalRegistryConfig);
    } catch {
      // Ignore
    }
  }
});

// =============================================================================
// Tests
// =============================================================================

// Test removeFrontmatter
Deno.test("removeFrontmatter - removes YAML frontmatter", () => {
  const content = `---
title: Test
version: 1.0
---
Actual content here`;

  const result = removeFrontmatter(content);

  assertEquals(result, "Actual content here");
});

Deno.test("removeFrontmatter - returns content without frontmatter unchanged", () => {
  const content = "No frontmatter here";

  const result = removeFrontmatter(content);

  assertEquals(result, "No frontmatter here");
});

Deno.test("removeFrontmatter - handles incomplete frontmatter", () => {
  const content = `---
title: Test
no closing delimiter`;

  const result = removeFrontmatter(content);

  assertEquals(result, content);
});

Deno.test("removeFrontmatter - handles empty content after frontmatter", () => {
  const content = `---
title: Test
---
`;

  const result = removeFrontmatter(content);

  assertEquals(result, "");
});

// Test parseFrontmatter
Deno.test("parseFrontmatter - parses simple values", () => {
  const content = `---
title: My Prompt
version: 1
enabled: true
disabled: false
---
Content`;

  const result = parseFrontmatter(content);

  assertEquals(result?.title, "My Prompt");
  assertEquals(result?.version, 1);
  assertEquals(result?.enabled, true);
  assertEquals(result?.disabled, false);
});

Deno.test("parseFrontmatter - returns null for no frontmatter", () => {
  const result = parseFrontmatter("No frontmatter");

  assertEquals(result, null);
});

Deno.test("parseFrontmatter - handles arrays", () => {
  const content = `---
tags: [one, two, three]
---
Content`;

  const result = parseFrontmatter(content);

  assertEquals(result?.tags, ["one", "two", "three"]);
});

Deno.test("parseFrontmatter - handles quoted strings", () => {
  const content = `---
single: 'hello'
double: "world"
---
Content`;

  const result = parseFrontmatter(content);

  assertEquals(result?.single, "hello");
  assertEquals(result?.double, "world");
});

// Test PromptResolver
Deno.test("PromptResolver - throws when C3L prompt file not found", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "initial.test",
    name: "Test Step",
    c2: "initial",
    c3: "test",
    edition: "default",
    uvVariables: [],
    usesStdin: false,
  });

  const resolver = new PromptResolver(registry, {
    workingDir: testTmpDir,
  });

  await assertRejects(
    () => resolver.resolve("initial.test"),
    Error,
    "C3L prompt file not found",
  );
});

Deno.test("PromptResolver - throws C3L not found when file missing (even with required UV vars)", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "required.vars",
    name: "Required Vars",
    c2: "initial",
    c3: "required",
    edition: "default",
    uvVariables: ["required_var"],
    usesStdin: false,
  });

  const resolver = new PromptResolver(registry, {
    workingDir: testTmpDir,
  });

  // Without a C3L file, PR-C3L-004 is thrown before variable validation
  await assertRejects(
    () => resolver.resolve("required.vars"),
    Error,
    "C3L prompt file not found",
  );
});

Deno.test("PromptResolver - throws on unknown step ID", async () => {
  const registry = createEmptyRegistry("test-agent");

  const resolver = new PromptResolver(registry);

  await assertRejects(
    () => resolver.resolve("unknown.step"),
    Error,
    "Unknown step ID",
  );
});

// Note: frontmatter stripping tests are covered by removeFrontmatter unit tests above.
// With fallback removed, these would require C3L prompt files on disk.

Deno.test("PromptResolver - resolve throws when C3L file missing (no fallback)", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "closure.issue",
    name: "Closure Issue",
    c2: "closure",
    c3: "issue",
    edition: "default",
    uvVariables: [],
    usesStdin: false,
  });

  const resolver = new PromptResolver(registry, {
    workingDir: testTmpDir,
  });

  await assertRejects(
    () => resolver.resolve("closure.issue"),
    Error,
    "C3L prompt file not found",
  );
});

Deno.test("PromptResolver - resolve throws when C3L file missing for step with variables", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "initial.test",
    name: "Test",
    c2: "initial",
    c3: "test",
    edition: "default",
    uvVariables: ["name"],
    usesStdin: false,
  });

  const resolver = new PromptResolver(registry, {
    workingDir: testTmpDir,
  });

  await assertRejects(
    () => resolver.resolve("initial.test", { uv: { name: "World" } }),
    Error,
    "C3L prompt file not found",
  );
});

// ============================================================================
// Contract tests: PromptLoadResult.errorKind → ConfigError code mapping
//
// These tests verify the resolver's discrimination contract independently of
// the breakdown library by stubbing C3LPromptLoader.load(). They lock in
// what each BreakdownErrorKind maps to: PR-C3L-004 for not-found-style
// kinds, PR-C3L-002 for everything else.
// ============================================================================

/**
 * Build a PromptResolver whose c3lLoader.load returns `loadResult` verbatim.
 * Mutates the private `c3lLoader` field — acceptable in tests for isolating
 * the resolver's branching logic from breakdown's IO.
 */
function makeResolverWithStubLoader(
  loadResult: PromptLoadResult,
): PromptResolver {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "initial.test",
    name: "Test Step",
    c2: "initial",
    c3: "test",
    edition: "default",
    uvVariables: [],
    usesStdin: false,
  });

  const resolver = new PromptResolver(registry, { workingDir: testTmpDir });
  // Inject stub loader. The resolver only calls .load(), so a partial mock
  // satisfies the runtime contract.
  // deno-lint-ignore no-explicit-any
  (resolver as any).c3lLoader = {
    load: (_path: C3LPath, _vars?: LoaderVariables) =>
      Promise.resolve(loadResult),
  };
  return resolver;
}

Deno.test("PromptResolver - TemplateNotFound from breakdown → PR-C3L-004 with path", async () => {
  const triedPath = "steps/initial/test/f_default.md";
  const resolver = makeResolverWithStubLoader({
    ok: false,
    errorKind: "TemplateNotFound" satisfies BreakdownErrorKind,
    error:
      `TemplateNotFound: Template not found: ${triedPath} (working_dir: ${testTmpDir})`,
    promptPath: triedPath,
  });

  const err = await assertRejects(
    () => resolver.resolve("initial.test"),
    Error,
  );
  // PR-C3L-004 contract: code in message, stepId in message, tried path in message
  assertStringIncludes((err as Error).message, "PR-C3L-004");
  assertStringIncludes((err as Error).message, "initial.test");
  assertStringIncludes((err as Error).message, triedPath);
});

Deno.test("PromptResolver - ParameterParsingError from breakdown → PR-C3L-004", async () => {
  // ParameterParsingError = breakdown does not recognize the c2/c3 directive.
  // Treated identically to file-not-found by the resolver contract.
  const resolver = makeResolverWithStubLoader({
    ok: false,
    errorKind: "ParameterParsingError" satisfies BreakdownErrorKind,
    error: "ParameterParsingError: unknown directive type",
  });

  const err = await assertRejects(
    () => resolver.resolve("initial.test"),
    Error,
  );
  assertStringIncludes((err as Error).message, "PR-C3L-004");
});

Deno.test("PromptResolver - InvalidVariables from breakdown → PR-C3L-002 (not collapsed)", async () => {
  const resolver = makeResolverWithStubLoader({
    ok: false,
    errorKind: "InvalidVariables" satisfies BreakdownErrorKind,
    error: "InvalidVariables: Invalid variables: missing uv-name",
  });

  const err = await assertRejects(
    () => resolver.resolve("initial.test"),
    Error,
  );
  // PR-C3L-002 contract: do NOT collapse user-correctable errors to file-not-found
  assertStringIncludes((err as Error).message, "PR-C3L-002");
  assertStringIncludes((err as Error).message, "InvalidVariables");
});

Deno.test("PromptResolver - ConfigLoadError from breakdown → PR-C3L-002", async () => {
  const resolver = makeResolverWithStubLoader({
    ok: false,
    errorKind: "ConfigLoadError" satisfies BreakdownErrorKind,
    error: "ConfigLoadError: missing app.yml",
  });

  const err = await assertRejects(
    () => resolver.resolve("initial.test"),
    Error,
  );
  assertStringIncludes((err as Error).message, "PR-C3L-002");
});
