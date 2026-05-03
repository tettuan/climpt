/**
 * Tests for agents/config/settings-loader.ts
 *
 * Coverage (per impl-plan.md Section E):
 *  1. per-agent file present -> per-agent wins over shared
 *  2. per-agent missing, shared present -> shared is used
 *  3. both missing -> AC-LOAD-001 (acLoadNotFound)
 *  4. chosen file has syntactically invalid JSON -> AC-LOAD-002 (acLoadParseFailed)
 *  5. parsed JSON lacks "permissions" -> AC-LOAD-003 (acLoadInvalid)
 *  6. permissions.defaultMode not in SDK enum -> AC-LOAD-003 (acLoadInvalid)
 *  7. identity: loaded object equals parsed JSON (no silent mutation)
 *
 * Test code language: English (per .claude/rules/test-design.md).
 * Expected values derived from source-of-truth constants where possible.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  loadAgentSettings,
  type LoadedAgentSettings,
  resolveSettingsPaths,
  SETTINGS_CONFIG_DIR,
} from "./settings-loader.ts";
import { ConfigError } from "../shared/errors/config-errors.ts";

// ---------------------------------------------------------------------------
// Source of truth references (for non-vacuous expected values and messages)
// ---------------------------------------------------------------------------

/** Source filename used in failure messages (P4: "Where"). */
const SRC = "settings-loader.ts";

/** Agent name used across fixtures. Arbitrary but stable. */
const AGENT_NAME = "iterator";

/** Error codes emitted by the loader, matching shared/errors/config-errors.ts. */
const CODE_NOT_FOUND = "AC-LOAD-001";
const CODE_PARSE_FAILED = "AC-LOAD-002";
const CODE_INVALID = "AC-LOAD-003";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Create a writable mock repo root with the SETTINGS_CONFIG_DIR present.
 * Returns the absolute cwd to pass into loadAgentSettings().
 */
async function makeRepoRoot(): Promise<string> {
  const cwd = await Deno.makeTempDir();
  await Deno.mkdir(join(cwd, SETTINGS_CONFIG_DIR), { recursive: true });
  return cwd;
}

/** Write a JSON object (pretty-printed) to the given path. */
async function writeJson(path: string, value: unknown): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2));
}

/** Minimal valid settings payload tagged with an identifying marker. */
function validSettings(marker: string): Record<string, unknown> {
  return {
    permissions: {
      allow: ["Read", "Glob", "Grep"],
      defaultMode: "default",
    },
    // `env` is part of the SDK Settings surface; used purely as an identity
    // marker to distinguish per-agent vs shared payloads.
    env: { SETTINGS_ORIGIN: marker },
  };
}

// ===========================================================================
// Case 1: per-agent file wins when both files are present
// ===========================================================================

