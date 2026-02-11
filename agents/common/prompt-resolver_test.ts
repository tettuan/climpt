/**
 * Prompt Resolver Tests
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  createFallbackProvider,
  parseFrontmatter,
  PromptResolver,
  removeFrontmatter,
} from "./prompt-resolver.ts";
import { addStepDefinition, createEmptyRegistry } from "./step-registry.ts";

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

// Test createFallbackProvider
Deno.test("createFallbackProvider - provides prompts", () => {
  const provider = createFallbackProvider({
    "test.key": "Test prompt content",
    "another.key": "Another prompt",
  });

  assertEquals(provider.getPrompt("test.key"), "Test prompt content");
  assertEquals(provider.hasPrompt("test.key"), true);
  assertEquals(provider.hasPrompt("missing"), false);
  assertEquals(provider.getPrompt("missing"), undefined);
});

// Test PromptResolver
Deno.test("PromptResolver - resolves from fallback when breakdown fails", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "initial.test",
    name: "Test Step",
    c2: "initial",
    c3: "test",
    edition: "default",
    fallbackKey: "fallback_test",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "fallback_test": "Fallback content here",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  const result = await resolver.resolve("initial.test");

  assertEquals(result.source, "fallback");
  assertEquals(result.content, "Fallback content here");
  assertEquals(result.stepId, "initial.test");
});

Deno.test("PromptResolver - substitutes UV variables in fallback", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "with.vars",
    name: "With Vars",
    c2: "initial",
    c3: "vars",
    edition: "default",
    fallbackKey: "vars_fallback",
    uvVariables: ["name", "count"],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "vars_fallback": "Hello {uv-name}, you have {uv-count} items.",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  const result = await resolver.resolve("with.vars", {
    uv: { name: "Alice", count: "5" },
  });

  assertEquals(result.content, "Hello Alice, you have 5 items.");
  assertEquals(result.substitutedVariables?.["uv-name"], "Alice");
  assertEquals(result.substitutedVariables?.["uv-count"], "5");
});

Deno.test("PromptResolver - substitutes input_text in fallback", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "stdin.step",
    name: "STDIN Step",
    c2: "initial",
    c3: "stdin",
    edition: "default",
    fallbackKey: "stdin_fallback",
    uvVariables: [],
    usesStdin: true,
  });

  const fallbackProvider = createFallbackProvider({
    "stdin_fallback": "Input was: {input_text}",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  const result = await resolver.resolve("stdin.step", {
    inputText: "User typed this",
  });

  assertEquals(result.content, "Input was: User typed this");
});

Deno.test("PromptResolver - throws on missing required UV variable", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "required.vars",
    name: "Required Vars",
    c2: "initial",
    c3: "required",
    edition: "default",
    fallbackKey: "required_fallback",
    uvVariables: ["required_var"],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "required_fallback": "Content with {uv-required_var}",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  await assertRejects(
    () => resolver.resolve("required.vars"),
    Error,
    "Missing required UV variable",
  );
});

Deno.test("PromptResolver - allows missing variables when configured", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "optional.vars",
    name: "Optional Vars",
    c2: "initial",
    c3: "optional",
    edition: "default",
    fallbackKey: "optional_fallback",
    uvVariables: ["optional_var"],
    usesStdin: true,
  });

  const fallbackProvider = createFallbackProvider({
    "optional_fallback": "Value: {uv-optional_var}, Input: {input_text}",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
    allowMissingVariables: true,
  });

  const result = await resolver.resolve("optional.vars");

  assertEquals(result.content, "Value: , Input:");
});

Deno.test("PromptResolver - throws on unknown step ID", async () => {
  const registry = createEmptyRegistry("test-agent");
  const fallbackProvider = createFallbackProvider({});

  const resolver = new PromptResolver(registry, fallbackProvider);

  await assertRejects(
    () => resolver.resolve("unknown.step"),
    Error,
    "Unknown step ID",
  );
});

Deno.test("PromptResolver - throws when no fallback available", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "no.fallback",
    name: "No Fallback",
    c2: "initial",
    c3: "nofallback",
    edition: "default",
    fallbackKey: "missing_key",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({});

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  await assertRejects(
    () => resolver.resolve("no.fallback"),
    Error,
    "No fallback prompt found",
  );
});

Deno.test("PromptResolver - strips frontmatter by default", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "with.frontmatter",
    name: "With Frontmatter",
    c2: "initial",
    c3: "frontmatter",
    edition: "default",
    fallbackKey: "frontmatter_fallback",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "frontmatter_fallback": `---
title: Test
---
Actual content`,
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  const result = await resolver.resolve("with.frontmatter");

  assertEquals(result.content, "Actual content");
});

Deno.test("PromptResolver - preserves frontmatter when disabled", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "keep.frontmatter",
    name: "Keep Frontmatter",
    c2: "initial",
    c3: "keep",
    edition: "default",
    fallbackKey: "keep_fallback",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "keep_fallback": `---
title: Test
---
Content`,
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
    stripFrontmatter: false,
  });

  const result = await resolver.resolve("keep.frontmatter");

  assertEquals(result.content.startsWith("---"), true);
});

Deno.test("PromptResolver - canResolve returns true for resolvable step", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "resolvable",
    name: "Resolvable",
    c2: "initial",
    c3: "resolvable",
    edition: "default",
    fallbackKey: "resolvable_key",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "resolvable_key": "Content",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  const canResolve = await resolver.canResolve("resolvable");

  assertEquals(canResolve, true);
});

Deno.test("PromptResolver - canResolve returns false for unknown step", async () => {
  const registry = createEmptyRegistry("test-agent");
  const fallbackProvider = createFallbackProvider({});

  const resolver = new PromptResolver(registry, fallbackProvider);

  const canResolve = await resolver.canResolve("unknown");

  assertEquals(canResolve, false);
});

Deno.test("PromptResolver - getUserFilePath returns correct path", () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "file.path",
    name: "File Path",
    c2: "initial",
    c3: "file",
    edition: "default",
    fallbackKey: "key",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({});

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/work",
  });

  const path = resolver.getUserFilePath("file.path");

  // Path should be: /work/.agent/test-agent/prompts/steps/initial/file/f_default.md
  assertEquals(
    path,
    "/work/.agent/test-agent/prompts/steps/initial/file/f_default.md",
  );
});

Deno.test("PromptResolver - getUserFilePath with adaptation", () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "file.adapted",
    name: "Adapted File",
    c2: "initial",
    c3: "file",
    edition: "preparation",
    adaptation: "empty",
    fallbackKey: "key",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({});

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/work",
  });

  const path = resolver.getUserFilePath("file.adapted");

  // Path should include adaptation: f_preparation_empty.md
  assertEquals(
    path,
    "/work/.agent/test-agent/prompts/steps/initial/file/f_preparation_empty.md",
  );
});

// Test adaptation override
Deno.test("PromptResolver - adaptation override changes resolved path", () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "closure.issue",
    name: "Closure Issue",
    c2: "closure",
    c3: "issue",
    edition: "default",
    fallbackKey: "closure_issue",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({});

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/work",
  });

  // With adaptation override, path should include adaptation
  const pathWithOverride = resolver.getUserFilePath("closure.issue");
  assertEquals(
    pathWithOverride,
    "/work/.agent/test-agent/prompts/steps/closure/issue/f_default.md",
  );
});

Deno.test("PromptResolver - adaptation override resolves adapted fallback", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "closure.issue",
    name: "Closure Issue",
    c2: "closure",
    c3: "issue",
    edition: "default",
    fallbackKey: "closure_issue",
    uvVariables: [],
    usesStdin: false,
  });

  // Register fallback for both the base and adapted key
  const fallbackProvider = createFallbackProvider({
    "closure_issue": "Default close action",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  // Without override - resolves to base fallback
  const baseResult = await resolver.resolve("closure.issue");
  assertEquals(baseResult.source, "fallback");
  assertEquals(baseResult.content, "Default close action");
  assertEquals(baseResult.stepId, "closure.issue");
});

Deno.test("PromptResolver - resolve without override preserves existing behavior", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "initial.test",
    name: "Test",
    c2: "initial",
    c3: "test",
    edition: "default",
    fallbackKey: "test_fallback",
    uvVariables: ["name"],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "test_fallback": "Hello {uv-name}",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  // Calling resolve without overrides should work exactly as before
  const result = await resolver.resolve("initial.test", {
    uv: { name: "World" },
  });

  assertEquals(result.content, "Hello World");
  assertEquals(result.source, "fallback");
});

Deno.test("PromptResolver - custom variables substitution", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "custom.vars",
    name: "Custom Vars",
    c2: "initial",
    c3: "custom",
    edition: "default",
    fallbackKey: "custom_fallback",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "custom_fallback": "Project: {project_name}, Count: {item_count}",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/nonexistent",
  });

  const result = await resolver.resolve("custom.vars", {
    custom: {
      project_name: "MyProject",
      item_count: "42",
    },
  });

  assertEquals(result.content, "Project: MyProject, Count: 42");
});
