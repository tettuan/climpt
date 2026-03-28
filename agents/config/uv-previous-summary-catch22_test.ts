/**
 * Tests for Issue 07 (tettuan/climpt#434)
 *
 * UV Variable Catch-22: previous_summary in continuation steps
 *
 * The contradiction:
 * - If previous_summary IS declared in uvVariables:
 *     Template validation passes, reachability silently skips (not a CLI param),
 *     but runtime throws PR-RESOLVE-003 because no channel supplies the value.
 * - If previous_summary is NOT declared in uvVariables:
 *     Template validation fails ("template uses {uv-previous_summary} but not declared").
 *
 * Neither configuration produces a fully working continuation step for
 * iteration 2+, where {uv-previous_summary} must be substituted.
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
// previous_summary NOT declared -> template validation fails
// =============================================================================

Deno.test("Issue 07-c — previous_summary NOT declared: template validation fails", async () => {
  // When previous_summary is removed from uvVariables but the template
  // still uses {uv-previous_summary}, the template UV validator rejects it.
  // This is the other side of the catch-22.
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
      false,
      "Template validation should fail when UV var is undeclared",
    );
    assertEquals(
      result.errors.length >= 1,
      true,
      "At least one error expected for undeclared UV usage",
    );

    const undeclaredError = result.errors.find((e) =>
      e.includes("uv-previous_summary") && e.includes("not declared")
    );
    assertEquals(
      undeclaredError !== undefined,
      true,
      `Expected undeclared UV error for previous_summary, got: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Test 4: Issue 07-d
// Catch-22 summary: no configuration satisfies both validators when
// previous_summary has no CLI parameter source
// =============================================================================

Deno.test("Issue 07-d — catch-22 summary: no configuration satisfies both validators simultaneously", async () => {
  // This test proves the definitive catch-22 by running both validators
  // under both configurations and showing that neither produces a clean
  // result across the full validation pipeline.
  //
  // Configuration A: previous_summary declared in uvVariables
  //   - Template validator: PASS
  //   - Reachability validator: PASS (silently skips — blind spot)
  //   - Runtime: FAIL (PR-RESOLVE-003 if runner doesn't inject it)
  //
  // Configuration B: previous_summary NOT declared in uvVariables
  //   - Template validator: FAIL (undeclared UV usage)
  //   - Reachability validator: PASS (nothing to check)
  //   - Runtime: FAIL (unreplaced {uv-previous_summary} placeholder)

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
      "Config A: reachability passes (silent skip)",
    );
    assertEquals(
      reachResultA.errors.length,
      0,
      "Config A: no reachability errors",
    );

    // Both validators pass — but the gap is that neither checks runtime supply.
    // At runtime, prompt-resolver.ts checks variables.uv["previous_summary"]
    // and throws PR-RESOLVE-003 if it's missing. The static validators
    // cannot detect this runtime failure.

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

    // Template fails: template uses {uv-previous_summary} but it's not declared
    assertEquals(
      templateResultB.valid,
      false,
      "Config B: template validation fails",
    );
    assertEquals(
      templateResultB.errors.some((e) =>
        e.includes("uv-previous_summary") && e.includes("not declared")
      ),
      true,
      `Config B: expected undeclared UV error, got: ${
        JSON.stringify(templateResultB.errors)
      }`,
    );

    // Reachability passes trivially: previous_summary is not even in uvVariables
    assertEquals(
      reachResultB.valid,
      true,
      "Config B: reachability passes (nothing to check)",
    );

    // --- Catch-22 proof ---
    // Config A: both validators pass, but runtime fails (PR-RESOLVE-003)
    // Config B: template validator fails before runtime is even reached
    //
    // The contradiction: the static validation layer has a blind spot for
    // UV variables that are neither CLI parameters nor template-undeclared.
    // A variable like previous_summary (runner-guaranteed, not from CLI)
    // passes all static checks when declared, but the validators cannot
    // verify that the runtime will actually supply it. This is the catch-22
    // documented in Issue 07.
    const configABothPass = templateResultA.valid && reachResultA.valid;
    const configBBothPass = templateResultB.valid && reachResultB.valid;

    assertEquals(
      configABothPass,
      true,
      "Config A passes both static validators",
    );
    assertEquals(
      configBBothPass,
      false,
      "Config B fails at least one static validator",
    );

    // Config A passes static validation but has a runtime gap.
    // Config B fails static validation outright.
    // Neither configuration provides end-to-end correctness assurance.
    // The validators lack a "runtime supply verification" layer for
    // non-CLI UV variables, which is the root cause of Issue 07.
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
