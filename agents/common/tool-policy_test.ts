/**
 * Unit tests for tool-policy.ts
 *
 * Tests stepKind-based tool permission enforcement.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  allowsBoundaryActions,
  BOUNDARY_BASH_PATTERNS,
  filterAllowedTools,
  getToolPolicy,
  isBashCommandAllowed,
  isToolAllowed,
  isToolDeniedByPermissionMode,
  PLAN_MODE_WRITE_TOOLS,
  resolvePermissionMode,
  STEP_KIND_TOOL_POLICY,
} from "./tool-policy.ts";
import type { PermissionMode } from "../src_common/types/agent-definition.ts";
import type { StepKind } from "./step-registry/types.ts";

Deno.test("tool-policy: work step enables boundary bash enforcement", () => {
  const policy = getToolPolicy("work");
  assertEquals(policy.blockBoundaryBash, true);
  assertEquals(
    policy.denied.length,
    0,
    "denied list is empty --enforcement happens at bash-pattern layer",
  );
});

Deno.test("tool-policy: verification step enables boundary bash enforcement", () => {
  const policy = getToolPolicy("verification");
  assertEquals(policy.blockBoundaryBash, true);
  assertEquals(policy.denied.length, 0);
});

Deno.test("tool-policy: closure step also enforces boundary bash", () => {
  // Closure steps must also block bash writes --the Boundary Hook is the
  // single write path, even when closure intent fires.
  const policy = getToolPolicy("closure");
  assertEquals(policy.blockBoundaryBash, true);
  assertEquals(policy.denied.length, 0);
});

Deno.test("tool-policy: isToolAllowed allows base tools in every step kind", () => {
  for (const kind of ["work", "verification", "closure"] as StepKind[]) {
    for (const tool of ["Bash", "Read", "Write", "Edit", "Grep"]) {
      const result = isToolAllowed(tool, kind);
      assertEquals(
        result.allowed,
        true,
        `"${tool}" must be allowed in ${kind}: ${result.reason ?? ""}`,
      );
    }
  }
});

Deno.test("tool-policy: filterAllowedTools is a no-op when denied is empty", () => {
  const configuredTools = ["Bash", "Read", "Write", "Edit"];
  for (const kind of ["work", "verification", "closure"] as StepKind[]) {
    const filtered = filterAllowedTools(configuredTools, kind);
    assertEquals(filtered, configuredTools);
  }
});

Deno.test("tool-policy: isBashCommandAllowed blocks gh issue close in work step", () => {
  const result = isBashCommandAllowed("gh issue close 123", "work");
  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason ?? "", "boundary action");
});

Deno.test("tool-policy: isBashCommandAllowed blocks gh pr merge in verification step", () => {
  const result = isBashCommandAllowed(
    "gh pr merge 456 --squash",
    "verification",
  );
  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason ?? "", "boundary action");
});

Deno.test("tool-policy: isBashCommandAllowed blocks gh issue close even in closure step", () => {
  // Boundary bash commands are blocked in all steps
  // The boundary hook handles GitHub operations based on defaultClosureAction
  const result = isBashCommandAllowed("gh issue close 123", "closure");
  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason ?? "", "boundary action");
});

Deno.test("tool-policy: isBashCommandAllowed allows non-boundary commands in work step", () => {
  const result = isBashCommandAllowed("gh issue view 123", "work");
  assertEquals(result.allowed, true);
});

Deno.test("tool-policy: isBashCommandAllowed blocks gh release create in work step", () => {
  const result = isBashCommandAllowed("gh release create v1.0.0", "work");
  assertEquals(result.allowed, false);
});

Deno.test("tool-policy: BOUNDARY_BASH_PATTERNS blocks all gh issue write subcommands", () => {
  const patterns = BOUNDARY_BASH_PATTERNS;

  // Termination
  assertEquals(patterns.some((p) => p.test("gh issue close 123")), true);
  assertEquals(patterns.some((p) => p.test("gh issue delete 123")), true);
  assertEquals(
    patterns.some((p) => p.test("gh issue transfer 123 repo")),
    true,
  );
  assertEquals(patterns.some((p) => p.test("gh issue reopen 123")), true);

  // All issue edit forms --not just --state closed (this was the bypass gap)
  assertEquals(
    patterns.some((p) => p.test("gh issue edit 123 --state closed")),
    true,
  );
  assertEquals(
    patterns.some((p) => p.test('gh issue edit 123 --add-label "done"')),
    true,
    "gh issue edit --add-label must be blocked (was bypass gap to Boundary Hook)",
  );
  assertEquals(
    patterns.some((p) => p.test("gh issue edit 123 --title 'new title'")),
    true,
  );
  assertEquals(
    patterns.some((p) => p.test("gh issue edit 123 --body-file x.md")),
    true,
  );

  // Pin/lock mutations
  assertEquals(patterns.some((p) => p.test("gh issue pin 123")), true);
  assertEquals(patterns.some((p) => p.test("gh issue lock 123")), true);
});

Deno.test("tool-policy: BOUNDARY_BASH_PATTERNS blocks all gh pr write subcommands", () => {
  const patterns = BOUNDARY_BASH_PATTERNS;

  assertEquals(patterns.some((p) => p.test("gh pr merge 456")), true);
  assertEquals(patterns.some((p) => p.test("gh pr close 456")), true);
  assertEquals(patterns.some((p) => p.test("gh pr ready 456")), true);
  assertEquals(patterns.some((p) => p.test("gh pr reopen 456")), true);
  assertEquals(patterns.some((p) => p.test("gh pr lock 456")), true);
  assertEquals(
    patterns.some((p) => p.test("gh pr review 456 --approve")),
    true,
  );

  // PR edit (label/title/body/milestone etc.) must be blocked
  assertEquals(
    patterns.some((p) => p.test('gh pr edit 456 --add-label "reviewed"')),
    true,
    "gh pr edit --add-label must be blocked (was bypass gap to Boundary Hook)",
  );
  assertEquals(
    patterns.some((p) => p.test("gh pr edit 456 --title 'new'")),
    true,
  );
});

Deno.test("tool-policy: BOUNDARY_BASH_PATTERNS blocks release/project/label/repo writes", () => {
  const patterns = BOUNDARY_BASH_PATTERNS;

  // Release
  assertEquals(patterns.some((p) => p.test("gh release create v1.0")), true);
  assertEquals(patterns.some((p) => p.test("gh release edit v1.0")), true);
  assertEquals(patterns.some((p) => p.test("gh release delete v1.0")), true);
  assertEquals(
    patterns.some((p) => p.test("gh release upload v1.0 file.tar.gz")),
    true,
  );

  // Project state mutations
  assertEquals(patterns.some((p) => p.test("gh project edit 1")), true);
  assertEquals(patterns.some((p) => p.test("gh project item-edit 1")), true);
  assertEquals(patterns.some((p) => p.test("gh project item-add 1")), true);
  assertEquals(
    patterns.some((p) => p.test("gh project field-create 1")),
    true,
  );

  // Label taxonomy
  assertEquals(patterns.some((p) => p.test("gh label create done")), true);
  assertEquals(patterns.some((p) => p.test("gh label edit done")), true);
  assertEquals(patterns.some((p) => p.test("gh label delete done")), true);

  // Repo writes
  assertEquals(patterns.some((p) => p.test("gh repo create o/r")), true);
  assertEquals(patterns.some((p) => p.test("gh repo delete o/r")), true);
  assertEquals(patterns.some((p) => p.test("gh repo edit o/r")), true);
  assertEquals(patterns.some((p) => p.test("gh repo archive o/r")), true);
});

Deno.test("tool-policy: BOUNDARY_BASH_PATTERNS blocks direct gh api calls", () => {
  const patterns = BOUNDARY_BASH_PATTERNS;
  assertEquals(patterns.some((p) => p.test("gh api /repos/o/r/issues")), true);
  assertEquals(
    patterns.some((p) => p.test("gh api -X PATCH /repos/o/r/issues/1")),
    true,
  );
});

Deno.test("tool-policy: BOUNDARY_BASH_PATTERNS allows reads and continuation creates", () => {
  const patterns = BOUNDARY_BASH_PATTERNS;

  // Reads --mcp__github__github_read is preferred, but bash reads remain allowed
  assertEquals(patterns.some((p) => p.test("gh issue view 123")), false);
  assertEquals(patterns.some((p) => p.test("gh issue list")), false);
  assertEquals(patterns.some((p) => p.test("gh pr view 456")), false);
  assertEquals(patterns.some((p) => p.test("gh pr list")), false);
  assertEquals(patterns.some((p) => p.test("gh pr diff 456")), false);
  assertEquals(patterns.some((p) => p.test("gh pr checks 456")), false);
  assertEquals(patterns.some((p) => p.test("gh project view 1")), false);
  assertEquals(patterns.some((p) => p.test("gh project list")), false);
  assertEquals(patterns.some((p) => p.test("gh project item-list 1")), false);

  // Workflow-continuation creates are allowed (non-destructive, finalize layer)
  assertEquals(
    patterns.some((p) => p.test("gh issue create --title X")),
    false,
  );
  assertEquals(patterns.some((p) => p.test("gh pr create --title X")), false);

  // Comments remain allowed (handled by OutboxProcessor / Handoff Manager
  // in host process; bash path is sandbox-blocked in practice)
  assertEquals(
    patterns.some((p) => p.test('gh issue comment 123 --body "x"')),
    false,
  );
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
  assertStringIncludes(result.reason ?? "", "boundary action");
});

Deno.test("tool-policy: isBashCommandAllowed blocks wget targeting GitHub API", () => {
  const result = isBashCommandAllowed(
    "wget --method=PATCH https://api.github.com/repos/owner/repo/issues/135",
    "work",
  );
  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason ?? "", "boundary action");
});

Deno.test("tool-policy: isBashCommandAllowed blocks python3 targeting GitHub API", () => {
  const result = isBashCommandAllowed(
    `python3 -c "import requests; requests.patch('https://api.github.com/repos/owner/repo/issues/135', json={'state':'closed'})"`,
    "work",
  );
  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason ?? "", "boundary action");
});

Deno.test("tool-policy: isBashCommandAllowed blocks node targeting GitHub API", () => {
  const result = isBashCommandAllowed(
    `node -e "fetch('https://api.github.com/repos/owner/repo/issues/135', {method:'PATCH', body:JSON.stringify({state:'closed'})})"`,
    "work",
  );
  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason ?? "", "boundary action");
});

Deno.test("tool-policy: isBashCommandAllowed blocks state:closed payload via pipe", () => {
  const result = isBashCommandAllowed(
    `echo '{"state":"closed"}' | curl -X PATCH -d @- https://api.github.com/repos/owner/repo/issues/135`,
    "work",
  );
  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason ?? "", "boundary action");
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

// --- resolvePermissionMode tests ---

Deno.test("tool-policy: resolvePermissionMode step-level override takes priority", () => {
  const result = resolvePermissionMode("plan", "work", "acceptEdits");
  assertEquals(
    result,
    "plan",
    "step-level permissionMode must take priority over stepKind default and agent-level. " +
      "Fix: check resolvePermissionMode() priority logic in tool-policy.ts",
  );
});

Deno.test("tool-policy: resolvePermissionMode returns stepKind default when step-level is undefined", () => {
  const stepKinds = Object.keys(STEP_KIND_TOOL_POLICY) as StepKind[];
  assert(
    stepKinds.length > 0,
    "Non-vacuity: STEP_KIND_TOOL_POLICY must not be empty",
  );

  for (const kind of stepKinds) {
    const expected = STEP_KIND_TOOL_POLICY[kind].defaultPermissionMode;
    // Use a different agent-level value to prove stepKind default wins
    const agentLevel: PermissionMode = expected === "plan"
      ? "acceptEdits"
      : "plan";
    const result = resolvePermissionMode(undefined, kind, agentLevel);
    assertEquals(
      result,
      expected,
      `stepKind "${kind}": expected STEP_KIND_TOOL_POLICY["${kind}"].defaultPermissionMode ` +
        `(${expected}), got ${result}. ` +
        `Fix: check resolvePermissionMode() or STEP_KIND_TOOL_POLICY in tool-policy.ts`,
    );
  }
});

Deno.test("tool-policy: resolvePermissionMode agent-level fallback when no stepKind", () => {
  const result = resolvePermissionMode(
    undefined,
    undefined,
    "bypassPermissions",
  );
  assertEquals(
    result,
    "bypassPermissions",
    "When stepKind is undefined, agent-level permissionMode must be used. " +
      "Fix: check resolvePermissionMode() fallback logic in tool-policy.ts",
  );
});

Deno.test("tool-policy: resolvePermissionMode step-level overrides stepKind default", () => {
  const result = resolvePermissionMode(
    "bypassPermissions",
    "verification",
    "plan",
  );
  assertEquals(
    result,
    "bypassPermissions",
    "step-level permissionMode must override stepKind default. " +
      "Fix: check resolvePermissionMode() priority logic in tool-policy.ts",
  );
});

Deno.test("tool-policy: resolvePermissionMode every stepKind has a defaultPermissionMode", () => {
  const stepKinds = Object.keys(STEP_KIND_TOOL_POLICY) as StepKind[];
  assert(stepKinds.length > 0, "STEP_KIND_TOOL_POLICY must not be empty");

  for (const kind of stepKinds) {
    const policy = STEP_KIND_TOOL_POLICY[kind];
    assert(
      policy.defaultPermissionMode !== undefined,
      `stepKind "${kind}" is missing defaultPermissionMode in STEP_KIND_TOOL_POLICY. ` +
        `Fix: add defaultPermissionMode to STEP_KIND_TOOL_POLICY["${kind}"] in tool-policy.ts`,
    );
  }
});

// ---------------------------------------------------------------------------
// isToolDeniedByPermissionMode
// ---------------------------------------------------------------------------

Deno.test("tool-policy: plan mode denies write tools", () => {
  for (const tool of PLAN_MODE_WRITE_TOOLS) {
    const result = isToolDeniedByPermissionMode(tool, "plan");
    assertEquals(
      result.allowed,
      false,
      `Tool "${tool}" must be denied in plan mode (read-only exploration). ` +
        `Fix: add "${tool}" to PLAN_MODE_WRITE_TOOLS in tool-policy.ts`,
    );
    assertStringIncludes(
      result.reason ?? "",
      "plan mode",
      `Denial reason for "${tool}" must mention plan mode`,
    );
  }
});

Deno.test("tool-policy: plan mode allows read-only tools", () => {
  const readOnlyTools = [
    "Read",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "Task",
  ];
  for (const tool of readOnlyTools) {
    const result = isToolDeniedByPermissionMode(tool, "plan");
    assertEquals(
      result.allowed,
      true,
      `Tool "${tool}" must be allowed in plan mode (read-only). ` +
        `Fix: remove "${tool}" from PLAN_MODE_WRITE_TOOLS if it was added by mistake`,
    );
  }
});

Deno.test("tool-policy: acceptEdits mode allows all tools", () => {
  const allTools = [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "NotebookEdit",
    "TodoWrite",
  ];
  for (const tool of allTools) {
    const result = isToolDeniedByPermissionMode(tool, "acceptEdits");
    assertEquals(
      result.allowed,
      true,
      `Tool "${tool}" must be allowed in acceptEdits mode. ` +
        `isToolDeniedByPermissionMode must only restrict plan mode`,
    );
  }
});

Deno.test("tool-policy: bypassPermissions mode allows all tools", () => {
  for (const tool of PLAN_MODE_WRITE_TOOLS) {
    const result = isToolDeniedByPermissionMode(tool, "bypassPermissions");
    assertEquals(
      result.allowed,
      true,
      `Tool "${tool}" must be allowed in bypassPermissions mode`,
    );
  }
});

Deno.test("tool-policy: default mode allows all tools", () => {
  for (const tool of PLAN_MODE_WRITE_TOOLS) {
    const result = isToolDeniedByPermissionMode(tool, "default");
    assertEquals(
      result.allowed,
      true,
      `Tool "${tool}" must be allowed in default mode`,
    );
  }
});
