/**
 * Tests for agents/config/config-registry-validator.ts
 *
 * Validates that validateConfigRegistryConsistency() correctly detects:
 * - Missing app.yml / user.yml config files
 * - c2 values not matching directiveType pattern
 * - c3 values not matching layerType pattern
 * - Valid configs passing without errors
 *
 * Uses temp directories with synthetic fixtures to isolate from real configs.
 * Integration tests at the bottom validate against live agent configs.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  MSG_C2_MISMATCH,
  MSG_C3_MISMATCH,
  MSG_MISSING_APP_YML,
  MSG_MISSING_USER_YML,
  MSG_NO_DIRECTIVE_PATTERN,
  MSG_NO_LAYER_PATTERN,
  validateConfigRegistryConsistency,
} from "./config-registry-validator.ts";

// =============================================================================
// Fixtures
// =============================================================================

/** Build a minimal registry with configurable steps. */
function makeRegistry(
  overrides?: Partial<{
    agentId: string;
    c1: string;
    steps: Record<string, Record<string, unknown>>;
    validationSteps: Record<string, Record<string, unknown>>;
  }>,
): Record<string, unknown> {
  return {
    agentId: overrides?.agentId ?? "test",
    version: "1.0.0",
    c1: overrides?.c1 ?? "steps",
    steps: overrides?.steps ?? {
      "initial.issue": {
        stepId: "initial.issue",
        c2: "initial",
        c3: "issue",
      },
      "continuation.issue": {
        stepId: "continuation.issue",
        c2: "continuation",
        c3: "issue",
      },
    },
    validationSteps: overrides?.validationSteps ?? {},
  };
}

/** Standard user.yml content that accepts initial/continuation and issue. */
const VALID_USER_YML = `# Test user config
params:
  two:
    directiveType:
      pattern: "^(initial|continuation|closure)$"
    layerType:
      pattern: "^(issue|project)$"
`;

/**
 * Scaffold a temp directory with app.yml and user.yml for the given config name.
 */
async function scaffoldConfig(
  configDir: string,
  configName: string,
  opts?: { userYml?: string; skipApp?: boolean; skipUser?: boolean },
): Promise<void> {
  await Deno.mkdir(configDir, { recursive: true });

  if (!opts?.skipApp) {
    await Deno.writeTextFile(
      join(configDir, `${configName}-app.yml`),
      '# app config\nworking_dir: ".agent/test"\n',
    );
  }

  if (!opts?.skipUser) {
    await Deno.writeTextFile(
      join(configDir, `${configName}-user.yml`),
      opts?.userYml ?? VALID_USER_YML,
    );
  }
}

// =============================================================================
// Valid data - all c2/c3 values matching
// =============================================================================

Deno.test("config-registry-validator - matching c2/c3 values produce no errors", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    await scaffoldConfig(configDir, "test-steps");

    const registry = makeRegistry();
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true, got errors: ${JSON.stringify(result.errors)}`,
    );
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("config-registry-validator - all c2/c3 from steps and validationSteps matching", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    await scaffoldConfig(configDir, "test-steps");

    const registry = makeRegistry({
      steps: {
        "initial.issue": {
          stepId: "initial.issue",
          c2: "initial",
          c3: "issue",
        },
        "closure.project": {
          stepId: "closure.project",
          c2: "closure",
          c3: "project",
        },
      },
      validationSteps: {
        "continuation.issue": {
          stepId: "continuation.issue",
          c2: "continuation",
          c3: "issue",
        },
      },
    });
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true, got errors: ${JSON.stringify(result.errors)}`,
    );
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Missing config files
// =============================================================================

