/**
 * Config Consistency Test
 *
 * For every climpt dev-time agent, each c2/c3 value appearing in
 * steps_registry.json (both `steps` and `validationSteps`) must be accepted
 * by the corresponding {name}-steps-user.yml `directiveType` / `layerType`
 * pattern — otherwise breakdown rejects the runner's call.
 *
 * Pattern: Conformance Test (either side could be wrong — registry or user.yml).
 * Message is IF/THEN to cover both directions.
 *
 * Agents are discovered dynamically via `discoverAgents()`. Tests MUST NOT
 * hardcode agent names — `.agent/<name>/*` is user-side config, and
 * hardcoding partial-enumerates the consumer set (see test-design skill).
 *
 * Note: a prior Layer 1 "every agent must accept all STEP_PHASE values"
 * check was removed as over-constrained. The authoritative contract
 * (confirmed by the leading comments in each <agent>-steps-user.yml) is
 * "pattern must include all STEP_PHASE values **used in** steps_registry.json",
 * which this test already enforces. Closure-only agents (triager, merger,
 * clarifier, considerer, detailer) correctly ship patterns containing only
 * `closure`.
 *
 * Prevents PR-C3L-004 regressions caused by pattern/registry mismatch.
 */

import { assert } from "@std/assert";
import { discoverAgents } from "../testing/discover-agents.ts";

const CONFIG_DIR = ".agent/climpt/config";

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

const discovered = await discoverAgents({ requireUserYml: true });

Deno.test("config-consistency — at least one agent discovered (non-vacuity)", () => {
  assert(
    discovered.length > 0,
    `No agents found under .agent/*/ with steps_registry.json + ${CONFIG_DIR}/<name>-steps-user.yml. ` +
      `This test iterates discovered agents; an empty set would pass vacuously. ` +
      `Fix: verify .agent/ contains at least one agent with both steps_registry.json and a matching steps-user.yml.`,
  );
});

// --- Registry c2/c3 coverage (Conformance Test) ---

for (const { name: agent, registryPath, userYmlPath } of discovered) {
  Deno.test(`Registry coverage: ${agent} — directiveType covers all c2 values (steps + validationSteps)`, async () => {
    const registry: RegistryJson = JSON.parse(
      await Deno.readTextFile(registryPath),
    );
    const userYml = await Deno.readTextFile(userYmlPath!);
    const dtPattern = extractPattern(userYml, "directiveType");
    assert(
      dtPattern,
      `directiveType pattern not found in ${userYmlPath}`,
    );

    const pattern = new RegExp(dtPattern);
    const allowed = extractPatternValues(dtPattern);
    const { c2: allC2 } = collectAllC2C3(registry);

    const missing = [...allC2].filter((v) => !pattern.test(v));
    assert(
      missing.length === 0,
      `Mismatch: ${registryPath} (steps + validationSteps) uses c2 values [${
        missing.join(", ")
      }] ` +
        `not in ${userYmlPath} directiveType pattern [${
          allowed.join(", ")
        }]. ` +
        `IF you added a new step/validationStep to steps_registry.json, THEN add the c2 value to user.yml directiveType.pattern. ` +
        `IF you intentionally narrowed user.yml, THEN remove the step from steps_registry.json.`,
    );
  });

  Deno.test(`Registry coverage: ${agent} — layerType covers all c3 values (steps + validationSteps)`, async () => {
    const registry: RegistryJson = JSON.parse(
      await Deno.readTextFile(registryPath),
    );
    const userYml = await Deno.readTextFile(userYmlPath!);
    const ltPattern = extractPattern(userYml, "layerType");
    assert(ltPattern, `layerType pattern not found in ${userYmlPath}`);

    const pattern = new RegExp(ltPattern);
    const allowed = extractPatternValues(ltPattern);
    const { c3: allC3 } = collectAllC2C3(registry);

    const missing = [...allC3].filter((v) => !pattern.test(v));
    assert(
      missing.length === 0,
      `Mismatch: ${registryPath} (steps + validationSteps) uses c3 values [${
        missing.join(", ")
      }] ` +
        `not in ${userYmlPath} layerType pattern [${allowed.join(", ")}]. ` +
        `IF you added a new step/validationStep to steps_registry.json, THEN add the c3 value to user.yml layerType.pattern. ` +
        `IF you intentionally narrowed user.yml, THEN remove the step from steps_registry.json.`,
    );
  });
}
