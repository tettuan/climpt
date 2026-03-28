/**
 * Tests for Issue 07 (tettuan/climpt#434)
 *
 * UV Variable Catch-22: previous_summary in continuation steps
 *
 * Original contradiction (now resolved by T3 fix):
 * - If previous_summary IS declared in uvVariables:
 *     Template validation passes, reachability silently skips (not a CLI param),
 *     but runtime throws PR-RESOLVE-003 because no channel supplies the value.
 * - If previous_summary is NOT declared in uvVariables:
 *     Template validation fails ("template uses {uv-previous_summary} but not declared").
 *
 * Resolution (T3 fix):
 * template-uv-validator.ts now has RUNTIME_SUPPLIED_UV_VARS — runtime-supplied
 * variables (iteration, completed_iterations, completion_keyword, max_iterations,
 * remaining, previous_summary, check_count, max_checks) are skipped during
 * template validation. Both configurations now pass all static validators.
 *
 * Tests 07-a and 07-b verify pre-existing behavior that remains unchanged.
 * Tests 07-c and 07-d verify the fix — updated to assert PASS instead of FAIL.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { validateTemplateUvConsistency } from "./template-uv-validator.ts";
import { validateUvReachability } from "./uv-reachability-validator.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Build a minimal registry with c1 and a single step entry. */
function registryWith(
  stepId: string,
  stepDef: Record<string, unknown>,
): Record<string, unknown> {
  return {
    c1: "steps",
    steps: { [stepId]: stepDef },
  };
}

/** Build a minimal agent definition with parameters. */
function agentWith(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return { parameters };
}

/**
 * Create a prompt file in the C3L layout inside a temp agent directory.
 */
async function createPromptFile(
  agentDir: string,
  c1: string,
  c2: string,
  c3: string,
  edition: string,
  content: string,
  adaptation?: string,
): Promise<void> {
  const dir = join(agentDir, "prompts", c1, c2, c3);
  await Deno.mkdir(dir, { recursive: true });
  const filename = adaptation
    ? `f_${edition}_${adaptation}.md`
    : `f_${edition}.md`;
  await Deno.writeTextFile(join(dir, filename), content);
}

// =============================================================================
// Test 1: Issue 07-a
// previous_summary declared -> template validation passes
// =============================================================================

