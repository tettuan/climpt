/**
 * Unit tests for tool-policy.ts
 *
 * Tests stepKind-based tool permission enforcement.
 */

import { assertEquals } from "@std/assert";
import {
  allowsBoundaryActions,
  BOUNDARY_BASH_PATTERNS,
  BOUNDARY_TOOLS,
  filterAllowedTools,
  getToolPolicy,
  isBashCommandAllowed,
  isToolAllowed,
  STEP_KIND_TOOL_POLICY,
} from "./tool-policy.ts";

Deno.test("tool-policy: BOUNDARY_TOOLS contains expected tools", () => {
  assertEquals(BOUNDARY_TOOLS.includes("githubIssueClose"), true);
  assertEquals(BOUNDARY_TOOLS.includes("githubPrMerge"), true);
  assertEquals(BOUNDARY_TOOLS.includes("githubReleaseCreate"), true);
});

Deno.test("tool-policy: work step denies boundary tools", () => {
  const policy = getToolPolicy("work");
  assertEquals(policy.blockBoundaryBash, true);
  assertEquals(policy.denied.includes("githubIssueClose"), true);
});

Deno.test("tool-policy: verification step denies boundary tools", () => {
  const policy = getToolPolicy("verification");
  assertEquals(policy.blockBoundaryBash, true);
  assertEquals(policy.denied.includes("githubIssueClose"), true);
});

Deno.test("tool-policy: closure step allows boundary tools", () => {
  const policy = getToolPolicy("closure");
  assertEquals(policy.blockBoundaryBash, false);
  assertEquals(policy.denied.length, 0);
  assertEquals(policy.allowed.includes("githubIssueClose"), true);
});

Deno.test("tool-policy: isToolAllowed denies boundary tool in work step", () => {
  const result = isToolAllowed("githubIssueClose", "work");
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary tool"), true);
});

Deno.test("tool-policy: isToolAllowed allows base tool in work step", () => {
  const result = isToolAllowed("Bash", "work");
  assertEquals(result.allowed, true);
  assertEquals(result.reason, undefined);
});

Deno.test("tool-policy: isToolAllowed allows boundary tool in closure step", () => {
  const result = isToolAllowed("githubIssueClose", "closure");
  assertEquals(result.allowed, true);
});

Deno.test("tool-policy: filterAllowedTools removes boundary tools for work step", () => {
  const configuredTools = ["Bash", "Read", "githubIssueClose", "githubPrMerge"];
  const filtered = filterAllowedTools(configuredTools, "work");

  assertEquals(filtered.includes("Bash"), true);
  assertEquals(filtered.includes("Read"), true);
  assertEquals(filtered.includes("githubIssueClose"), false);
  assertEquals(filtered.includes("githubPrMerge"), false);
});

Deno.test("tool-policy: filterAllowedTools keeps all tools for closure step", () => {
  const configuredTools = ["Bash", "Read", "githubIssueClose", "githubPrMerge"];
  const filtered = filterAllowedTools(configuredTools, "closure");

  assertEquals(filtered.includes("Bash"), true);
  assertEquals(filtered.includes("Read"), true);
  assertEquals(filtered.includes("githubIssueClose"), true);
  assertEquals(filtered.includes("githubPrMerge"), true);
});

Deno.test("tool-policy: isBashCommandAllowed blocks gh issue close in work step", () => {
  const result = isBashCommandAllowed("gh issue close 123", "work");
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary action"), true);
});

Deno.test("tool-policy: isBashCommandAllowed blocks gh pr merge in verification step", () => {
  const result = isBashCommandAllowed(
    "gh pr merge 456 --squash",
    "verification",
  );
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary action"), true);
});

Deno.test("tool-policy: isBashCommandAllowed allows gh issue close in closure step", () => {
  const result = isBashCommandAllowed("gh issue close 123", "closure");
  assertEquals(result.allowed, true);
});

Deno.test("tool-policy: isBashCommandAllowed allows non-boundary commands in work step", () => {
  const result = isBashCommandAllowed("gh issue view 123", "work");
  assertEquals(result.allowed, true);
});

Deno.test("tool-policy: isBashCommandAllowed blocks gh release create in work step", () => {
  const result = isBashCommandAllowed("gh release create v1.0.0", "work");
  assertEquals(result.allowed, false);
});

Deno.test("tool-policy: BOUNDARY_BASH_PATTERNS matches expected commands", () => {
  const patterns = BOUNDARY_BASH_PATTERNS;

  // Should match
  assertEquals(patterns.some((p) => p.test("gh issue close 123")), true);
  assertEquals(patterns.some((p) => p.test("gh issue delete 123")), true);
  assertEquals(
    patterns.some((p) => p.test("gh issue transfer 123 repo")),
    true,
  );
  assertEquals(patterns.some((p) => p.test("gh pr merge 456")), true);
  assertEquals(patterns.some((p) => p.test("gh release create v1.0")), true);
  assertEquals(
    patterns.some((p) => p.test("gh issue edit 123 --state closed")),
    true,
  );
  // gh api should be blocked entirely
  assertEquals(patterns.some((p) => p.test("gh api /repos/o/r/issues")), true);
  assertEquals(
    patterns.some((p) => p.test("gh api -X PATCH /repos/o/r/issues/1")),
    true,
  );

  // Should not match
  assertEquals(patterns.some((p) => p.test("gh issue view 123")), false);
  assertEquals(patterns.some((p) => p.test("gh pr view 456")), false);
  assertEquals(patterns.some((p) => p.test("gh issue list")), false);
});

Deno.test("tool-policy: allowsBoundaryActions returns correct values", () => {
  assertEquals(allowsBoundaryActions("work"), false);
  assertEquals(allowsBoundaryActions("verification"), false);
  assertEquals(allowsBoundaryActions("closure"), true);
});

Deno.test("tool-policy: STEP_KIND_TOOL_POLICY has all step kinds", () => {
  assertEquals("work" in STEP_KIND_TOOL_POLICY, true);
  assertEquals("verification" in STEP_KIND_TOOL_POLICY, true);
  assertEquals("closure" in STEP_KIND_TOOL_POLICY, true);
});
