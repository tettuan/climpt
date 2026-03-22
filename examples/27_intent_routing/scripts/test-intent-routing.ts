/**
 * Intent Routing Contract Test
 *
 * Validates that transitions in steps_registry.json are internally
 * consistent for all agents with step flow definitions.
 *
 * Checks:
 * 1. Each transition target exists in steps (or is null for closing)
 * 2. Each allowedIntent has a matching transition entry
 * 3. null targets are only used with "closing" intent
 */

import { join } from "@std/path";

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

const repoRoot = Deno.env.get("REPO_ROOT") || Deno.cwd();
const agents = ["iterator", "reviewer", "facilitator"];

let passed = 0;
let failed = 0;

for (const agent of agents) {
  log(`\nAgent: ${agent}`);

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
  const stepIds = Object.keys(steps);

  for (const [stepId, step] of Object.entries(steps)) {
    const transitions = (step.transitions ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const gate = step.structuredGate as
      | Record<string, unknown>
      | undefined;
    const allowedIntents = (gate?.allowedIntents ?? []) as string[];

    // Check 1: Each transition target exists in steps (or is null for terminal)
    for (const [intent, transition] of Object.entries(transitions)) {
      const target = transition.target as string | null;
      if (target === null) {
        // null target is valid for closing intent (terminal step)
        if (intent === "closing") {
          passed++;
        } else {
          logErr(
            `  FAIL: ${stepId} -> ${intent} has null target but intent is not 'closing'`,
          );
          failed++;
        }
      } else if (!stepIds.includes(target)) {
        logErr(
          `  FAIL: ${stepId} -> ${intent} targets '${target}' which does not exist in steps`,
        );
        failed++;
      } else {
        passed++;
      }
    }

    // Check 2: Each allowedIntent has a matching transition entry
    for (const intent of allowedIntents) {
      if (!transitions[intent]) {
        logErr(
          `  FAIL: ${stepId} has allowedIntent '${intent}' but no matching transition`,
        );
        failed++;
      } else {
        passed++;
      }
    }

    // Check 3: Each transition key is in allowedIntents (if gate exists)
    if (gate && allowedIntents.length > 0) {
      for (const transitionKey of Object.keys(transitions)) {
        if (!allowedIntents.includes(transitionKey)) {
          logErr(
            `  FAIL: ${stepId} has transition '${transitionKey}' not in allowedIntents [${
              allowedIntents.join(",")
            }]`,
          );
          failed++;
        } else {
          passed++;
        }
      }
    }
  }

  log(`  Checked ${stepIds.length} steps`);
}

log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) Deno.exit(1);
