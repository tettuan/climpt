/**
 * Negative Agent Load Contract Test
 *
 * Validates that the configuration loader rejects invalid inputs
 * with proper error types, without any LLM calls.
 *
 * Scenario 1: Non-existent agent path -> ConfigError (AC-SERVICE-001)
 * Scenario 2: Broken JSON -> ConfigError (AC-SERVICE-002)
 * Scenario 3: Missing required field (runner) -> validation error
 */

import { join, resolve } from "@std/path";
import { ConfigError } from "../../../agents/shared/errors/config-errors.ts";
import { loadRaw } from "../../../agents/config/loader.ts";
import { validate } from "../../../agents/config/mod.ts";
import type { AgentDefinition } from "../../../agents/src_common/types.ts";

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

const repoRoot = resolve(import.meta.dirname ?? ".", "../../../");
const tmpDir = join(
  Deno.env.get("TMPDIR") ?? "/private/tmp/claude-502",
  "29-negative-load-test",
);

let passed = 0;
let failed = 0;

// Setup: create temp directory for test fixtures
try {
  await Deno.mkdir(tmpDir, { recursive: true });
} catch {
  // already exists
}

// --- Scenario 1: Non-existent agent path ---

log("Scenario 1: Non-existent agent path");
{
  const fakePath = join(repoRoot, ".agent", "nonexistent-agent-xyz-999");
  try {
    await loadRaw(fakePath);
    logErr("  FAIL: expected ConfigError but loadRaw succeeded");
    failed++;
  } catch (err) {
    if (err instanceof ConfigError && err.code === "AC-SERVICE-001") {
      log(`  PASS: ConfigError thrown for non-existent path`);
      log(`    code: ${err.code}`);
      passed++;
    } else {
      logErr(
        `  FAIL: expected ConfigError(AC-SERVICE-001), got ${
          (err as Error).constructor.name
        }: ${(err as Error).message}`,
      );
      failed++;
    }
  }
}

// --- Scenario 2: Broken JSON ---

log("Scenario 2: Broken JSON");
{
  const brokenDir = join(tmpDir, "broken-agent");
  try {
    await Deno.mkdir(brokenDir, { recursive: true });
  } catch {
    // already exists
  }
  await Deno.writeTextFile(
    join(brokenDir, "agent.json"),
    '{ "name": "broken", invalid json !!!',
  );

  try {
    await loadRaw(brokenDir);
    logErr("  FAIL: expected ConfigError but loadRaw succeeded");
    failed++;
  } catch (err) {
    if (err instanceof ConfigError && err.code === "AC-SERVICE-002") {
      log(`  PASS: ConfigError thrown for broken JSON`);
      log(`    code: ${err.code}`);
      passed++;
    } else {
      logErr(
        `  FAIL: expected ConfigError(AC-SERVICE-002), got ${
          (err as Error).constructor.name
        }: ${(err as Error).message}`,
      );
      failed++;
    }
  }
}

// --- Scenario 3: Missing required field (runner) ---

log("Scenario 3: Missing required field (runner)");
{
  // Create a valid JSON that is missing the required "runner" field
  const incompleteDefinition = {
    version: "1.0.0",
    name: "test-incomplete",
    displayName: "Test Incomplete",
    description: "Agent missing runner field",
    parameters: {},
    // runner is intentionally omitted
  };

  const result = validate(incompleteDefinition as unknown as AgentDefinition);
  if (!result.valid && result.errors.some((e) => e.includes("runner"))) {
    log(`  PASS: validation rejects missing runner field`);
    log(`    errors: ${result.errors.join("; ")}`);
    passed++;
  } else if (result.valid) {
    logErr("  FAIL: validation accepted definition without runner field");
    failed++;
  } else {
    logErr(
      `  FAIL: validation failed but no runner-related error found: ${
        result.errors.join("; ")
      }`,
    );
    failed++;
  }
}

// --- Cleanup ---

try {
  await Deno.remove(tmpDir, { recursive: true });
} catch {
  // cleanup is best-effort
}

log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) Deno.exit(1);
