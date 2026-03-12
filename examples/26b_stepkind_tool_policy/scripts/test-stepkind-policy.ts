/**
 * StepKind Tool Policy Contract Test
 *
 * Validates that the tool policy correctly restricts boundary tools
 * based on step kind, without any LLM calls.
 *
 * Contract:
 * - work steps: boundary tools DENIED, boundary bash BLOCKED
 * - verification steps: boundary tools DENIED, boundary bash BLOCKED
 * - closure steps: boundary tools ALLOWED (in allowed list),
 *   but boundary bash still BLOCKED (must use Boundary Hook)
 *
 * Also verifies that steps_registry.json stepKind assignments
 * are consistent across all agents.
 */

import { join } from "@std/path";
import {
  BOUNDARY_TOOLS,
  filterAllowedTools,
  isBashCommandAllowed,
  isToolAllowed,
  STEP_KIND_TOOL_POLICY,
} from "../../../agents/common/tool-policy.ts";
import type { StepKind } from "../../../agents/common/step-registry/types.ts";

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

const repoRoot = Deno.env.get("REPO_ROOT") || Deno.cwd();

let passed = 0;
let failed = 0;

// --- Part 1: Tool Policy API Contracts ---

log("Part 1: Tool Policy API Contracts\n");

// Test 1: Work steps deny boundary tools
log("Test 1: Work steps deny boundary tools");
{
  let allDenied = true;
  for (const tool of BOUNDARY_TOOLS) {
    const result = isToolAllowed(tool, "work");
    if (result.allowed) {
      logErr(`  FAIL: boundary tool "${tool}" allowed in work step`);
      allDenied = false;
      failed++;
    }
  }
  if (allDenied) {
    log(
      `  PASS: all ${BOUNDARY_TOOLS.length} boundary tools denied in work steps`,
    );
    passed++;
  }
}

// Test 2: Verification steps deny boundary tools
log("Test 2: Verification steps deny boundary tools");
{
  let allDenied = true;
  for (const tool of BOUNDARY_TOOLS) {
    const result = isToolAllowed(tool, "verification");
    if (result.allowed) {
      logErr(
        `  FAIL: boundary tool "${tool}" allowed in verification step`,
      );
      allDenied = false;
      failed++;
    }
  }
  if (allDenied) {
    log(
      `  PASS: all ${BOUNDARY_TOOLS.length} boundary tools denied in verification steps`,
    );
    passed++;
  }
}

// Test 3: Closure steps allow boundary tools (in allowed list)
log("Test 3: Closure steps allow boundary tools");
{
  let allAllowed = true;
  for (const tool of BOUNDARY_TOOLS) {
    const result = isToolAllowed(tool, "closure");
    if (!result.allowed) {
      logErr(
        `  FAIL: boundary tool "${tool}" denied in closure step: ${result.reason}`,
      );
      allAllowed = false;
      failed++;
    }
  }
  if (allAllowed) {
    log(
      `  PASS: all ${BOUNDARY_TOOLS.length} boundary tools allowed in closure steps`,
    );
    passed++;
  }
}

// Test 4: Boundary bash blocked in all step kinds
log("Test 4: Boundary bash commands blocked in all step kinds");
{
  const testCommands = [
    "gh issue close 123",
    "gh pr merge 456",
    "gh release create v1.0",
  ];
  const stepKinds: StepKind[] = ["work", "verification", "closure"];
  let allBlocked = true;

  for (const kind of stepKinds) {
    for (const cmd of testCommands) {
      const result = isBashCommandAllowed(cmd, kind);
      if (result.allowed) {
        logErr(
          `  FAIL: bash command "${cmd}" allowed in ${kind} step`,
        );
        allBlocked = false;
        failed++;
      }
    }
  }
  if (allBlocked) {
    log(
      `  PASS: boundary bash commands blocked in all step kinds (${testCommands.length} cmds x ${stepKinds.length} kinds)`,
    );
    passed++;
  }
}

// Test 5: filterAllowedTools removes boundary tools for work steps
log("Test 5: filterAllowedTools removes boundary tools for work steps");
{
  const configuredTools = ["Read", "Write", "Bash", "githubIssueClose"];
  const filtered = filterAllowedTools(configuredTools, "work");
  if (filtered.includes("githubIssueClose")) {
    logErr(
      "  FAIL: filterAllowedTools did not remove githubIssueClose from work step",
    );
    failed++;
  } else if (!filtered.includes("Read")) {
    logErr(
      "  FAIL: filterAllowedTools removed non-boundary tool Read from work step",
    );
    failed++;
  } else {
    log(
      `  PASS: filterAllowedTools correctly filters [${
        configuredTools.join(",")
      }] -> [${filtered.join(",")}]`,
    );
    passed++;
  }
}

// Test 6: STEP_KIND_TOOL_POLICY structure completeness
log("Test 6: STEP_KIND_TOOL_POLICY covers all step kinds");
{
  const kinds: StepKind[] = ["work", "verification", "closure"];
  let complete = true;
  for (const kind of kinds) {
    const policy = STEP_KIND_TOOL_POLICY[kind];
    if (!policy) {
      logErr(`  FAIL: no policy defined for step kind "${kind}"`);
      complete = false;
      failed++;
    } else if (policy.allowed.length === 0) {
      logErr(`  FAIL: empty allowed list for step kind "${kind}"`);
      complete = false;
      failed++;
    }
  }
  if (complete) {
    log(`  PASS: all ${kinds.length} step kinds have non-empty policies`);
    passed++;
  }
}

// --- Part 2: steps_registry.json stepKind Consistency ---

log("\nPart 2: steps_registry.json stepKind Consistency\n");

const agents = ["iterator", "reviewer", "facilitator"];

for (const agent of agents) {
  log(`Agent: ${agent}`);

  const registryPath = join(repoRoot, ".agent", agent, "steps_registry.json");
  let registry: Record<string, unknown>;
  try {
    // deno-lint-ignore no-await-in-loop
    registry = JSON.parse(await Deno.readTextFile(registryPath));
  } catch {
    log(`  SKIP: ${registryPath} not found`);
    continue;
  }

  const steps = (registry.steps ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  for (const [stepId, step] of Object.entries(steps)) {
    const stepKind = step.stepKind as StepKind | undefined;
    const gate = step.structuredGate as
      | Record<string, unknown>
      | undefined;
    const allowedIntents = (gate?.allowedIntents ?? []) as string[];

    if (!stepKind) {
      // Steps without stepKind (like section.projectcontext) are not flow steps
      continue;
    }

    // Check: closure steps must have "closing" in allowedIntents
    if (stepKind === "closure") {
      if (!allowedIntents.includes("closing")) {
        logErr(
          `  FAIL: ${stepId} is stepKind=closure but allowedIntents does not include 'closing': [${
            allowedIntents.join(",")
          }]`,
        );
        failed++;
      } else {
        passed++;
      }
    }

    // Check: work steps must NOT have "closing" in allowedIntents
    if (stepKind === "work") {
      if (allowedIntents.includes("closing")) {
        logErr(
          `  FAIL: ${stepId} is stepKind=work but allowedIntents includes 'closing': [${
            allowedIntents.join(",")
          }]`,
        );
        failed++;
      } else {
        passed++;
      }
    }
  }

  log(`  Checked ${Object.keys(steps).length} steps`);
}

log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) Deno.exit(1);