Deno.test("config-registry-validator - missing app.yml reports ERROR", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    await scaffoldConfig(configDir, "test-steps", { skipApp: true });

    const registry = makeRegistry();
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(result.valid, false);
    const appError = result.errors.find((e) => e.includes(MSG_MISSING_APP_YML));
    assertEquals(
      appError !== undefined,
      true,
      `Expected error containing "${MSG_MISSING_APP_YML}", got: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("config-registry-validator - missing user.yml reports ERROR", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    await scaffoldConfig(configDir, "test-steps", { skipUser: true });

    const registry = makeRegistry();
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(result.valid, false);
    const userError = result.errors.find((e) =>
      e.includes(MSG_MISSING_USER_YML)
    );
    assertEquals(
      userError !== undefined,
      true,
      `Expected error containing "${MSG_MISSING_USER_YML}", got: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// c2 not matching directiveType pattern
// =============================================================================

Deno.test("config-registry-validator - c2 not matching directiveType pattern reports ERROR", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    await scaffoldConfig(configDir, "test-steps");

    const registry = makeRegistry({
      steps: {
        "unknown.issue": {
          stepId: "unknown.issue",
          c2: "nonexistent-phase",
          c3: "issue",
        },
      },
    });
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(result.valid, false);
    const c2Error = result.errors.find((e) => e.includes(MSG_C2_MISMATCH));
    assertEquals(
      c2Error !== undefined,
      true,
      `Expected error containing "${MSG_C2_MISMATCH}", got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      c2Error!.includes("nonexistent-phase"),
      true,
      `Expected error to mention the bad c2 value "nonexistent-phase", got: ${c2Error}`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// c3 not matching layerType pattern
// =============================================================================

Deno.test("config-registry-validator - c3 not matching layerType pattern reports ERROR", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    await scaffoldConfig(configDir, "test-steps");

    const registry = makeRegistry({
      steps: {
        "initial.unknown": {
          stepId: "initial.unknown",
          c2: "initial",
          c3: "nonexistent-layer",
        },
      },
    });
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(result.valid, false);
    const c3Error = result.errors.find((e) => e.includes(MSG_C3_MISMATCH));
    assertEquals(
      c3Error !== undefined,
      true,
      `Expected error containing "${MSG_C3_MISMATCH}", got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      c3Error!.includes("nonexistent-layer"),
      true,
      `Expected error to mention the bad c3 value "nonexistent-layer", got: ${c3Error}`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Edge cases
// =============================================================================

Deno.test("config-registry-validator - registry without agentId skips with warning", async () => {
  const registry: Record<string, unknown> = {
    version: "1.0.0",
    c1: "steps",
    steps: {},
  };

  // configDir can be anything since the check is skipped
  const result = await validateConfigRegistryConsistency(
    registry,
    "/nonexistent",
  );

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length > 0,
    true,
    "Expected a skip warning when agentId is missing",
  );
});

Deno.test("config-registry-validator - registry without c1 skips with warning", async () => {
  const registry: Record<string, unknown> = {
    agentId: "test",
    version: "1.0.0",
    steps: {},
  };

  const result = await validateConfigRegistryConsistency(
    registry,
    "/nonexistent",
  );

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length > 0,
    true,
    "Expected a skip warning when c1 is missing",
  );
});

Deno.test("config-registry-validator - user.yml without directiveType pattern reports ERROR", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    const badUserYml = `# Missing directiveType
params:
  two:
    layerType:
      pattern: "^(issue)$"
`;
    await scaffoldConfig(configDir, "test-steps", { userYml: badUserYml });

    const registry = makeRegistry();
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(result.valid, false);
    const patternError = result.errors.find((e) =>
      e.includes(MSG_NO_DIRECTIVE_PATTERN)
    );
    assertEquals(
      patternError !== undefined,
      true,
      `Expected error containing "${MSG_NO_DIRECTIVE_PATTERN}", got: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("config-registry-validator - user.yml without layerType pattern reports ERROR", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    const badUserYml = `# Missing layerType
params:
  two:
    directiveType:
      pattern: "^(initial)$"
`;
    await scaffoldConfig(configDir, "test-steps", { userYml: badUserYml });

    const registry = makeRegistry();
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(result.valid, false);
    const patternError = result.errors.find((e) =>
      e.includes(MSG_NO_LAYER_PATTERN)
    );
    assertEquals(
      patternError !== undefined,
      true,
      `Expected error containing "${MSG_NO_LAYER_PATTERN}", got: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("config-registry-validator - validationSteps c2 mismatch detected", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    await scaffoldConfig(configDir, "test-steps");

    const registry = makeRegistry({
      validationSteps: {
        "badphase.issue": {
          stepId: "badphase.issue",
          c2: "badphase",
          c3: "issue",
        },
      },
    });
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(result.valid, false);
    const vsError = result.errors.find((e) =>
      e.includes("validationSteps") && e.includes(MSG_C2_MISMATCH)
    );
    assertEquals(
      vsError !== undefined,
      true,
      `Expected validationSteps c2 mismatch error, got: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("config-registry-validator - step without c2/c3 fields is skipped gracefully", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const configDir = join(tempDir, "config");
    await scaffoldConfig(configDir, "test-steps");

    const registry = makeRegistry({
      steps: {
        "no-c2-c3": { stepId: "no-c2-c3" },
      },
    });
    const result = await validateConfigRegistryConsistency(registry, configDir);

    assertEquals(
      result.valid,
      true,
      `Expected valid=true for step without c2/c3, got errors: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Integration tests - live agent configs
// =============================================================================

const LIVE_AGENTS = ["iterator", "reviewer", "facilitator"] as const;
const LIVE_CONFIG_DIR = ".agent/climpt/config";

for (const agent of LIVE_AGENTS) {
  Deno.test(`config-registry-validator/integration - ${agent} registry consistent with yml configs`, async () => {
    const registryText = await Deno.readTextFile(
      `.agent/${agent}/steps_registry.json`,
    );
    const registry = JSON.parse(registryText) as Record<string, unknown>;

    const result = await validateConfigRegistryConsistency(
      registry,
      LIVE_CONFIG_DIR,
    );

    assertEquals(
      result.valid,
      true,
      `Config-registry consistency errors for ${agent}: ${
        JSON.stringify(result.errors)
      }`,
    );
  });
}