Deno.test("Issue 07-a — previous_summary declared: template validation passes", async () => {
  // When previous_summary IS declared in uvVariables and the template
  // uses {uv-previous_summary}, the template UV validator is satisfied.
  // This is one half of the catch-22: declaration makes template validation pass.
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "continuation",
      "manual",
      "default",
      "# Continuation\n\nPrevious: {uv-previous_summary}\n\nTopic: {uv-topic}",
    );

    const registry = registryWith("continuation.manual", {
      c2: "continuation",
      c3: "manual",
      edition: "default",
      uvVariables: ["previous_summary", "topic"],
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(
      result.valid,
      true,
      "Template validation should pass when all UV vars are declared",
    );
    assertEquals(
      result.errors.length,
      0,
      "No errors expected when UV vars match declarations",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Test 2: Issue 07-b
// previous_summary declared -> reachability validation silently skips it
// =============================================================================

Deno.test("Issue 07-b — previous_summary declared: reachability validation silently skips it", () => {
  // When previous_summary is declared in uvVariables but is NOT a CLI
  // parameter (not in agent.json parameters), the reachability validator
  // silently skips it — it assumes the variable is "runtime-supplied."
  //
  // This is the blind spot: reachability does not error, but it also
  // does not verify that any runtime channel actually supplies the value.
  // At runtime, prompt-resolver.ts will throw PR-RESOLVE-003 if the
  // runner fails to inject previous_summary into the UV dict.
  const registry = registryWith("continuation.manual", {
    uvVariables: ["previous_summary", "topic"],
  });
  const agent = agentWith({
    topic: { required: true },
    // previous_summary intentionally absent — it is runner-guaranteed,
    // not a CLI parameter. The reachability validator skips non-CLI vars.
  });

  const result = validateUvReachability(registry, agent);

  // Reachability passes: previous_summary is not in agent.json parameters,
  // so the validator silently skips it (assumes runtime-supplied).
  assertEquals(
    result.valid,
    true,
    "Reachability should pass (non-CLI vars are silently skipped)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors: previous_summary is not flagged",
  );

  // The critical gap: no warning is emitted for previous_summary either.
  // The validator has no way to know whether the runtime will actually
  // supply this variable. If the runner does not inject it, PR-RESOLVE-003
  // will be thrown at runtime — but no static validator catches this.
  const previousSummaryWarning = result.warnings.find((w) =>
    w.includes("previous_summary")
  );
  assertEquals(
    previousSummaryWarning,
    undefined,
    "No warning about previous_summary — the validator is blind to runtime supply gaps",
  );
});

// =============================================================================
// Test 3: Issue 07-c
// previous_summary NOT declared -> template validation PASSES (fix applied)
// =============================================================================

Deno.test("Issue 07-c — previous_summary NOT declared: template validation passes (runtime-supplied)", async () => {
  // After T3 fix: previous_summary is in RUNTIME_SUPPLIED_UV_VARS, so the
  // template UV validator skips it even when it is not declared in uvVariables.
  // This proves the fix: runtime-supplied variables no longer need to be
  // declared in uvVariables for templates to pass validation.
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "continuation",
      "manual",
      "default",
      "# Continuation\n\nPrevious: {uv-previous_summary}\n\nTopic: {uv-topic}",
    );

    const registry = registryWith("continuation.manual", {
      c2: "continuation",
      c3: "manual",
      edition: "default",
      uvVariables: ["topic"], // previous_summary intentionally omitted
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(
      result.valid,
      true,
      "Template validation should pass: previous_summary is runtime-supplied and does not need declaration",
    );
    assertEquals(
      result.errors.length,
      0,
      "No errors expected: runtime-supplied variables are skipped by the validator",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Test 4: Issue 07-d
// Catch-22 RESOLVED: both configurations now pass both validators
// =============================================================================

Deno.test("Issue 07-d — catch-22 resolved: both configurations pass both validators", async () => {
  // After T3 fix: previous_summary is in RUNTIME_SUPPLIED_UV_VARS, so the
  // template UV validator skips it regardless of whether it is declared in
  // uvVariables. This eliminates the catch-22 — both configurations now
  // produce clean results across the full static validation pipeline.
  //
  // Configuration A: previous_summary declared in uvVariables
  //   - Template validator: PASS (declared, so no issue)
  //   - Reachability validator: PASS (silently skips non-CLI params)
  //
  // Configuration B: previous_summary NOT declared in uvVariables
  //   - Template validator: PASS (runtime-supplied, so skipped by validator)
  //   - Reachability validator: PASS (nothing to check)

  const dir = await Deno.makeTempDir();
  try {
    const templateContent =
      "# Continuation\n\nPrevious: {uv-previous_summary}\n\nTopic: {uv-topic}";

    await createPromptFile(
      dir,
      "steps",
      "continuation",
      "manual",
      "default",
      templateContent,
    );

    const agent = agentWith({
      topic: { required: true },
      // previous_summary is NOT a CLI parameter — it's runner-guaranteed
    });

    // --- Configuration A: previous_summary declared ---
    const registryA = registryWith("continuation.manual", {
      c2: "continuation",
      c3: "manual",
      edition: "default",
      uvVariables: ["previous_summary", "topic"],
      fallbackKey: "",
    });

    const templateResultA = await validateTemplateUvConsistency(
      registryA,
      dir,
      dir,
    );
    const reachResultA = validateUvReachability(registryA, agent);

    // Template passes: all used UV vars are declared
    assertEquals(
      templateResultA.valid,
      true,
      "Config A: template validation passes",
    );
    assertEquals(
      templateResultA.errors.length,
      0,
      "Config A: no template errors",
    );

    // Reachability passes: previous_summary is not in agent.json params, silently skipped
    assertEquals(
      reachResultA.valid,
      true,
      "Config A: reachability passes (non-CLI vars silently skipped)",
    );
    assertEquals(
      reachResultA.errors.length,
      0,
      "Config A: no reachability errors",
    );

    // --- Configuration B: previous_summary NOT declared ---
    const registryB = registryWith("continuation.manual", {
      c2: "continuation",
      c3: "manual",
      edition: "default",
      uvVariables: ["topic"], // previous_summary omitted
      fallbackKey: "",
    });

    const templateResultB = await validateTemplateUvConsistency(
      registryB,
      dir,
      dir,
    );
    const reachResultB = validateUvReachability(registryB, agent);

    // Template passes: previous_summary is runtime-supplied, so the validator
    // skips it even though it is not declared in uvVariables.
    assertEquals(
      templateResultB.valid,
      true,
      "Config B: template validation passes (runtime-supplied vars are skipped)",
    );
    assertEquals(
      templateResultB.errors.length,
      0,
      "Config B: no template errors",
    );

    // Reachability passes trivially: previous_summary is not in uvVariables
    assertEquals(
      reachResultB.valid,
      true,
      "Config B: reachability passes (nothing to check)",
    );
    assertEquals(
      reachResultB.errors.length,
      0,
      "Config B: no reachability errors",
    );

    // --- Catch-22 resolution proof ---
    // Both configurations now pass both validators. The RUNTIME_SUPPLIED_UV_VARS
    // set in template-uv-validator.ts ensures that variables injected by the
    // runner or verdict handler at execution time are not flagged as undeclared.
    // This eliminates the catch-22 documented in Issue 07.
    const configABothPass = templateResultA.valid && reachResultA.valid;
    const configBBothPass = templateResultB.valid && reachResultB.valid;

    assertEquals(
      configABothPass,
      true,
      "Config A passes both static validators",
    );
    assertEquals(
      configBBothPass,
      true,
      "Config B now also passes both static validators (catch-22 resolved)",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
