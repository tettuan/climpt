/**
 * Tests for {@link loadStepRegistry} (load path that was rewired in T5).
 *
 * Source of truth:
 *   - {@link loadStepRegistry} in ./loader.ts (direct Step construction;
 *     no on-disk shape translation per design 14 §B).
 *   - {@link srLegacyStepShapeRejected} (`SR-VALID-005`) from
 *     ../../shared/errors/config-errors.ts.
 *   - Framework-owned fixtures under ./_fixtures/{new,legacy}-shape/
 *     (NOT user-territory `.agent/<id>/` — that boundary is enforced by
 *     this test file's deliberate use of fixtures, not live agent dirs).
 *
 * Design refs:
 *   - agents/docs/design/realistic/14-step-registry.md §B/§C
 *     (Step ADT discriminator `kind`, nested C3LAddress aggregate).
 *
 * Test strategy:
 *   - End-to-end conformance: a new-shape fixture round-trips through the
 *     loader (read -> validateRegistryShape -> validateStepKindIntents ->
 *     validateEntryStepMapping -> validateIntentSchemaRef) without throw.
 *   - End-to-end rejection: the legacy fixture is rejected at load time
 *     with the canonical SR-VALID-005 code.
 *   - Diagnosability: failures surface fixture path + expected vs actual.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl } from "@std/path";

import { loadStepRegistry } from "./loader.ts";
import { ConfigError } from "../../shared/errors/config-errors.ts";

/** Canonical legacy-rejection code emitted by srLegacyStepShapeRejected. */
const LEGACY_REJECT_CODE = "SR-VALID-005";

/**
 * Resolve a fixture path absolutely. The loader takes a `registryPath` via
 * options; we hand it the on-disk path of the framework-owned fixture so
 * the load path is exercised end-to-end (Deno.readTextFile → JSON.parse →
 * validators). User-territory `.agent/<id>/` is intentionally not touched.
 */
function fixturePath(rel: string): string {
  return fromFileUrl(new URL(`./_fixtures/${rel}`, import.meta.url));
}

/**
 * Resolve the directory that holds a fixture's schema files. The new-shape
 * fixtures do not declare `outputSchemaRef` per step, so any directory works
 * for `validateIntentSchemaEnums` (it iterates only steps with
 * `outputSchemaRef`). The legacy fixture is rejected at shape validation
 * before enum validation runs. Both cases use the fixture's own directory
 * as a structurally valid `schemasDir` to satisfy the strict-variant
 * requirement (T29).
 */
function fixtureSchemasDir(rel: string): string {
  return dirname(fixturePath(rel));
}

/**
 * Build a diagnosable failure message in the form
 * `What / Where / How-to-fix` so a failing assertion explains itself.
 */
function diag(what: string, where: string, howToFix: string): string {
  return `What: ${what}\nWhere: ${where}\nHow to fix: ${howToFix}`;
}

// ---------------------------------------------------------------------------
// (1) End-to-end success: new-shape fixture loads cleanly through loader.
// ---------------------------------------------------------------------------

