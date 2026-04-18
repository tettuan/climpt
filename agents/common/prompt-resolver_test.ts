/**
 * Prompt Resolver Tests
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  FILE_NOT_FOUND_KINDS,
  parseFrontmatter,
  PromptResolver,
  removeFrontmatter,
} from "./prompt-resolver.ts";
import {
  ALL_BREAKDOWN_ERROR_KINDS,
  type BreakdownErrorKind,
  type C3LPath,
  type PromptLoadResult,
  type PromptVariables as LoaderVariables,
} from "./c3l-prompt-loader.ts";
import { addStepDefinition, createEmptyRegistry } from "./step-registry.ts";
import {
  BREAKDOWN_DETAIL_PREFIX,
  prC3lPromptNotFound,
} from "../shared/errors/config-errors.ts";
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

// ----------------------------------------------------------------------------
// Diagnosability helper — emits What/Where/Fix on failure.
//
// Every PR-C3L-004 / PR-C3L-002 message must contain the error code, the
// step id, and breakdown's detail string. Centralising the assertion here
// avoids partial checks drifting apart across tests (assertion-bloat /
// shadow-contract anti-patterns) and gives a uniform failure template.
// ----------------------------------------------------------------------------
function assertPRErrorShape(
  err: Error,
  expected: {
    code: "PR-C3L-004" | "PR-C3L-002";
    stepId: string;
    detail: string;
    mustContainBreakdownPrefix: boolean;
  },
): void {
  const msg = err.message;
  const checks: { what: string; ok: boolean }[] = [
    { what: `code "${expected.code}"`, ok: msg.includes(expected.code) },
    { what: `stepId "${expected.stepId}"`, ok: msg.includes(expected.stepId) },
    { what: `detail "${expected.detail}"`, ok: msg.includes(expected.detail) },
  ];
  if (expected.mustContainBreakdownPrefix) {
    checks.push({
      what: `BREAKDOWN_DETAIL_PREFIX "${BREAKDOWN_DETAIL_PREFIX}"`,
      ok: msg.includes(BREAKDOWN_DETAIL_PREFIX),
    });
  }
  const missing = checks.filter((c) => !c.ok).map((c) => c.what);
  if (missing.length > 0) {
    throw new Error(
      [
        `Thrown ConfigError message missing required parts.`,
        `  Missing:        ${missing.join(", ")}`,
        `  Actual message: ${JSON.stringify(msg)}`,
        `  Expected code:  ${expected.code}`,
        `  Source (dispatch): agents/common/prompt-resolver.ts tryBreakdown`,
        `  Source (factory): agents/shared/errors/config-errors.ts (prC3lPromptNotFound / prC3lBreakdownFailed)`,
        `  Fix: ensure the factory for ${expected.code} embeds all of {code, stepId, detail${
          expected.mustContainBreakdownPrefix ? ", BREAKDOWN_DETAIL_PREFIX" : ""
        }} in .message.`,
      ].join("\n"),
    );
  }
}

function isFileNotFoundKind(kind: BreakdownErrorKind): boolean {
  return (FILE_NOT_FOUND_KINDS as readonly BreakdownErrorKind[]).includes(kind);
}

// ----------------------------------------------------------------------------
// C1: Factory contract — prC3lPromptNotFound propagates breakdownDetail
// ----------------------------------------------------------------------------
Deno.test("prC3lPromptNotFound - breakdownDetail appears verbatim after BREAKDOWN_DETAIL_PREFIX", () => {
  const stepId = "initial.test";
  const triedPath = "steps/initial/test/f_default.md";
  const detail = "Template not found: X. Attempted paths: /a, /b, /c";

  const errWith = prC3lPromptNotFound(stepId, triedPath, detail);
  const errWithout = prC3lPromptNotFound(stepId, triedPath);

  const expectedSubstring = BREAKDOWN_DETAIL_PREFIX + detail;
  if (!errWith.message.includes(expectedSubstring)) {
    throw new Error(
      [
        `prC3lPromptNotFound dropped or reformatted breakdownDetail.`,
        `  Expected substring: ${JSON.stringify(expectedSubstring)}`,
        `  Actual message:     ${JSON.stringify(errWith.message)}`,
        `  Source: agents/shared/errors/config-errors.ts prC3lPromptNotFound`,
        `  Fix:    append "\\n" + BREAKDOWN_DETAIL_PREFIX + detail when breakdownDetail is truthy.`,
      ].join("\n"),
    );
  }

  if (errWithout.message.includes(BREAKDOWN_DETAIL_PREFIX)) {
    throw new Error(
      [
        `prC3lPromptNotFound emitted BREAKDOWN_DETAIL_PREFIX with no detail argument.`,
        `  Actual message: ${JSON.stringify(errWithout.message)}`,
        `  Source: agents/shared/errors/config-errors.ts prC3lPromptNotFound`,
        `  Fix:    only append the prefix when breakdownDetail is truthy.`,
      ].join("\n"),
    );
  }
});

// ----------------------------------------------------------------------------
// I1: Exhaustive dispatch invariant.
//
// Source of truth: ALL_BREAKDOWN_ERROR_KINDS (c3l-prompt-loader.ts) and
// FILE_NOT_FOUND_KINDS (prompt-resolver.ts). The test iterates every member of
// the runtime-enumerable union and verifies the dispatch mapping plus detail
// preservation — no manual subset enumeration, no hardcoded kind strings.
// ----------------------------------------------------------------------------
Deno.test("PromptResolver - exhaustive dispatch: every BreakdownErrorKind maps to the expected ConfigError code with detail preserved", async () => {
  // Non-vacuity: the source-of-truth array must be populated. A silent pass on
  // an empty array would let the whole invariant rot.
  assert(
    ALL_BREAKDOWN_ERROR_KINDS.length > 0,
    "ALL_BREAKDOWN_ERROR_KINDS is empty — source of truth is not enumerable; fix agents/common/c3l-prompt-loader.ts",
  );
  // Membership guard: FILE_NOT_FOUND_KINDS must be a non-empty subset of the
  // union, otherwise the dispatch has no PR-C3L-004 branch and the test
  // degenerates into "everything is PR-C3L-002".
  assert(
    FILE_NOT_FOUND_KINDS.length > 0,
    "FILE_NOT_FOUND_KINDS is empty — at least TemplateNotFound must be present; fix agents/common/prompt-resolver.ts",
  );
  for (const k of FILE_NOT_FOUND_KINDS) {
    assert(
      (ALL_BREAKDOWN_ERROR_KINDS as readonly string[]).includes(k),
      `FILE_NOT_FOUND_KINDS contains "${k}" which is not in ALL_BREAKDOWN_ERROR_KINDS. ` +
        `Sources of truth have drifted: align c3l-prompt-loader.ts and prompt-resolver.ts.`,
    );
  }

  for (const kind of ALL_BREAKDOWN_ERROR_KINDS) {
    const detail = `stub-detail-for-${kind}`;
    const resolver = makeResolverWithStubLoader({
      ok: false,
      errorKind: kind,
      error: detail,
    });

    const err = await assertRejects(
      () => resolver.resolve("initial.test"),
      Error,
      undefined,
      `Resolver did not throw for BreakdownErrorKind "${kind}". ` +
        `Stub returned {ok:false}; every errorKind must produce a ConfigError.`,
    );

    const fileNotFound = isFileNotFoundKind(kind);
    assertPRErrorShape(err as Error, {
      code: fileNotFound ? "PR-C3L-004" : "PR-C3L-002",
      stepId: "initial.test",
      detail,
      mustContainBreakdownPrefix: fileNotFound,
    });
  }
});
