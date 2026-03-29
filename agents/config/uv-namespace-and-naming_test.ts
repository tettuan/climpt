/**
 * Tests verifying UV variable contradictions documented in Issues 04, 05, and 06.
 *
 * These are standalone contradiction proofs — they do NOT import production modules
 * (except @std/assert). Each test reproduces the relevant buildUvVariables /
 * resolveSystemPromptForIteration / fallback-template logic inline to demonstrate
 * the documented inconsistency.
 *
 * Issue 05: Channel 1/4 namespace collision — handoff silently overwrites CLI params
 * Issue 04: uv-verdict_criteria bypasses the Channel system entirely
 * Issue 06: {uv-issue} vs issue_number naming mismatch between code and docs
 */

import { assertEquals, assertNotEquals } from "@std/assert";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mirrors production substituteVariables() from variable-substitutor.ts.
 *
 * Pattern: `{uv-varName}` — regex captures the part after "uv-".
 * Lookup order: variables[varName], then variables["uv-" + varName].
 * If neither exists the placeholder is left as-is.
 */
function substitute(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{uv-([a-zA-Z0-9_-]+)\}/g, (match, varName) => {
    const value = variables[varName] ?? variables[`uv-${varName}`];
    return value ?? match;
  });
}

/**
 * Simulates the Channel 4 toUV() key-format transform.
 *
 * In production, stepContext.toUV() converts dotted stepId + key into an
 * underscore-separated key: stepId "s.a", key "finding" → "s_a_finding".
 */
function toChannel4Key(stepId: string, key: string): string {
  return `${stepId.replace(/\./g, "_")}_${key}`;
}

// =============================================================================
// Issue 05 — Channel 1/4 namespace collision
// =============================================================================

Deno.test("Issue 05-a — Channel 4 handoff overwrites Channel 1 CLI param silently", () => {
  // Reproduce buildUvVariables() construction step by step.

  const uv: Record<string, string> = {};

  // Channel 1: CLI params
  const cliParams: Record<string, string> = {
    finding: "original_cli_value",
    topic: "my_topic",
  };
  for (const [key, value] of Object.entries(cliParams)) {
    uv[key] = value;
  }

  // Channel 2: runtime
  const iteration = 1;
  uv.iteration = String(iteration);

  // Snapshot the Channel 1 value before Channel 4 merge.
  const beforeMerge = uv.finding;
  assertEquals(beforeMerge, "original_cli_value");

  // Channel 4: handoff — uses the same key "finding" as Channel 1.
  const handoffUv: Record<string, string> = {
    finding: "handoff_overwrite",
  };

  // Production code: Object.assign(uv, handoffUv) — no collision check.
  const warnings: string[] = [];
  Object.assign(uv, handoffUv);

  // The CLI value is silently overwritten by the handoff value.
  assertEquals(
    uv.finding,
    "handoff_overwrite",
    "Channel 4 handoff must overwrite Channel 1 CLI param via Object.assign",
  );
  assertNotEquals(
    uv.finding,
    "original_cli_value",
    "Original CLI value must no longer be present",
  );

  // No warning or error was produced — the collision is silent.
  assertEquals(
    warnings.length,
    0,
    "No collision detection or warning exists in the current implementation",
  );

  // Other Channel 1 params remain untouched.
  assertEquals(uv.topic, "my_topic");
  assertEquals(uv.iteration, "1");
});

Deno.test("Issue 05-b — Channel 4 key format can collide with CLI param names", () => {
  // Channel 4 converts dotted stepId + key via toUV():
  //   stepId = "s.a", key = "finding" → "s_a_finding"
  //
  // If a CLI param happens to be named "s_a_finding", the handoff value
  // silently overwrites it — same flat namespace, no collision guard.

  const uv: Record<string, string> = {};

  // Channel 1: CLI param whose name matches the Channel 4 key format.
  const cliParams: Record<string, string> = {
    s_a_finding: "cli_value",
  };
  for (const [key, value] of Object.entries(cliParams)) {
    uv[key] = value;
  }

  assertEquals(uv.s_a_finding, "cli_value");

  // Channel 4: handoff produces the same key via toUV().
  const stepId = "s.a";
  const handoffKey = toChannel4Key(stepId, "finding");
  assertEquals(
    handoffKey,
    "s_a_finding",
    "Channel 4 key format (dots→underscores) must match the CLI param name",
  );

  const handoffUv: Record<string, string> = {
    [handoffKey]: "handoff_value",
  };
  Object.assign(uv, handoffUv);

  // The CLI value is overwritten.
  assertEquals(
    uv.s_a_finding,
    "handoff_value",
    "Channel 4 toUV key collides with CLI param and overwrites it",
  );
});