Deno.test("loadStepRegistry succeeds end-to-end on new-shape work-only fixture", async () => {
  const path = fixturePath("new-shape/work-only.json");

  // agentId must match the fixture's declared agentId (fixture-work).
  // Passing agentsDir as "" + an explicit registryPath bypasses the
  // default agentsDir/agentId/registry.json join — the loader uses
  // options.registryPath as-is.
  const registry = await loadStepRegistry("fixture-work", "", {
    registryPath: path,
    schemasDir: fixtureSchemasDir("new-shape/work-only.json"),
  });

  // Spot-check round-trip: agentId, c1, and step typing survive the load.
  assertEquals(
    registry.agentId,
    "fixture-work",
    diag(
      `loaded agentId mismatched fixture declaration`,
      `loadStepRegistry(fixture: ${path})`,
      "Confirm the fixture and the loader both agree on agentId='fixture-work'.",
    ),
  );

  assertEquals(
    registry.c1,
    "steps",
    diag(
      "loaded c1 differs from fixture declaration",
      `loadStepRegistry(fixture: ${path})`,
      "Fixture declares c1='steps'; loader must not rewrite this field.",
    ),
  );

  // The new ADT places C3L coordinates inside `address`. Confirm the
  // loader did not flatten them (which would indicate accidental
  // legacy-shape normalization re-entering the load path).
  const step = registry.steps["initial.issue"];
  assert(
    step !== undefined,
    diag(
      "loaded registry is missing step 'initial.issue'",
      `loadStepRegistry(fixture: ${path}).steps`,
      "Fixture declares steps['initial.issue']; loader must preserve the key.",
    ),
  );
  assertEquals(
    step.kind,
    "work",
    diag(
      `step.kind expected 'work', got ${JSON.stringify(step.kind)}`,
      `loadStepRegistry(fixture: ${path}).steps['initial.issue'].kind`,
      "New-shape fixture declares kind='work'; loader must preserve the discriminator.",
    ),
  );
  assertEquals(
    step.address.c2,
    "initial",
    diag(
      `step.address.c2 expected 'initial', got ${
        JSON.stringify(step.address.c2)
      }`,
      `loadStepRegistry(fixture: ${path}).steps['initial.issue'].address`,
      "C3L coordinates must be nested under address per design 14 §C.",
    ),
  );
  assertEquals(
    step.address.c3,
    "issue",
    diag(
      `step.address.c3 expected 'issue', got ${
        JSON.stringify(step.address.c3)
      }`,
      `loadStepRegistry(fixture: ${path}).steps['initial.issue'].address`,
      "C3L coordinates must be nested under address per design 14 §C.",
    ),
  );
});

// ---------------------------------------------------------------------------
// (2) End-to-end rejection: legacy fixture fails with SR-VALID-005.
// ---------------------------------------------------------------------------

