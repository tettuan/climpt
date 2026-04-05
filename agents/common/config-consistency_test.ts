/**
 * Config Consistency Test
 *
 * Two-layer verification:
 * 1. Runner-required phases (STEP_PHASE) must be in every agent's directiveType pattern
 *    — source of truth: agents/shared/step-phases.ts
 * 2. Each agent's steps_registry.json c2/c3 values must match its user.yml patterns
 *    — catches config-specific drift
 *
 * Prevents PR-C3L-004 regressions caused by pattern/registry mismatch.
 */

import { assert } from "@std/assert";
import { STEP_PHASE } from "../shared/step-phases.ts";

const AGENTS = ["iterator", "reviewer", "facilitator"] as const;
const CONFIG_DIR = ".agent/climpt/config";

/** All phases defined in STEP_PHASE are runner concepts and must be accepted by breakdown. */
const RUNNER_REQUIRED_PHASES: readonly string[] = Object.values(STEP_PHASE);

interface RegistryJson {
  steps: Record<string, { c2: string; c3: string }>;
  validationSteps?: Record<string, { c2: string; c3: string }>;
}

/**
 * Collect all c2/c3 values from every C3L-bearing section in the registry.
 * Prevents partial consumer enumeration — any section that declares c2/c3
 * values consumed by breakdown config patterns must be included here.
 */
function collectAllC2C3(registry: RegistryJson): {
  c2: Set<string>;
  c3: Set<string>;
} {
  const c2 = new Set<string>();
  const c3 = new Set<string>();

  for (const step of Object.values(registry.steps)) {
    c2.add(step.c2);
    c3.add(step.c3);
  }
  for (const vstep of Object.values(registry.validationSteps ?? {})) {
    c2.add(vstep.c2);
    c3.add(vstep.c3);
  }

  return { c2, c3 };
}

/**
 * Extract regex pattern string from user.yml content.
 * Matches: `pattern: "^(a|b|c)$"` format.
 */
function extractPattern(yml: string, key: string): string | null {
  const re = new RegExp(`${key}:[\\s\\S]*?pattern:\\s*"([^"]+)"`);
  const m = yml.match(re);
  return m ? m[1] : null;
}

function extractPatternValues(pattern: string): string[] {
  const match = pattern.match(/^\^\((.+)\)\$$/);
  if (!match) return [];
  return match[1].split("|");
}

// --- Layer 1: Runner-required phases ---

for (const agent of AGENTS) {
  Deno.test(`Runner phases: ${agent} — directiveType includes STEP_PHASE values`, async () => {
    const userYml = await Deno.readTextFile(
      `${CONFIG_DIR}/${agent}-steps-user.yml`,
    );
    const dtPattern = extractPattern(userYml, "directiveType");
    assert(
      dtPattern,
      `directiveType pattern not found in ${agent}-steps-user.yml`,
    );

    const pattern = new RegExp(dtPattern);
    const allowed = extractPatternValues(dtPattern);

    const missing = RUNNER_REQUIRED_PHASES.filter((v) => !pattern.test(v));
    assert(
      missing.length === 0,
      `Fix: Add [${
        missing.join(", ")
      }] to directiveType.pattern in ${CONFIG_DIR}/${agent}-steps-user.yml. ` +
        `These phases are runner-required (defined in agents/shared/step-phases.ts). ` +
        `Current pattern allows: [${allowed.join(", ")}].`,
    );
  });
}

// --- Layer 2: Registry c2/c3 coverage ---

for (const agent of AGENTS) {
  Deno.test(`Registry coverage: ${agent} — directiveType covers all c2 values (steps + validationSteps)`, async () => {
    const registry: RegistryJson = JSON.parse(
      await Deno.readTextFile(`.agent/${agent}/steps_registry.json`),
    );
    const userYml = await Deno.readTextFile(
      `${CONFIG_DIR}/${agent}-steps-user.yml`,
    );
    const dtPattern = extractPattern(userYml, "directiveType");
    assert(
      dtPattern,
      `directiveType pattern not found in ${agent}-steps-user.yml`,
    );

    const pattern = new RegExp(dtPattern);
    const allowed = extractPatternValues(dtPattern);
    const { c2: allC2 } = collectAllC2C3(registry);

    const missing = [...allC2].filter((v) => !pattern.test(v));
    assert(
      missing.length === 0,
      `Mismatch: .agent/${agent}/steps_registry.json (steps + validationSteps) uses c2 values [${
        missing.join(", ")
      }] not in ${CONFIG_DIR}/${agent}-steps-user.yml directiveType pattern [${
        allowed.join(", ")
      }]. ` +
        `IF you added a new step/validationStep to steps_registry.json, THEN add the c2 value to user.yml directiveType.pattern. ` +
        `IF you intentionally narrowed user.yml, THEN remove the step from steps_registry.json.`,
    );
  });

  Deno.test(`Registry coverage: ${agent} — layerType covers all c3 values (steps + validationSteps)`, async () => {
    const registry: RegistryJson = JSON.parse(
      await Deno.readTextFile(`.agent/${agent}/steps_registry.json`),
    );
    const userYml = await Deno.readTextFile(
      `${CONFIG_DIR}/${agent}-steps-user.yml`,
    );
    const ltPattern = extractPattern(userYml, "layerType");
    assert(ltPattern, `layerType pattern not found in ${agent}-steps-user.yml`);

    const pattern = new RegExp(ltPattern);
    const allowed = extractPatternValues(ltPattern);
    const { c3: allC3 } = collectAllC2C3(registry);

    const missing = [...allC3].filter((v) => !pattern.test(v));
    assert(
      missing.length === 0,
      `Mismatch: .agent/${agent}/steps_registry.json (steps + validationSteps) uses c3 values [${
        missing.join(", ")
      }] not in ${CONFIG_DIR}/${agent}-steps-user.yml layerType pattern [${
        allowed.join(", ")
      }]. ` +
        `IF you added a new step/validationStep to steps_registry.json, THEN add the c3 value to user.yml layerType.pattern. ` +
        `IF you intentionally narrowed user.yml, THEN remove the step from steps_registry.json.`,
    );
  });
}