// =============================================================================
// Issue 04 — uv-verdict_criteria bypasses Channel system
// =============================================================================

Deno.test("Issue 04-a — uv-verdict_criteria is NOT present in buildUvVariables output", () => {
  // Reproduce a complete buildUvVariables() result with all four Channels.
  // verdict_criteria is intentionally absent — it is never supplied through
  // any Channel.

  const uv: Record<string, string> = {};

  // Channel 1: typical CLI params
  uv.issue = "42";
  uv.project = "climpt";

  // Channel 2: runtime
  uv.iteration = "1";

  // Channel 3: (step metadata — not UV-relevant, omitted)

  // Channel 4: handoff from prior step
  uv.initial_issue_summary = "Some summary from a prior step";

  // Neither the bare key nor the prefixed key is present.
  assertEquals(
    uv.verdict_criteria,
    undefined,
    "verdict_criteria must NOT appear in buildUvVariables output",
  );
  assertEquals(
    uv["uv-verdict_criteria"],
    undefined,
    "uv-verdict_criteria must NOT appear in buildUvVariables output",
  );
});

Deno.test("Issue 04-b — uv-verdict_criteria is manually injected outside Channel system", () => {
  // resolveSystemPromptForIteration() manually spreads verdict_criteria
  // into the variable map AFTER buildUvVariables() returns.

  // Simulate buildUvVariables() result.
  const buildUvResult: Record<string, string> = {
    issue: "42",
    iteration: "1",
  };

  // Manual injection — exactly as resolveSystemPromptForIteration does.
  const systemVars: Record<string, string> = {
    ...buildUvResult,
    "uv-verdict_criteria": "Some verdict criteria text",
  };

  // Template referencing the variable.
  const template = "Evaluate against: {uv-verdict_criteria}";
  const resolved = substitute(template, systemVars);

  assertEquals(
    resolved,
    "Evaluate against: Some verdict criteria text",
    "uv-verdict_criteria resolves only when manually injected outside the Channel system",
  );

  // Confirm it would NOT resolve from buildUvVariables alone.
  const withoutInjection = substitute(template, buildUvResult);
  assertEquals(
    withoutInjection,
    "Evaluate against: {uv-verdict_criteria}",
    "Without manual injection the placeholder remains unresolved",
  );
});

// =============================================================================
// Issue 06 — issue vs issue_number naming mismatch
// =============================================================================

Deno.test("Issue 06-a — template uses {uv-issue} but docs reference issue_number", () => {
  // The fallback template from fallback.ts uses {uv-issue}.
  const initialIssueTemplate =
    "# GitHub Issue #{uv-issue}\n\nWork on completing the requirements in Issue #{uv-issue}.";

  // Using the actual key "issue" resolves correctly.
  const withIssue = substitute(initialIssueTemplate, { issue: "42" });
  assertEquals(
    withIssue,
    "# GitHub Issue #42\n\nWork on completing the requirements in Issue #42.",
    "{uv-issue} must resolve when 'issue' is supplied",
  );

  // Using the documented key "issue_number" does NOT resolve —
  // the placeholder remains as-is because substitute() looks up "uv-issue"
  // (the placeholder key) and falls back to "uv-uv-issue", neither of which
  // matches "issue_number".
  const withIssueNumber = substitute(initialIssueTemplate, {
    issue_number: "42",
  });
  assertEquals(
    withIssueNumber,
    "# GitHub Issue #{uv-issue}\n\nWork on completing the requirements in Issue #{uv-issue}.",
    "{uv-issue} must remain unresolved when only 'issue_number' (the documented name) is supplied",
  );
});
