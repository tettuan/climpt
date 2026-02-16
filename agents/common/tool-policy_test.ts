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

Deno.test("tool-policy: closure step allows boundary tools but blocks bash", () => {
  const policy = getToolPolicy("closure");
  // Bash commands are blocked even in closure - boundary hook handles them
  assertEquals(policy.blockBoundaryBash, true);
  assertEquals(policy.denied.length, 0);
  // Boundary tools are still allowed (for non-bash tools like githubIssueClose)
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

Deno.test("tool-policy: isBashCommandAllowed blocks gh issue close even in closure step", () => {
  // Boundary bash commands are blocked in all steps
  // The boundary hook handles GitHub operations based on defaultClosureAction
  const result = isBashCommandAllowed("gh issue close 123", "closure");
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary action"), true);
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

// --- Bypass prevention: network tools targeting GitHub API ---
// These tests verify that LLM agents cannot bypass boundary restrictions
// by using curl/wget/python/node/etc. to call the GitHub REST API directly.

Deno.test("tool-policy: isBashCommandAllowed blocks curl targeting GitHub API", () => {
  const result = isBashCommandAllowed(
    `curl -X PATCH -H "Authorization: token xxx" https://api.github.com/repos/owner/repo/issues/135 -d '{"state":"closed"}'`,
    "work",
  );
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary action"), true);
});

Deno.test("tool-policy: isBashCommandAllowed blocks wget targeting GitHub API", () => {
  const result = isBashCommandAllowed(
    "wget --method=PATCH https://api.github.com/repos/owner/repo/issues/135",
    "work",
  );
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary action"), true);
});

Deno.test("tool-policy: isBashCommandAllowed blocks python3 targeting GitHub API", () => {
  const result = isBashCommandAllowed(
    `python3 -c "import requests; requests.patch('https://api.github.com/repos/owner/repo/issues/135', json={'state':'closed'})"`,
    "work",
  );
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary action"), true);
});

Deno.test("tool-policy: isBashCommandAllowed blocks node targeting GitHub API", () => {
  const result = isBashCommandAllowed(
    `node -e "fetch('https://api.github.com/repos/owner/repo/issues/135', {method:'PATCH', body:JSON.stringify({state:'closed'})})"`,
    "work",
  );
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary action"), true);
});

Deno.test("tool-policy: isBashCommandAllowed blocks state:closed payload via pipe", () => {
  const result = isBashCommandAllowed(
    `echo '{"state":"closed"}' | curl -X PATCH -d @- https://api.github.com/repos/owner/repo/issues/135`,
    "work",
  );
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("boundary action"), true);
});

Deno.test("tool-policy: isBashCommandAllowed allows legitimate curl to non-GitHub URLs", () => {
  const result = isBashCommandAllowed("curl https://example.com", "work");
  assertEquals(result.allowed, true);
});

Deno.test("tool-policy: isBashCommandAllowed allows legitimate python3 scripts", () => {
  const result = isBashCommandAllowed("python3 script.py", "work");
  assertEquals(result.allowed, true);
});

Deno.test("tool-policy: isBashCommandAllowed still allows gh issue view (read-only)", () => {
  const result = isBashCommandAllowed("gh issue view 135", "work");
  assertEquals(result.allowed, true);
});

Deno.test("tool-policy: BOUNDARY_BASH_PATTERNS matches network bypass commands", () => {
  const patterns = BOUNDARY_BASH_PATTERNS;

  // curl/wget targeting GitHub API should match
  assertEquals(
    patterns.some((p) =>
      p.test("curl -X PATCH https://api.github.com/repos/o/r/issues/1")
    ),
    true,
  );
  assertEquals(
    patterns.some((p) =>
      p.test("wget https://api.github.com/repos/o/r/issues/1")
    ),
    true,
  );

  // Script interpreters targeting GitHub API should match
  assertEquals(
    patterns.some((p) =>
      p.test("python3 -c 'requests.patch(\"https://api.github.com/...\")'")
    ),
    true,
  );
  assertEquals(
    patterns.some((p) =>
      p.test("python -c 'requests.patch(\"https://api.github.com/...\")'")
    ),
    true,
  );
  assertEquals(
    patterns.some((p) =>
      p.test("node -e \"fetch('https://api.github.com/...')\"")
    ),
    true,
  );
  assertEquals(
    patterns.some((p) =>
      p.test("ruby -e 'Net::HTTP.get(\"https://api.github.com/...\")'")
    ),
    true,
  );
  assertEquals(
    patterns.some((p) =>
      p.test("deno run script.ts https://api.github.com/repos/o/r")
    ),
    true,
  );
  assertEquals(
    patterns.some((p) =>
      p.test("perl -e 'use LWP; get(\"https://api.github.com/...\")'")
    ),
    true,
  );

  // State mutation payloads should match
  assertEquals(
    patterns.some((p) => p.test('{"state":"closed"}')),
    true,
  );
  assertEquals(
    patterns.some((p) => p.test("{'state':'closed'}")),
    true,
  );
  assertEquals(
    patterns.some((p) => p.test('{ "state" : "closed" }')),
    true,
  );

  // Legitimate commands should NOT match
  assertEquals(
    patterns.some((p) => p.test("curl https://example.com")),
    false,
  );
  assertEquals(
    patterns.some((p) => p.test("python3 script.py")),
    false,
  );
  assertEquals(
    patterns.some((p) => p.test("node server.js")),
    false,
  );
  assertEquals(
    patterns.some((p) => p.test("deno run app.ts")),
    false,
  );
});

Deno.test("tool-policy: bypass patterns blocked in closure step too", () => {
  // Even in closure steps, direct API calls are blocked (boundary hook handles them)
  const curlResult = isBashCommandAllowed(
    "curl -X PATCH https://api.github.com/repos/o/r/issues/1",
    "closure",
  );
  assertEquals(curlResult.allowed, false);

  const stateResult = isBashCommandAllowed(
    '{"state":"closed"}',
    "closure",
  );
  assertEquals(stateResult.allowed, false);
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