Deno.test("settings-loader - per-agent file wins over shared fallback", async () => {
  const cwd = await makeRepoRoot();
  try {
    const { perAgent, shared } = resolveSettingsPaths(AGENT_NAME, cwd);
    await writeJson(perAgent, validSettings("per-agent"));
    await writeJson(shared, validSettings("shared"));

    const result = await loadAgentSettings(AGENT_NAME, cwd);

    assertEquals(
      result.sourcePath,
      perAgent,
      `Expected sourcePath to equal per-agent path.\n` +
        `  Where: ${SRC} loadAgentSettings lookup order\n` +
        `  Fix: ensure per-agent path is probed before shared fallback.`,
    );

    // Cross-check via identity marker so a path-only regression would fail too.
    const env = (result.settings as { env?: Record<string, string> }).env;
    assertEquals(
      env?.SETTINGS_ORIGIN,
      "per-agent",
      `Expected loaded payload to originate from per-agent file.\n` +
        `  Where: ${SRC}\n` +
        `  Fix: loadAgentSettings must read from the first matched file.`,
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// ===========================================================================
// Case 2: shared fallback used when per-agent file is missing
// ===========================================================================

Deno.test("settings-loader - shared fallback used when per-agent is missing", async () => {
  const cwd = await makeRepoRoot();
  try {
    const { perAgent, shared } = resolveSettingsPaths(AGENT_NAME, cwd);
    await writeJson(shared, validSettings("shared"));

    // Non-vacuity guard: ensure we really are testing the fallback path.
    await assertFileMissing(perAgent);

    const result = await loadAgentSettings(AGENT_NAME, cwd);

    assertEquals(
      result.sourcePath,
      shared,
      `Expected sourcePath to equal shared fallback path.\n` +
        `  Where: ${SRC} loadAgentSettings fallback branch\n` +
        `  Fix: ensure shared path is returned when per-agent is absent.`,
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// ===========================================================================
// Case 3: both files missing -> AC-LOAD-001
// ===========================================================================

Deno.test("settings-loader - both files missing throws AC-LOAD-001", async () => {
  const cwd = await makeRepoRoot();
  try {
    const { perAgent, shared } = resolveSettingsPaths(AGENT_NAME, cwd);
    await assertFileMissing(perAgent);
    await assertFileMissing(shared);

    const error = (await assertRejects(
      () => loadAgentSettings(AGENT_NAME, cwd),
      ConfigError,
    )) as ConfigError;

    assertEquals(
      error.code,
      CODE_NOT_FOUND,
      `Expected error.code ${CODE_NOT_FOUND}, got ${error.code}.\n` +
        `  Where: ${SRC} loadAgentSettings (neither path resolved)\n` +
        `  Fix: throw acLoadNotFound(shared) when both files are absent.`,
    );
    assert(
      error.message.includes(shared),
      `Expected error message to reference the shared fallback path.\n` +
        `  Where: ${SRC}\n` +
        `  Expected substring: ${shared}\n` +
        `  Got: ${error.message}\n` +
        `  Fix: pass the shared fallback path into acLoadNotFound().`,
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// ===========================================================================
// Case 4: invalid JSON syntax -> AC-LOAD-002
// ===========================================================================

Deno.test("settings-loader - invalid JSON throws AC-LOAD-002", async () => {
  const cwd = await makeRepoRoot();
  try {
    const { perAgent } = resolveSettingsPaths(AGENT_NAME, cwd);
    await Deno.writeTextFile(perAgent, "{ not valid json!!!");

    const error = (await assertRejects(
      () => loadAgentSettings(AGENT_NAME, cwd),
      ConfigError,
    )) as ConfigError;

    assertEquals(
      error.code,
      CODE_PARSE_FAILED,
      `Expected error.code ${CODE_PARSE_FAILED}, got ${error.code}.\n` +
        `  Where: ${SRC} JSON.parse() branch\n` +
        `  Fix: map JSON.parse SyntaxError to acLoadParseFailed().`,
    );
    assert(
      error.message.includes(perAgent),
      `Expected error message to include the offending file path.\n` +
        `  Where: ${SRC}\n` +
        `  Expected substring: ${perAgent}\n` +
        `  Got: ${error.message}`,
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// ===========================================================================
// Case 5: missing "permissions" -> AC-LOAD-003
// ===========================================================================

Deno.test("settings-loader - missing permissions throws AC-LOAD-003", async () => {
  const cwd = await makeRepoRoot();
  try {
    const { perAgent } = resolveSettingsPaths(AGENT_NAME, cwd);
    // Valid JSON object but no "permissions" key at all.
    await writeJson(perAgent, { $schema: "https://example.invalid/x" });

    const error = (await assertRejects(
      () => loadAgentSettings(AGENT_NAME, cwd),
      ConfigError,
    )) as ConfigError;

    assertEquals(
      error.code,
      CODE_INVALID,
      `Expected error.code ${CODE_INVALID}, got ${error.code}.\n` +
        `  Where: ${SRC} validateSettings() permissions-present check\n` +
        `  Fix: throw acLoadInvalid() when "permissions" is absent.`,
    );
    assert(
      error.message.toLowerCase().includes("permissions"),
      `Expected error message to mention "permissions".\n` +
        `  Where: ${SRC}\n` +
        `  Got: ${error.message}`,
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// ===========================================================================
// Case 6: defaultMode not in SDK enum -> AC-LOAD-003
// ===========================================================================

Deno.test("settings-loader - invalid defaultMode throws AC-LOAD-003", async () => {
  const cwd = await makeRepoRoot();
  try {
    const { perAgent } = resolveSettingsPaths(AGENT_NAME, cwd);
    await writeJson(perAgent, {
      permissions: {
        allow: ["Read"],
        // Not a member of the SDK's defaultMode enum.
        defaultMode: "nonsense-mode",
      },
    });

    const error = (await assertRejects(
      () => loadAgentSettings(AGENT_NAME, cwd),
      ConfigError,
    )) as ConfigError;

    assertEquals(
      error.code,
      CODE_INVALID,
      `Expected error.code ${CODE_INVALID}, got ${error.code}.\n` +
        `  Where: ${SRC} validateSettings() defaultMode enum check\n` +
        `  Fix: throw acLoadInvalid() when defaultMode is outside the SDK enum.`,
    );
    assert(
      error.message.includes("defaultMode"),
      `Expected error message to mention "defaultMode".\n` +
        `  Where: ${SRC}\n` +
        `  Got: ${error.message}`,
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// ===========================================================================
// Case 7: identity — loaded settings object matches the parsed JSON
// ===========================================================================

Deno.test("settings-loader - returned settings match parsed JSON verbatim", async () => {
  const cwd = await makeRepoRoot();
  try {
    const { perAgent } = resolveSettingsPaths(AGENT_NAME, cwd);
    const payload = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      permissions: {
        allow: ["Skill", "Read", "Write", "Edit", "Bash"],
        defaultMode: "acceptEdits",
      },
    };
    await writeJson(perAgent, payload);

    const result: LoadedAgentSettings = await loadAgentSettings(
      AGENT_NAME,
      cwd,
    );

    // Deep-equality on structure: loader must not mutate, strip, or inject.
    assertEquals(
      JSON.parse(JSON.stringify(result.settings)),
      payload,
      `Loaded settings must equal the parsed JSON payload exactly.\n` +
        `  Where: ${SRC} loadAgentSettings return value\n` +
        `  Fix: do not mutate or re-shape the parsed object.`,
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Assert that the path does NOT exist on disk. Guards against false-positive
 * fallback tests that accidentally have a stale per-agent file present.
 */
async function assertFileMissing(path: string): Promise<void> {
  try {
    await Deno.stat(path);
    throw new Error(
      `Fixture precondition failed: expected ${path} to be absent.\n` +
        `  Fix: remove or do not create this path in the test setup.`,
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