Deno.test(
  "loadStepRegistry rejects legacy-shape fixture with SR-VALID-005",
  async () => {
    const path = fixturePath("legacy-shape/legacy-step.json");

    let caught: unknown = undefined;
    try {
      await loadStepRegistry("fixture-legacy", "", {
        registryPath: path,
        schemasDir: fixtureSchemasDir("legacy-shape/legacy-step.json"),
      });
    } catch (e) {
      caught = e;
    }

    assert(
      caught !== undefined,
      diag(
        "loadStepRegistry did not throw on legacy-shape fixture",
        `loadStepRegistry(fixture: ${path})`,
        "Legacy on-disk shape must be rejected at load time per design 14 §B (no normalization).",
      ),
    );
    assert(
      caught instanceof ConfigError,
      diag(
        `expected ConfigError, got ${
          caught === null ? "null" : typeof caught
        } (${(caught as { name?: string })?.name ?? "unknown"})`,
        "loadStepRegistry(legacy fixture)",
        "Route legacy rejection through srLegacyStepShapeRejected so a typed ConfigError reaches callers.",
      ),
    );

    const err = caught as ConfigError;
    assertEquals(
      err.code,
      LEGACY_REJECT_CODE,
      diag(
        `expected ${LEGACY_REJECT_CODE}, got ${err.code}`,
        "ConfigError.code from loadStepRegistry(legacy fixture)",
        "Loader must emit srLegacyStepShapeRejected (SR-VALID-005), not a downstream validator's code.",
      ),
    );

    // Diagnosability: the rejection message must name the legacy marker
    // `stepKind` so operators can locate the offending entry in their
    // own .agent/<id>/steps_registry.json.
    assertStringIncludes(
      err.message,
      "stepKind",
      diag(
        "rejection message does not mention legacy marker `stepKind`",
        "ConfigError.message from loadStepRegistry(legacy fixture)",
        "Surface the rejected field name (`stepKind`) in the diagnostic.",
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// (3) Non-vacuity: ensure the load path actually executed validators.
// ---------------------------------------------------------------------------

Deno.test(
  "loadStepRegistry on legacy fixture exercises the strict validator (non-vacuity)",
  async () => {
    // If the loader silently accepted the legacy fixture (e.g. because
    // validateRegistryShape were bypassed by a regression in loader.ts),
    // case (2) would NOT throw and the resulting registry would have
    // `kind` undefined on each step. This test is an explicit guard:
    // it asserts the legacy fixture's flat C3L sibling field names
    // surface in the diagnostic — that can only happen if the validator
    // walked the raw parsed JSON, proving the load path did not skip it.
    const path = fixturePath("legacy-shape/legacy-step.json");

    let caught: unknown = undefined;
    try {
      await loadStepRegistry("fixture-legacy", "", {
        registryPath: path,
        schemasDir: fixtureSchemasDir("legacy-shape/legacy-step.json"),
      });
    } catch (e) {
      caught = e;
    }

    assert(
      caught instanceof ConfigError,
      diag(
        "loader did not surface a ConfigError on legacy fixture",
        `loadStepRegistry(fixture: ${path})`,
        "Loader must invoke validateRegistryShape on the parsed raw JSON before any typed access.",
      ),
    );

    const message = (caught as ConfigError).message;
    // The legacy fixture declares flat siblings c2/c3/edition; the
    // validator must report each by name. If the loader had translated
    // them into a synthesized address before validating, these names
    // would not appear.
    for (const flatField of ["c2", "c3", "edition"] as const) {
      assertStringIncludes(
        message,
        flatField,
        diag(
          `diagnostic missing flat sibling \`${flatField}\` reference`,
          "ConfigError.message from loadStepRegistry(legacy fixture)",
          "Validator must inspect the raw parsed object — do not synthesize address before validating.",
        ),
      );
    }
  },
);

// ---------------------------------------------------------------------------
// (4) T29 / critique-5 B#2: strict-variant enum validation runs by default.
//
// Source of truth:
//   - RegistryLoaderStrictOptions in ./types.ts (schemasDir is required)
//   - validateIntentSchemaEnums in ./validator.ts (throws
//     srValidIntentSchemaEnumMismatch on mismatch / load failure)
//
// Test strategy:
//   - Build a registry whose only step references an `outputSchemaRef`
//     pointing at a file that does not exist on disk under the supplied
//     `schemasDir`. The strict-by-default loader must surface a load
//     failure as the canonical SR-VALID-006 enum-mismatch error — this
//     is the "loud failure" guarantee that B#2 demanded in place of the
//     pre-T29 silent skip.
// ---------------------------------------------------------------------------

Deno.test(
  "loadStepRegistry strict variant runs validateIntentSchemaEnums (loud failure on missing schema)",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const registryPath = `${tempDir}/registry.json`;
    const schemasDir = `${tempDir}/schemas`;
    // Note: we deliberately do NOT mkdir `schemasDir`. The strict variant
    // must still reach the enum validator, which will then error out on
    // the missing schema file. If the loader silently skipped enum
    // validation (the pre-T29 behavior), this test would not throw.
    const registry = {
      agentId: "t29-fixture",
      version: "1.0.0",
      c1: "steps",
      entryStep: "initial.issue",
      steps: {
        "initial.issue": {
          stepId: "initial.issue",
          kind: "work",
          address: {
            c1: "steps",
            c2: "initial",
            c3: "issue",
            edition: "default",
          },
          name: "T29 fixture step",
          uvVariables: [],
          usesStdin: false,
          structuredGate: {
            allowedIntents: ["next", "repeat"],
            intentSchemaRef: "#/properties/next_action/properties/action",
            intentField: "next_action.action",
          },
          outputSchemaRef: {
            file: "missing.schema.json",
            schema: "Root",
          },
          transitions: {
            next: { target: null },
            repeat: { target: "initial.issue" },
          },
        },
      },
    };
    await Deno.writeTextFile(registryPath, JSON.stringify(registry));

    try {
      let caught: unknown = undefined;
      try {
        await loadStepRegistry("t29-fixture", "", {
          registryPath,
          schemasDir,
        });
      } catch (e) {
        caught = e;
      }

      assert(
        caught instanceof ConfigError,
        diag(
          `expected ConfigError from strict enum validator, got ${
            caught === undefined
              ? "undefined (loader silently skipped enum validation)"
              : typeof caught
          }`,
          "loadStepRegistry(strict variant, missing schema file)",
          "Strict-by-default loader must invoke validateIntentSchemaEnums; if it skips, the (validateIntentEnums:true, schemasDir:absent) silent-skip cell has resurfaced.",
        ),
      );
      assertEquals(
        (caught as ConfigError).code,
        "SR-VALID-003",
        diag(
          `expected SR-VALID-003, got ${(caught as ConfigError).code}`,
          "ConfigError.code from strict-variant enum validator",
          "validateIntentSchemaEnums must emit srValidIntentSchemaEnumMismatch (SR-VALID-003) on schema load failure.",
        ),
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// (5) T29 / critique-5 B#2: opt-out variant remains legitimate.
//
// Source of truth:
//   - RegistryLoaderOptOutOptions in ./types.ts (validateIntentEnums:false)
//   - closure-manager.ts:99 production caller (only legitimate opt-out site)
//
// Test strategy:
//   - The same fixture as case (4), but loaded with
//     `validateIntentEnums:false`. The loader MUST NOT invoke
//     `validateIntentSchemaEnums`, so the missing schema file no longer
//     blocks the load. This pins the closure-manager opt-out path against
//     accidental removal during future strict-mode hardening.
// ---------------------------------------------------------------------------

Deno.test(
  "loadStepRegistry opt-out variant skips enum validation (closure-manager path)",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const registryPath = `${tempDir}/registry.json`;
    const registry = {
      agentId: "t29-optout",
      version: "1.0.0",
      c1: "steps",
      entryStep: "initial.issue",
      steps: {
        "initial.issue": {
          stepId: "initial.issue",
          kind: "work",
          address: {
            c1: "steps",
            c2: "initial",
            c3: "issue",
            edition: "default",
          },
          name: "T29 opt-out fixture",
          uvVariables: [],
          usesStdin: false,
          structuredGate: {
            allowedIntents: ["next", "repeat"],
            intentSchemaRef: "#/properties/next_action/properties/action",
            intentField: "next_action.action",
          },
          outputSchemaRef: {
            file: "missing.schema.json",
            schema: "Root",
          },
          transitions: {
            next: { target: null },
            repeat: { target: "initial.issue" },
          },
        },
      },
    };
    await Deno.writeTextFile(registryPath, JSON.stringify(registry));

    try {
      // The opt-out variant compiles without `schemasDir`. If the loader
      // were to run enum validation regardless of the discriminator, the
      // missing schema file would throw — exactly as it does in case (4).
      const loaded = await loadStepRegistry("t29-optout", "", {
        registryPath,
        validateIntentEnums: false,
      });

      assertEquals(
        loaded.agentId,
        "t29-optout",
        diag(
          "opt-out load did not return the expected registry",
          "loadStepRegistry(opt-out variant)",
          "validateIntentEnums:false must short-circuit enum validation; closure-manager runs it post-load with a cwd-resolved schemasDir.",
        ),
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// (6) T38 / critique-6 N#5: SR-LOAD-003 swallow centralized in loader.
//
// Source of truth:
//   - RegistryLoaderOptions.allowMissing in ./types.ts (default `false`).
//   - loadStepRegistry catch block in ./loader.ts (single owner of the
//     "registry file absent on disk" policy).
//   - createEmptyRegistry in ./utils.ts (the empty-registry shape returned
//     when `allowMissing: true`).
//
// Three test cases pin the contract:
//   (6a) Default policy (no `allowMissing`): missing file => loud throw
//        ConfigError(SR-LOAD-003). This guards the verdict/factory.ts
//        detect:graph caller, which relies on the loud throw to remap to
//        AC-VERDICT-011.
//   (6b) Opt-in (`allowMissing: true`): missing file => empty registry
//        whose `agentId` matches the caller's expectation. This guards
//        the three opt-in callers (builder.ts, agent-bundle-loader.ts,
//        verdict/factory.ts createRegistryVerdictHandler).
//   (6c) Opt-in does NOT swallow other validation errors. With
//        `allowMissing: true` and a malformed-but-present registry, the
//        loader still throws SR-VALID-005 (or whichever validator code
//        applies). The opt-in switch is scoped to the not-found case
//        only — never a blanket swallow.
// ---------------------------------------------------------------------------

Deno.test(
  "loadStepRegistry default policy throws SR-LOAD-003 when registry file is absent",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const missingPath = `${tempDir}/does-not-exist.json`;
    const schemasDir = tempDir; // any extant dir; loader never reads schemas
    // for the not-found path because it short-circuits before validators.

    try {
      let caught: unknown = undefined;
      try {
        await loadStepRegistry("t38-default", "", {
          registryPath: missingPath,
          schemasDir,
        });
      } catch (e) {
        caught = e;
      }

      assert(
        caught instanceof ConfigError,
        diag(
          `expected ConfigError, got ${
            caught === undefined
              ? "undefined (loader silently swallowed)"
              : typeof caught
          }`,
          "loadStepRegistry(default policy, missing file)",
          "Default `allowMissing` is `false`; the loader must throw a typed ConfigError when the registry file is absent.",
        ),
      );
      assertEquals(
        (caught as ConfigError).code,
        "SR-LOAD-003",
        diag(
          `expected SR-LOAD-003, got ${(caught as ConfigError).code}`,
          "ConfigError.code from default-policy missing-file load",
          "Loader must wrap Deno.errors.NotFound as srLoadNotFound (SR-LOAD-003) so callers (verdict/factory.ts:detect:graph) can pattern-match the code and remap to AC-VERDICT-011.",
        ),
      );
      assertStringIncludes(
        (caught as ConfigError).message,
        missingPath,
        diag(
          "diagnostic missing the offending registry path",
          "ConfigError.message from default-policy missing-file load",
          "Surface the registryPath in the message so operators can locate the missing file.",
        ),
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStepRegistry allowMissing:true returns an empty registry when file is absent",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const missingPath = `${tempDir}/does-not-exist.json`;
    const schemasDir = tempDir;

    try {
      const registry = await loadStepRegistry("t38-optin", "", {
        registryPath: missingPath,
        schemasDir,
        allowMissing: true,
      });

      assertEquals(
        registry.agentId,
        "t38-optin",
        diag(
          `empty-registry agentId mismatched caller's expectation: got ${registry.agentId}`,
          "loadStepRegistry(allowMissing:true, missing file).agentId",
          "createEmptyRegistry must adopt the caller-supplied agentId so downstream PromptResolver consumers see the right identity.",
        ),
      );
      assertEquals(
        registry.c1,
        "steps",
        diag(
          `empty-registry c1 differs from createEmptyRegistry default: got ${registry.c1}`,
          "loadStepRegistry(allowMissing:true).c1",
          "createEmptyRegistry default `c1='steps'` is required so PromptResolver can use it as configSuffix.",
        ),
      );
      assertEquals(
        Object.keys(registry.steps).length,
        0,
        diag(
          `empty-registry has unexpected steps: ${
            JSON.stringify(registry.steps)
          }`,
          "loadStepRegistry(allowMissing:true).steps",
          'Empty registry must have an empty steps map so loadTypedSteps\' projection collapses to { steps: [], entryStep: "" }.',
        ),
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStepRegistry allowMissing:true does NOT swallow validation errors (SR-VALID-*)",
  async () => {
    // The fixture is a malformed (legacy-shape) registry that exists on
    // disk. `allowMissing` is opt-in only for the not-found path; a
    // present-but-malformed file must still loud-throw SR-VALID-005.
    const path = fixturePath("legacy-shape/legacy-step.json");

    let caught: unknown = undefined;
    try {
      await loadStepRegistry("fixture-legacy", "", {
        registryPath: path,
        schemasDir: fixtureSchemasDir("legacy-shape/legacy-step.json"),
        allowMissing: true,
      });
    } catch (e) {
      caught = e;
    }

    assert(
      caught instanceof ConfigError,
      diag(
        `expected ConfigError(SR-VALID-005), got ${
          caught === undefined
            ? "undefined (allowMissing leaked into present-but-malformed path)"
            : typeof caught
        }`,
        "loadStepRegistry(allowMissing:true, legacy-shape fixture)",
        "allowMissing must scope to the not-found case only; SR-VALID-* / SR-LOAD-002 / SR-INTENT-* MUST still propagate.",
      ),
    );
    assertEquals(
      (caught as ConfigError).code,
      LEGACY_REJECT_CODE,
      diag(
        `expected ${LEGACY_REJECT_CODE}, got ${(caught as ConfigError).code}`,
        "ConfigError.code from allowMissing+legacy load",
        "Validator codes must propagate through allowMissing; the opt-in is for SR-LOAD-003 only.",
      ),
    );
  },
);
