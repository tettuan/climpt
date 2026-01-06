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
Deno.test("PromptResolver - resolves from fallback when no user file", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "initial.test",
    name: "Test Step",
    promptPath: "initial/test.md",
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

Deno.test("PromptResolver - substitutes UV variables", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "with.vars",
    name: "With Vars",
    promptPath: "vars.md",
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

Deno.test("PromptResolver - substitutes input_text", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "stdin.step",
    name: "STDIN Step",
    promptPath: "stdin.md",
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
    promptPath: "required.md",
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
    promptPath: "optional.md",
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
    promptPath: "nofallback.md",
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
    promptPath: "frontmatter.md",
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
    promptPath: "keep.md",
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
    promptPath: "resolvable.md",
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
    promptPath: "subdir/file.md",
    fallbackKey: "key",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({});

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: "/work",
  });

  const path = resolver.getUserFilePath("file.path");

  assertEquals(path, "/work/.agent/test-agent/prompts/subdir/file.md");
});

Deno.test("PromptResolver - custom variables substitution", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "custom.vars",
    name: "Custom Vars",
    promptPath: "custom.md",
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

Deno.test("PromptResolver - resolves from user file when exists", async () => {
  const tempDir = await Deno.makeTempDir();
  const promptsDir = `${tempDir}/.agent/test-agent/prompts/initial`;
  await Deno.mkdir(promptsDir, { recursive: true });
  await Deno.writeTextFile(`${promptsDir}/user.md`, "User provided content");

  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, {
    stepId: "initial.user",
    name: "User Step",
    promptPath: "initial/user.md",
    fallbackKey: "user_fallback",
    uvVariables: [],
    usesStdin: false,
  });

  const fallbackProvider = createFallbackProvider({
    "user_fallback": "Fallback content",
  });

  const resolver = new PromptResolver(registry, fallbackProvider, {
    workingDir: tempDir,
  });

  try {
    const result = await resolver.resolve("initial.user");

    assertEquals(result.source, "user");
    assertEquals(result.content, "User provided content");
    assertEquals(result.promptPath?.includes("initial/user.md"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
