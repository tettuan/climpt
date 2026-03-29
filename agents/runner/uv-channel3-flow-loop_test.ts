/**
 * UV Variable Channel 3 Contradiction Tests
 *
 * Verifies the asymmetry between Flow Loop and Completion Loop
 * regarding Channel 3 UV variables (verdict-handler-owned variables).
 *
 * Issues:
 *   01 - {uv-max_iterations} unresolved in initial_iterate template
 *   02 - {uv-previous_summary} unresolved on iteration 1
 *   03 - Flow Loop never calls setUvVariables(), Completion Loop does
 *
 * These tests do NOT import production modules (except assert).
 * They replicate the relevant logic locally to serve as a
 * self-contained contradiction proof.
 *
 * Two substitute functions exist in production:
 *   - fallback.ts: /\{([^}]+)\}/g with variables[key] ?? variables[`uv-${key}`]
 *   - prompt-resolver.ts: /\{uv-(\w+)\}/g with variables.uv?.[name]
 *
 * Both produce the same result for the contradiction being tested:
 * Channel 3 variables are absent from buildUvVariables() output,
 * so {uv-max_iterations}, {uv-previous_summary} etc. remain unresolved
 * regardless of which substitute path executes.
 *
 * The tests below replicate the fallback.ts substitute() as specified,
 * using uv-prefixed keys in the variables map to match its lookup
 * convention (variables["uv-max_iterations"] for {uv-max_iterations}).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

// ---------------------------------------------------------------------------
// Local replica of the production substitute() from fallback.ts (private)
//
// Template placeholders are {uv-xxx}. The regex captures the full key
// "uv-xxx" and looks it up in the variables map directly, then tries
// with an additional "uv-" prefix as fallback.
// ---------------------------------------------------------------------------

function substitute(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const value = variables[key] ?? variables[`uv-${key}`];
    return value ?? match;
  });
}

// ---------------------------------------------------------------------------
// Templates copied verbatim from DefaultFallbackProvider in fallback.ts
// ---------------------------------------------------------------------------

const TEMPLATE_INITIAL_ITERATE = `# Task Start

This task will run for up to **{uv-max_iterations}** iterations.

Begin iteration 1. Make progress and report what you accomplished.
`;

const TEMPLATE_CONTINUATION_STRUCTURED_SIGNAL =
  `# Continuation (Iteration {uv-iteration})

{uv-previous_summary}

Continue working on the task.

When complete, output the structured signal of type: {uv-signal_type}
`;

// ---------------------------------------------------------------------------
// Channel variable builders
//
// buildUvVariables() in runner.ts returns bare keys (e.g. "iteration").
// For the fallback substitute() to resolve {uv-iteration}, the variable
// map needs the key "uv-iteration". The production code reaches
// fallback.substitute() via DefaultFallbackProvider.get() which receives
// the variables map as-is.
//
// In the PromptResolver path (C3L), variables are wrapped in { uv: map }
// and the regex /\{uv-(\w+)\}/g strips the prefix, so bare keys work.
//
// For these tests we model the fallback substitute() path, so we
// prefix all keys with "uv-" to match the lookup convention.
// ---------------------------------------------------------------------------

/**
 * Simulate buildUvVariables() output, keyed for fallback substitute().
 *
 * Channel 1: CLI params
 * Channel 2: iteration, completed_iterations, completion_keyword
 * Channel 4: handoff keys
 *
 * All keys are prefixed with "uv-" to match fallback template lookup.
 */
function buildFlowLoopVariables(
  iteration: number,
  cliArgs: Record<string, string> = {},
  handoff: Record<string, string> = {},
): Record<string, string> {
  const uv: Record<string, string> = {};

  // Channel 1: CLI params
  for (const [key, value] of Object.entries(cliArgs)) {
    uv[`uv-${key}`] = value;
  }

  // Channel 2: runtime iteration variables
  uv["uv-iteration"] = String(iteration);
  if (iteration > 1) {
    uv["uv-completed_iterations"] = String(iteration - 1);
  }

  // Channel 4: handoff from previous step
  for (const [key, value] of Object.entries(handoff)) {
    uv[`uv-${key}`] = value;
  }

  return uv;
}

