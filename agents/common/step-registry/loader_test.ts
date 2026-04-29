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
import { fromFileUrl } from "@std/path";

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
      await loadStepRegistry("fixture-legacy", "", { registryPath: path });
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
      await loadStepRegistry("fixture-legacy", "", { registryPath: path });
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
