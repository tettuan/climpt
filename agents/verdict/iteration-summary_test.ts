/**
 * Tests for formatIterationSummary and sanitizeForUvInjection.
 *
 * Why these tests exist:
 *   The formatted summary is injected as `--uv-previous_summary=<value>`
 *   into breakdown's CLI args. Breakdown's parser rejects values that
 *   contain shell metacharacters with `ParameterParsingError: Security
 *   error: Shell command execution or redirection attempt detected`.
 *   When that rejection escapes, the orchestrator misreports the failure
 *   (historically classified as file-not-found), blocking autonomous
 *   issue closure.
 *
 * Invariant under test:
 *   For every possible IterationSummary, the string returned by
 *   formatIterationSummary must not contain any character in the
 *   BREAKDOWN_REJECTED_CHARS set. This is the single, load-bearing
 *   property.
 */

import { assert, assertEquals } from "@std/assert";
import { formatIterationSummary, sanitizeForUvInjection } from "./types.ts";
import type { IterationSummary } from "../src_common/types.ts";

// Source of truth for the invariant. If breakdown's rejected-character
// set changes, update this constant — the test will then drive the
// sanitizer update, not the other way around.
const BREAKDOWN_REJECTED_CHARS = ["`", "$", "&", "|", ";", ">", "<"] as const;

function assertNoRejectedChars(output: string, context: string): void {
  const found = BREAKDOWN_REJECTED_CHARS.filter((c) => output.includes(c));
  if (found.length > 0) {
    throw new Error(
      [
        `Sanitizer invariant violated: output contains breakdown-rejected characters.`,
        `  Context:  ${context}`,
        `  Rejected: ${JSON.stringify(found)}`,
        `  Output:   ${JSON.stringify(output)}`,
        `  Source:   agents/verdict/types.ts UV_SHELL_METACHAR_MAP`,
        `  Fix:      extend UV_SHELL_METACHAR_MAP to cover every character in BREAKDOWN_REJECTED_CHARS.`,
      ].join("\n"),
    );
  }
}

function makeSummary(
  overrides: Partial<IterationSummary> = {},
): IterationSummary {
  return {
    iteration: 1,
    assistantResponses: [],
    toolsUsed: [],
    errors: [],
    ...overrides,
  } as IterationSummary;
}

// ---------------------------------------------------------------------------
// sanitizeForUvInjection — direct contract
// ---------------------------------------------------------------------------

Deno.test("sanitizeForUvInjection - every rejected character is replaced", () => {
  for (const ch of BREAKDOWN_REJECTED_CHARS) {
    const input = `before${ch}after`;
    const output = sanitizeForUvInjection(input);
    assert(
      !output.includes(ch),
      `sanitizeForUvInjection left ${JSON.stringify(ch)} in output: ${
        JSON.stringify(output)
      }`,
    );
    assert(
      output.includes("before") && output.includes("after"),
      `Surrounding text was damaged. Input: ${JSON.stringify(input)}, ` +
        `Output: ${JSON.stringify(output)}`,
    );
  }
});

Deno.test("sanitizeForUvInjection - plain ASCII passes through unchanged", () => {
  const input =
    "Normal sentence with punctuation: commas, dots. Numbers 123. Letters abc.";
  assertEquals(sanitizeForUvInjection(input), input);
});

Deno.test("sanitizeForUvInjection - the full rejected set in one string is fully neutralised", () => {
  const input = BREAKDOWN_REJECTED_CHARS.join("");
  const output = sanitizeForUvInjection(input);
  assertNoRejectedChars(output, "all rejected chars concatenated");
  assertEquals(
    output.length,
    input.length,
    `Length changed (substitution should be 1:1). Input: ${
      JSON.stringify(input)
    }, Output: ${JSON.stringify(output)}`,
  );
});

Deno.test("sanitizeForUvInjection - shell injection pattern is neutralised", () => {
  // This is the kind of content that trips breakdown's security check
  // when a raw assistant response mentions commands in the summary.
  const input = "Ran `gh issue close $ID` && reported done";
  const output = sanitizeForUvInjection(input);
  assertNoRejectedChars(output, "shell injection pattern");
});

// ---------------------------------------------------------------------------
// formatIterationSummary — integrates the sanitizer at the boundary
// ---------------------------------------------------------------------------

Deno.test("formatIterationSummary - output never contains rejected characters (assistant response has shell metas)", () => {
  const summary = makeSummary({
    iteration: 2,
    assistantResponses: [
      "I ran `gh issue view 472` and saw state `open > closed` was blocked by $ERR.",
    ],
    toolsUsed: ["Bash", "Read"],
    errors: ["pipe broken: stdout | stderr mismatch; exit=1"],
  });
  const output = formatIterationSummary(summary);
  assertNoRejectedChars(output, "assistant response with shell metas");
});

Deno.test("formatIterationSummary - output never contains rejected characters (structured output has shell metas)", () => {
  const summary = makeSummary({
    iteration: 3,
    structuredOutput: {
      status: "partial",
      next_action: {
        action: "retry `cmd | pipe`",
        reason: "timeout > 30s && no progress",
      },
    },
    assistantResponses: [],
    toolsUsed: [],
    errors: [],
  });
  const output = formatIterationSummary(summary);
  assertNoRejectedChars(output, "structured output with shell metas");
});

Deno.test("formatIterationSummary - output never contains rejected characters (errors have shell metas)", () => {
  const summary = makeSummary({
    iteration: 4,
    assistantResponses: [],
    toolsUsed: [],
    errors: [
      "command substitution failed: $(cmd)",
      "redirect rejected: >/tmp/foo",
      "pipeline broken: a | b | c",
    ],
  });
  const output = formatIterationSummary(summary);
  assertNoRejectedChars(output, "errors with shell metas");
});

Deno.test("formatIterationSummary - narrative content is preserved across substitution", () => {
  const summary = makeSummary({
    iteration: 2,
    assistantResponses: [
      "Investigated the bug in $module and confirmed the hypothesis.",
    ],
    toolsUsed: ["Read"],
    errors: [],
  });
  const output = formatIterationSummary(summary);
  // The substantive words must survive — only the $ changes glyph.
  assert(
    output.includes("Investigated the bug in"),
    `Leading narrative lost: ${JSON.stringify(output)}`,
  );
  assert(
    output.includes("module"),
    `Identifier lost: ${JSON.stringify(output)}`,
  );
  assert(
    output.includes("confirmed the hypothesis"),
    `Trailing narrative lost: ${JSON.stringify(output)}`,
  );
});