/**
 * Channel 3 variables: what verdictHandler.setUvVariables() would add.
 *
 * These are the variables that only the Completion Loop provides
 * via verdictHandler.setUvVariables() and buildContinuationPrompt().
 * Keyed with "uv-" prefix to match fallback substitute() lookup.
 */
function buildChannel3Variables(
  maxIterations: number,
  currentIteration: number,
  previousSummary?: string,
): Record<string, string> {
  const vars: Record<string, string> = {
    "uv-max_iterations": String(maxIterations),
    "uv-remaining": String(maxIterations - currentIteration),
  };
  if (previousSummary !== undefined) {
    vars["uv-previous_summary"] = previousSummary;
  }
  vars["uv-check_count"] = "0";
  vars["uv-max_checks"] = "3";
  return vars;
}

// ---------------------------------------------------------------------------
// Channel 3 variable keys (with uv- prefix) that buildUvVariables()
// must NOT contain
// ---------------------------------------------------------------------------
const CHANNEL_3_KEYS = [
  "uv-max_iterations",
  "uv-remaining",
  "uv-previous_summary",
  "uv-check_count",
  "uv-max_checks",
];

// ===========================================================================
// Tests
// ===========================================================================

Deno.test("Issue 03 -- buildUvVariables does not include Channel 3 variables", () => {
  // Simulate what buildUvVariables(1) produces in the Flow Loop.
  // It includes Channel 1 (CLI), Channel 2 (iteration), and Channel 4 (handoff),
  // but never Channel 3 (verdict-handler-owned variables).
  const uvVars = buildFlowLoopVariables(1, {
    topic: "test-topic",
    issue: "42",
  }, {
    handoff_data: "some-value",
  });

  // Assert every Channel 3 key is absent from the output.
  for (const key of CHANNEL_3_KEYS) {
    assertEquals(
      uvVars[key],
      undefined,
      `Channel 3 variable "${key}" must NOT be present in buildUvVariables output, ` +
        `but was: "${uvVars[key]}"`,
    );
  }

  // Verify that Channel 1, 2, and 4 keys ARE present.
  assertEquals(uvVars["uv-topic"], "test-topic");
  assertEquals(uvVars["uv-issue"], "42");
  assertEquals(uvVars["uv-iteration"], "1");
  assertEquals(uvVars["uv-handoff_data"], "some-value");
});

Deno.test("Issue 01 -- initial_iterate template has unresolved {uv-max_iterations} after substitution", () => {
  // Flow Loop resolves initial_iterate with buildUvVariables output only.
  // Since max_iterations is a Channel 3 variable and buildUvVariables
  // does not provide it, the placeholder remains as literal text.
  const uvVars = buildFlowLoopVariables(1);
  const result = substitute(TEMPLATE_INITIAL_ITERATE, uvVars);

  // The literal placeholder must survive substitution because
  // no variable matches "uv-max_iterations" in the map.
  assertStringIncludes(
    result,
    "{uv-max_iterations}",
    "Placeholder {uv-max_iterations} must remain unresolved when Channel 3 variables are absent",
  );
});

Deno.test("Issue 01 -- max_iterations IS resolved when Channel 3 variables are present (expected behavior)", () => {
  // When verdictHandler.setUvVariables() enriches the variables map
  // with Channel 3 data (including uv-max_iterations), the placeholder
  // resolves correctly.
  const uvVars = buildFlowLoopVariables(1);
  const channel3 = buildChannel3Variables(10, 1);
  const enriched = { ...uvVars, ...channel3 };
  const result = substitute(TEMPLATE_INITIAL_ITERATE, enriched);

  // The placeholder must be replaced with the actual value.
  assertEquals(
    result.includes("{uv-max_iterations}"),
    false,
    "Placeholder {uv-max_iterations} must be resolved when Channel 3 variables are present",
  );
  assertStringIncludes(
    result,
    "**10**",
    "max_iterations value should appear in the rendered template",
  );
});

