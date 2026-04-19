/**
 * StepKind Tool Policy Contract Test
 *
 * Validates that the tool policy blocks GitHub write operations at the
 * bash layer across all step kinds, without any LLM calls.
 *
 * Contract:
 * - All step kinds (work/verification/closure): GitHub write bash commands
 *   (gh issue edit/close, gh pr edit/merge, gh release create, gh api, etc.)
 *   are BLOCKED. The Boundary Hook is the single write path.
 * - Read subcommands (gh issue view/list, gh pr view/diff) are ALLOWED.
 * - Workflow-continuation creates (gh issue create, gh pr create) are ALLOWED.
 *
 * Also verifies that steps_registry.json stepKind assignments
 * are consistent across all agents.
 */

import { join } from "@std/path";
import {
  filterAllowedTools,
  isBashCommandAllowed,
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

const stepKinds: StepKind[] = ["work", "verification", "closure"];

// Test 1: GitHub write bash commands blocked in every step kind
log("Test 1: GitHub write bash commands blocked in every step kind");
{
  const writeCommands = [
    "gh issue close 123",
    "gh issue delete 123",
    'gh issue edit 123 --add-label "done"',
    "gh issue edit 123 --state closed",
    "gh pr close 456",
    "gh pr merge 456",
    'gh pr edit 456 --add-label "reviewed"',
    "gh release create v1.0",
    "gh label create done",
    "gh project item-edit 1",
    "gh api /repos/o/r/issues",
  ];
  let allBlocked = true;
  for (const kind of stepKinds) {
    for (const cmd of writeCommands) {
      const result = isBashCommandAllowed(cmd, kind);
      if (result.allowed) {
        logErr(`  FAIL: "${cmd}" allowed in ${kind} step`);
        allBlocked = false;
        failed++;
      }
    }
  }
  if (allBlocked) {
    log(
      `  PASS: ${writeCommands.length} write commands blocked in all ${stepKinds.length} step kinds`,
    );
    passed++;
  }
}

// Test 2: Read and continuation-create commands stay allowed
log("Test 2: Read + continuation bash commands allowed in every step kind");
{
  const readCommands = [
    "gh issue view 123",
    "gh issue list",
    "gh pr view 456",
    "gh pr diff 456",
    "gh pr checks 456",
    "gh project view 1",
    "gh project item-list 1",
    // continuation creates (non-destructive, handled by finalize layer)
    "gh issue create --title X",
    "gh pr create --title X",
    // comments remain allowed (OutboxProcessor / Handoff Manager)
    'gh issue comment 123 --body "x"',
  ];
  let allAllowed = true;
  for (const kind of stepKinds) {
    for (const cmd of readCommands) {
      const result = isBashCommandAllowed(cmd, kind);
      if (!result.allowed) {
        logErr(
          `  FAIL: "${cmd}" blocked in ${kind} step: ${result.reason}`,
        );
        allAllowed = false;
        failed++;
      }
    }
  }
  if (allAllowed) {
    log(
      `  PASS: ${readCommands.length} read/continuation commands allowed in all ${stepKinds.length} step kinds`,
    );
    passed++;
  }
}

// Test 3: filterAllowedTools is a no-op (no MCP-level boundary tools exist)
log("Test 3: filterAllowedTools preserves configured tools");
{
  const configuredTools = ["Read", "Write", "Bash", "Edit"];
  let allPreserved = true;
  for (const kind of stepKinds) {
    const filtered = filterAllowedTools(configuredTools, kind);
    if (
      filtered.length !== configuredTools.length ||
      !configuredTools.every((t) => filtered.includes(t))
    ) {
      logErr(
        `  FAIL: filterAllowedTools dropped tools in ${kind}: [${
          filtered.join(",")
        }]`,
      );
      allPreserved = false;
      failed++;
    }
  }
  if (allPreserved) {
    log(`  PASS: all base tools preserved in every step kind`);
    passed++;
  }
}

// Test 4: STEP_KIND_TOOL_POLICY structure completeness
log("Test 4: STEP_KIND_TOOL_POLICY covers all step kinds");
{
  let complete = true;
  for (const kind of stepKinds) {
    const policy = STEP_KIND_TOOL_POLICY[kind];
    if (!policy) {
      logErr(`  FAIL: no policy defined for step kind "${kind}"`);
      complete = false;
      failed++;
    } else if (policy.allowed.length === 0) {
      logErr(`  FAIL: empty allowed list for step kind "${kind}"`);
      complete = false;
      failed++;
    } else if (!policy.blockBoundaryBash) {
      logErr(
        `  FAIL: step kind "${kind}" does not enforce blockBoundaryBash`,
      );
      complete = false;
      failed++;
    }
  }
  if (complete) {
    log(`  PASS: all ${stepKinds.length} step kinds have non-empty policies`);
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