Deno.test("Issue 02 -- continuation template has unresolved {uv-previous_summary} on iteration 1", () => {
  // On iteration 1 there is no prior iteration, so previous_summary
  // is never set. The substitute() function uses graceful miss:
  //   variables[key] ?? variables[`uv-${key}`] ?? match
  // This means {uv-previous_summary} stays as literal text.
  const uvVars = buildFlowLoopVariables(1, {
    signal_type: "json",
  });
  const result = substitute(TEMPLATE_CONTINUATION_STRUCTURED_SIGNAL, uvVars);

  // previous_summary is absent -- placeholder must remain.
  assertStringIncludes(
    result,
    "{uv-previous_summary}",
    "Placeholder {uv-previous_summary} must remain unresolved on iteration 1 " +
      "because no prior iteration summary exists",
  );

  // Verify that other placeholders that DO have values are resolved.
  assertEquals(
    result.includes("{uv-iteration}"),
    false,
    "{uv-iteration} should be resolved since iteration=1 is provided",
  );
  assertEquals(
    result.includes("{uv-signal_type}"),
    false,
    "{uv-signal_type} should be resolved since signal_type is provided",
  );
});

Deno.test("Issue 03 -- Flow Loop vs Completion Loop asymmetry", () => {
  // This test demonstrates the root cause: Flow Loop and Completion Loop
  // produce different variable sets for the same template.

  // --- Mock VerdictHandler.setUvVariables() behavior ---
  // In production, setUvVariables() stores the base UV variables,
  // then buildContinuationPrompt() merges Channel 3 variables
  // (max_iterations, remaining, previous_summary) into the final set.
  function simulateCompletionLoopEnrichment(
    baseVars: Record<string, string>,
    maxIterations: number,
    currentIteration: number,
  ): Record<string, string> {
    const channel3 = buildChannel3Variables(
      maxIterations,
      currentIteration,
      currentIteration > 1 ? "Previous iteration completed task X." : undefined,
    );
    return { ...baseVars, ...channel3 };
  }

  const iteration = 2;
  const maxIterations = 5;

  // --- Flow Loop path: only buildUvVariables output, no setUvVariables ---
  const flowLoopVars = buildFlowLoopVariables(iteration, {
    signal_type: "json",
  });
  const flowLoopResult = substitute(
    TEMPLATE_CONTINUATION_STRUCTURED_SIGNAL,
    flowLoopVars,
  );

  // Channel 3 placeholders remain unresolved in Flow Loop.
  assertStringIncludes(
    flowLoopResult,
    "{uv-previous_summary}",
    "[Flow Loop] {uv-previous_summary} must remain unresolved without setUvVariables()",
  );

  // --- Completion Loop path: setUvVariables + Channel 3 enrichment ---
  const completionLoopVars = simulateCompletionLoopEnrichment(
    flowLoopVars,
    maxIterations,
    iteration,
  );
  const completionLoopResult = substitute(
    TEMPLATE_CONTINUATION_STRUCTURED_SIGNAL,
    completionLoopVars,
  );

  // Channel 3 placeholders are resolved in Completion Loop.
  assertEquals(
    completionLoopResult.includes("{uv-previous_summary}"),
    false,
    "[Completion Loop] {uv-previous_summary} must be resolved after setUvVariables()",
  );
  assertStringIncludes(
    completionLoopResult,
    "Previous iteration completed task X.",
    "[Completion Loop] previous_summary content should appear in the rendered template",
  );

  // Verify the asymmetry: same template, same iteration, different results.
  assertEquals(
    flowLoopResult === completionLoopResult,
    false,
    "Flow Loop and Completion Loop must produce different results for the same template, " +
      "proving the Channel 3 variable asymmetry",
  );
});
