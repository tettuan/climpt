/**
 * Tests for the strict step-shape validator.
 *
 * Source of truth:
 *   - {@link validateRegistryShape} / {@link validateStepShape}
 *     in ./validator.ts (no-shim policy: legacy shape MUST be rejected).
 *   - {@link srLegacyStepShapeRejected} (`SR-VALID-005`) from
 *     ../../shared/errors/config-errors.ts.
 *
 * Design refs:
 *   - agents/docs/design/realistic/14-step-registry.md §B/§C
 *     (Step ADT discriminator `kind`, nested C3LAddress aggregate).
 *
 * Test strategy:
 *   - Fixture-driven conformance: each new-shape fixture must pass; the
 *     legacy fixture must be rejected with the canonical error code.
 *   - Per-condition unit checks via inline objects exercise individual
 *     reject conditions in `validateStepShape`.
 *   - Non-vacuity: assert that the validator actually walked at least one
 *     step entry, so a silently-empty path cannot pass these tests.
 *   - Diagnosability: failures report what was expected vs received.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  validateRegistryShape,
  validateStepKindIntents,
  validateStepRegistry,
  validateStepShape,
} from "./validator.ts";
import { ConfigError } from "../../shared/errors/config-errors.ts";
import type { StepRegistry } from "./types.ts";

import workFixture from "./_fixtures/new-shape/work-only.json" with {
  type: "json",
};
import verificationFixture from "./_fixtures/new-shape/verification-only.json" with {
  type: "json",
};
import closureFixture from "./_fixtures/new-shape/closure-only.json" with {
  type: "json",
};
import legacyFixture from "./_fixtures/legacy-shape/legacy-step.json" with {
  type: "json",
};

/**
 * Canonical error code emitted by `srLegacyStepShapeRejected`.
 * Sourced from validator.ts JSDoc and config-errors.ts.
 */
const LEGACY_REJECT_CODE = "SR-VALID-005";

/**
 * Build a diagnosable failure message in the form
 * `What / Where / How-to-fix` so a failing assertion explains itself.
 */
function diag(
  what: string,
  where: string,
  howToFix: string,
): string {
  return `What: ${what}\nWhere: ${where}\nHow to fix: ${howToFix}`;
}

// ---------------------------------------------------------------------------
// (1) Each new-shape fixture must pass.
// ---------------------------------------------------------------------------

Deno.test("validateRegistryShape accepts work-only new-shape fixture", () => {
  // Should not throw.
  validateRegistryShape(workFixture);
});

Deno.test("validateRegistryShape accepts verification-only new-shape fixture", () => {
  validateRegistryShape(verificationFixture);
});

Deno.test("validateRegistryShape accepts closure-only new-shape fixture", () => {
  validateRegistryShape(closureFixture);
});

// ---------------------------------------------------------------------------
// (2) Legacy fixture must be rejected with SR-VALID-005 referencing stepKind.
// ---------------------------------------------------------------------------

Deno.test("validateRegistryShape rejects legacy fixture with SR-VALID-005", () => {
  let caught: unknown = undefined;
  try {
    validateRegistryShape(legacyFixture);
  } catch (e) {
    caught = e;
  }

  assert(
    caught !== undefined,
    diag(
      "validateRegistryShape did not throw on legacy fixture",
      "agents/common/step-registry/_fixtures/legacy-shape/legacy-step.json",
      "Ensure validateRegistryShape throws ConfigError(SR-VALID-005) when any step uses the legacy `stepKind` shape per design 14 §B.",
    ),
  );

  assert(
    caught instanceof ConfigError,
    diag(
      `expected ConfigError instance, got ${
        caught === null ? "null" : typeof caught
      } (${(caught as { name?: string })?.name ?? "unknown"})`,
      "validateRegistryShape(legacyFixture)",
      "Throw via srLegacyStepShapeRejected(...) so the error is a typed ConfigError.",
    ),
  );

  const err = caught as ConfigError;
  assertEquals(
    err.code,
    LEGACY_REJECT_CODE,
    diag(
      `expected error code ${LEGACY_REJECT_CODE}, got ${err.code}`,
      "ConfigError.code",
      "Route legacy-shape rejection through srLegacyStepShapeRejected (SR-VALID-005), not a generic validation error.",
    ),
  );

  // Diagnosability: message must mention the legacy marker `stepKind`.
  assertStringIncludes(
    err.message,
    "stepKind",
    diag(
      "rejection message does not mention the legacy marker `stepKind`",
      "ConfigError.message",
      "Include the offending field name (`stepKind`) in the diagnostic so operators can locate the legacy entry.",
    ),
  );
});

// ---------------------------------------------------------------------------
// (3) Per-condition rejection via inline objects (no fixture files).
// ---------------------------------------------------------------------------

Deno.test("validateStepShape flags presence of `stepKind` field", () => {
  const errors = validateStepShape(
    {
      stepId: "x.y",
      stepKind: "work",
      kind: "work",
      address: { c1: "steps", c2: "x", c3: "y", edition: "default" },
    },
    "x.y",
  );

  assert(
    errors.length > 0,
    diag(
      "validateStepShape returned no errors for an entry containing legacy `stepKind`",
      "validateStepShape({ stepKind: 'work', ... })",
      "Reject any entry where `stepKind` is present at the step root (design 14 §B).",
    ),
  );
  assert(
    errors.some((e) => e.includes("stepKind")),
    diag(
      "no error message mentions the offending `stepKind` field",
      `errors=${JSON.stringify(errors)}`,
      "Cite the rejected field name in the error string for diagnosability.",
    ),
  );
});

Deno.test("validateStepShape flags flat C3L sibling `c2` (not nested in address)", () => {
  const errors = validateStepShape(
    {
      stepId: "x.y",
      kind: "work",
      c2: "x", // flat sibling — must live under `address`
      address: { c1: "steps", c2: "x", c3: "y", edition: "default" },
    },
    "x.y",
  );

  assert(
    errors.length > 0,
    diag(
      "validateStepShape accepted an entry with a flat `c2` sibling",
      "validateStepShape({ c2: 'x', address: {...} })",
      "Reject flat C3L siblings (c2/c3/edition/adaptation); they must be nested in `address` per design 14 §B/§C.",
    ),
  );
  assert(
    errors.some((e) => e.includes("c2")),
    diag(
      "no error message names the offending `c2` flat sibling",
      `errors=${JSON.stringify(errors)}`,
      "Surface the flat sibling field name (`c2`) in the diagnostic.",
    ),
  );
});

Deno.test("validateStepShape flags missing `kind` field", () => {
  const errors = validateStepShape(
    {
      stepId: "x.y",
      // kind: missing
      address: { c1: "steps", c2: "x", c3: "y", edition: "default" },
    },
    "x.y",
  );

  assert(
    errors.length > 0,
    diag(
      "validateStepShape accepted an entry missing the required `kind` discriminator",
      "validateStepShape({ /* no kind */, address: {...} })",
      "Require `kind` in {work, verification, closure} per design 14 §B.",
    ),
  );
  assert(
    errors.some((e) => e.includes('"kind"') && e.includes("missing")),
    diag(
      "error message does not state that `kind` is missing",
      `errors=${JSON.stringify(errors)}`,
      "Emit a message naming the missing `kind` field.",
    ),
  );
});

Deno.test("validateStepShape flags missing `address` aggregate", () => {
  const errors = validateStepShape(
    {
      stepId: "x.y",
      kind: "work",
      // address: missing
    },
    "x.y",
  );

  assert(
    errors.length > 0,
    diag(
      "validateStepShape accepted an entry missing the required `address` aggregate",
      "validateStepShape({ kind: 'work' /* no address */ })",
      "Require an `address` C3LAddress object per design 14 §C.",
    ),
  );
  assert(
    errors.some((e) => e.includes('"address"') && e.includes("missing")),
    diag(
      "error message does not state that `address` is missing",
      `errors=${JSON.stringify(errors)}`,
      "Emit a message naming the missing `address` aggregate.",
    ),
  );
});

Deno.test("validateStepShape flags invalid `kind` value (e.g. transformer)", () => {
  const errors = validateStepShape(
    {
      stepId: "x.y",
      kind: "transformer", // not in the union
      address: { c1: "steps", c2: "x", c3: "y", edition: "default" },
    },
    "x.y",
  );

  assert(
    errors.length > 0,
    diag(
      'validateStepShape accepted `kind: "transformer"` (not in union)',
      "validateStepShape({ kind: 'transformer', ... })",
      "Restrict `kind` to {work, verification, closure} per design 14 §B.",
    ),
  );
  assert(
    errors.some((e) => e.includes("transformer") && e.includes("kind")),
    diag(
      "error message does not surface the rejected value `transformer` and field `kind`",
      `errors=${JSON.stringify(errors)}`,
      "Echo both the field name and the offending value for diagnosability.",
    ),
  );
});

// ---------------------------------------------------------------------------
// (4) Translation NOT happening — validator rejects, never normalizes.
// ---------------------------------------------------------------------------

Deno.test(
  "validateRegistryShape does not translate legacy fixture (no normalization side effects)",
  () => {
    // Snapshot deep-keys before; structuredClone preserves the original shape
    // so we can prove the validator did not mutate the input either.
    const before = JSON.stringify(legacyFixture);

    let caught: unknown = undefined;
    try {
      validateRegistryShape(legacyFixture);
    } catch (e) {
      caught = e;
    }

    assert(
      caught instanceof ConfigError,
      diag(
        "validateRegistryShape produced no ConfigError for legacy fixture",
        "validateRegistryShape(legacyFixture)",
        "Reject legacy shapes outright; do not silently normalize and pass.",
      ),
    );

    const err = caught as ConfigError;

    // Canonical legacy diagnostic must name the legacy marker `stepKind`.
    // If the validator had silently translated `stepKind` -> `kind` before
    // running checks, this string would not appear in the diagnostic.
    assertStringIncludes(
      err.message,
      "stepKind",
      diag(
        "legacy rejection message lacks `stepKind` reference, suggesting silent translation",
        "ConfigError.message",
        "Reject the legacy field by name; do not paper over by injecting `kind` and re-validating.",
      ),
    );

    // Each flat C3L sibling present in the legacy fixture must also be named
    // in the diagnostic. If translation had occurred (flat siblings folded
    // into a synthesized `address`), these field names would not surface.
    // The legacy fixture declares flat `c2`, `c3`, `edition` siblings.
    for (const flatField of ["c2", "c3", "edition"] as const) {
      assertStringIncludes(
        err.message,
        flatField,
        diag(
          `legacy rejection message lacks flat sibling \`${flatField}\` reference, suggesting it was folded into a synthesized address`,
          "ConfigError.message",
          "Reject on the raw legacy shape; do not synthesize `address` from flat siblings before validating.",
        ),
      );
    }

    // The error code must be the legacy-rejection code, not a normalized-shape
    // validation failure code (e.g. SR-VALID-001 from validateStepRegistry).
    assertEquals(
      err.code,
      LEGACY_REJECT_CODE,
      diag(
        `expected ${LEGACY_REJECT_CODE} (raw legacy reject), got ${err.code}`,
        "ConfigError.code",
        "Strict validator must throw srLegacyStepShapeRejected, not a post-normalization validation error.",
      ),
    );

    // Input must not have been mutated in place.
    assertEquals(
      JSON.stringify(legacyFixture),
      before,
      diag(
        "legacy fixture was mutated by validateRegistryShape",
        "legacyFixture (imported JSON module)",
        "Validator must be pure; do not modify input shape in place.",
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// (5) Non-vacuity: prove the validator actually walked step entries.
// ---------------------------------------------------------------------------

Deno.test("validateRegistryShape inspects every step (non-vacuity)", () => {
  // Build a registry where MULTIPLE steps each violate a distinct condition,
  // so a single aggregated ConfigError must enumerate one diagnostic per step
  // — proving the loop walked all entries.
  const registry = {
    agentId: "fixture-multi",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "a.bad-stepkind": {
        stepId: "a.bad-stepkind",
        stepKind: "work", // legacy marker
        kind: "work",
        address: {
          c1: "steps",
          c2: "a",
          c3: "bad-stepkind",
          edition: "default",
        },
      },
      "b.bad-flat": {
        stepId: "b.bad-flat",
        kind: "work",
        c2: "b", // flat sibling
        address: { c1: "steps", c2: "b", c3: "bad-flat", edition: "default" },
      },
      "c.bad-kind": {
        stepId: "c.bad-kind",
        kind: "transformer", // not in the union
        address: { c1: "steps", c2: "c", c3: "bad-kind", edition: "default" },
      },
    },
  };

  const expectedStepIds = Object.keys(registry.steps);
  // Source-of-truth count: derived from the registry literal above, not a
  // hardcoded magic number.
  assert(
    expectedStepIds.length > 0,
    "test setup invariant: registry under test must declare at least one step",
  );

  let caught: unknown = undefined;
  try {
    validateRegistryShape(registry);
  } catch (e) {
    caught = e;
  }

  assert(
    caught instanceof ConfigError,
    diag(
      "validateRegistryShape did not throw on a multi-violation registry",
      "validateRegistryShape({ steps: { 3 violating entries } })",
      "Aggregate per-step errors and throw srLegacyStepShapeRejected.",
    ),
  );
  const err = caught as ConfigError;

  // Each step id must appear in the aggregated message — the only way that
  // can be true is if the validator walked every entry.
  for (const stepId of expectedStepIds) {
    assertStringIncludes(
      err.message,
      stepId,
      diag(
        `aggregated rejection does not reference step "${stepId}"`,
        `ConfigError.message (expected mentions of: ${
          JSON.stringify(expectedStepIds)
        })`,
        "Iterate over Object.entries(steps) and emit one diagnostic per offending entry.",
      ),
    );
  }
});

// ---------------------------------------------------------------------------
// (6) T30 / critique-5 B#3: validator surface partition (Option A).
//
// Source of truth:
//   - validator.ts function-level JSDoc (each validator declares its own
//     concern + names the codes other validators raise).
//   - SR-VALID-001 = validateStepKindIntents (intent containment +
//     fallbackIntent). NOTE: distinct from SR-INTENT-001 which is the
//     runtime router's emitted-intent error — different layer, different
//     event class.
//   - SR-VALID-004 = validateStepRegistry (semantics: top-level registry
//     fields, stepId↔key, name, uvVariables, usesStdin, structuredGate ⇒
//     kind+transitions, permissionMode enum, c3 kebab-case)
//   - SR-VALID-005 = validateRegistryShape (raw skeleton; rejects legacy
//     shape and demands kind+address)
//
// Test strategy:
//   - Inject a single concern-violation per test, then call ONLY the
//     validator that owns that concern. The expected error code proves
//     ownership. Calling a non-owning validator on the same input must
//     NOT raise (cross-concern leakage is the failure mode B#3 names
//     "accident of order").
//   - Cover both directions:
//       (a) intent-containment violation → only validateStepKindIntents
//           raises (validateStepRegistry must NOT raise on the same input)
//       (b) semantic violation (e.g. uvVariables not array, c3 camelCase,
//           bad permissionMode) → only validateStepRegistry raises
//           (validateStepKindIntents must NOT raise)
// ---------------------------------------------------------------------------

/**
 * Build a minimum valid Step entry. The caller supplies the field that
 * differs from the baseline. The baseline satisfies the raw skeleton AND
 * is intent-clean AND is semantics-clean — perturbing one field at a time
 * isolates the validator that owns that concern.
 */
function baselineRegistry(
  override: (step: Record<string, unknown>) => Record<string, unknown>,
): StepRegistry {
  const step: Record<string, unknown> = {
    stepId: "initial.issue",
    kind: "work",
    address: { c1: "steps", c2: "initial", c3: "issue", edition: "default" },
    name: "Baseline step",
    uvVariables: [],
    usesStdin: false,
    structuredGate: {
      allowedIntents: ["next", "repeat"],
      intentSchemaRef: "#/properties/next_action/properties/action",
      intentField: "next_action.action",
    },
    transitions: {
      next: { target: null },
      repeat: { target: "initial.issue" },
    },
  };
  return {
    agentId: "t30-baseline",
    version: "1.0.0",
    c1: "steps",
    steps: { "initial.issue": override(step) as never },
  } as StepRegistry;
}

Deno.test(
  "T30 partition: intent-containment violation surfaces ONLY in validateStepKindIntents (SR-VALID-001)",
  () => {
    // closure step but allowedIntents includes 'next' — only the intent
    // validator owns this concern.
    const registry = baselineRegistry((step) => ({
      ...step,
      kind: "closure",
      structuredGate: {
        ...(step.structuredGate as Record<string, unknown>),
        allowedIntents: ["closing", "next"], // 'next' not allowed for closure
      },
    }));

    let intentCaught: unknown = undefined;
    try {
      validateStepKindIntents(registry);
    } catch (e) {
      intentCaught = e;
    }

    assert(
      intentCaught instanceof ConfigError,
      diag(
        `expected ConfigError from validateStepKindIntents, got ${
          intentCaught === undefined
            ? "undefined (intent containment not enforced)"
            : typeof intentCaught
        }`,
        "validateStepKindIntents on intent-violating registry",
        "validateStepKindIntents must remain the single source of truth for STEP_KIND_ALLOWED_INTENTS containment.",
      ),
    );
    assertEquals(
      (intentCaught as ConfigError).code,
      "SR-VALID-001",
      diag(
        `expected SR-VALID-001, got ${(intentCaught as ConfigError).code}`,
        "validateStepKindIntents error code",
        "Intent-containment failures must keep the SR-VALID-001 catalog code (asserted by 5 runtime test sites).",
      ),
    );

    // Cross-concern check: validateStepRegistry must NOT raise on the same
    // input. If it did, the T30 partition is leaking — the same concern is
    // checked twice and removing one validator would silently regress.
    let semanticsCaught: unknown = undefined;
    try {
      validateStepRegistry(registry);
    } catch (e) {
      semanticsCaught = e;
    }
    assertEquals(
      semanticsCaught,
      undefined,
      diag(
        `validateStepRegistry raised on intent-only violation: ${
          (semanticsCaught as { message?: string })?.message ?? "(no message)"
        }`,
        "validateStepRegistry on intent-violating registry (cross-concern leakage)",
        "Move all intent-containment checks out of validateStepRegistry; intent ownership belongs to validateStepKindIntents (SR-VALID-001).",
      ),
    );
  },
);

Deno.test(
  "T30 partition: c3 kebab-case violation surfaces ONLY in validateStepRegistry (SR-VALID-004)",
  () => {
    // c3 in camelCase is a SEMANTIC violation (LayerType compatibility),
    // not a raw skeleton (presence/non-empty) or intent concern.
    const registry = baselineRegistry((step) => {
      const addr = step.address as Record<string, string>;
      return {
        ...step,
        stepId: "initial.externalState",
        address: { ...addr, c3: "externalState" },
      };
    });
    // Realign the steps key with the new stepId.
    registry.steps = {
      "initial.externalState": registry.steps["initial.issue"],
    };

    let semanticsCaught: unknown = undefined;
    try {
      validateStepRegistry(registry);
    } catch (e) {
      semanticsCaught = e;
    }

    assert(
      semanticsCaught instanceof ConfigError,
      diag(
        `expected ConfigError from validateStepRegistry on camelCase c3, got ${
          semanticsCaught === undefined
            ? "undefined (semantics not enforced)"
            : typeof semanticsCaught
        }`,
        "validateStepRegistry on c3='externalState'",
        "c3 kebab-case is a semantic constraint owned by validateStepRegistry.",
      ),
    );
    assertEquals(
      (semanticsCaught as ConfigError).code,
      "SR-VALID-004",
      diag(
        `expected SR-VALID-004, got ${(semanticsCaught as ConfigError).code}`,
        "validateStepRegistry error code on c3 violation",
        "Semantic failures (c3, uvVariables, usesStdin, permissionMode) raise SR-VALID-004.",
      ),
    );

    // Cross-concern check: validateStepKindIntents must NOT raise — c3
    // shape is not its concern.
    let intentCaught: unknown = undefined;
    try {
      validateStepKindIntents(registry);
    } catch (e) {
      intentCaught = e;
    }
    assertEquals(
      intentCaught,
      undefined,
      diag(
        `validateStepKindIntents raised on a c3-shape violation: ${
          (intentCaught as { message?: string })?.message ?? "(no message)"
        }`,
        "validateStepKindIntents on c3-violating registry (cross-concern leakage)",
        "validateStepKindIntents owns intent containment only; semantic shape belongs to validateStepRegistry.",
      ),
    );
  },
);

Deno.test(
  "T30 partition: validateStepRegistry no longer duplicates address.c2/c3/edition non-empty checks",
  () => {
    // The raw-shape gate already rejects empty c2/c3/edition (SR-VALID-005).
    // Per the T30 partition, validateStepRegistry must NOT also re-check
    // those non-empty constraints — that duplication is exactly the "cast
    // surface = validator surface only by accident of order" property
    // critique-5 B#3 named.
    //
    // Here we hand validateStepRegistry an address with empty c2 directly
    // (bypassing the raw-shape gate, simulating an in-memory caller). The
    // expectation is: validateStepRegistry does NOT raise on this concern,
    // because it has been dropped. validateStepShape still does.
    const stepWithEmptyC2: Record<string, unknown> = {
      stepId: "initial.issue",
      kind: "work",
      address: { c1: "steps", c2: "", c3: "issue", edition: "default" },
      name: "Empty-c2 step",
      uvVariables: [],
      usesStdin: false,
    };
    const registry = {
      agentId: "t30-empty-c2",
      version: "1.0.0",
      c1: "steps",
      steps: { "initial.issue": stepWithEmptyC2 as never },
    } as StepRegistry;

    // validateStepRegistry must not raise on the empty-c2 concern.
    let semanticsCaught: unknown = undefined;
    try {
      validateStepRegistry(registry);
    } catch (e) {
      semanticsCaught = e;
    }
    assertEquals(
      semanticsCaught,
      undefined,
      diag(
        `validateStepRegistry raised on empty c2 (concern owned by validateStepShape): ${
          (semanticsCaught as { message?: string })?.message ?? "(no message)"
        }`,
        "validateStepRegistry on empty-c2 input (T30 partition)",
        "Drop the address.c2/c3/edition non-empty re-checks from validateStepRegistry; raw-shape gate (validateStepShape) owns them and raises SR-VALID-005.",
      ),
    );

    // validateStepShape (the raw-shape owner) MUST raise on this concern.
    const shapeErrors = validateStepShape(stepWithEmptyC2, "initial.issue");
    assert(
      shapeErrors.some((e) => e.includes("c2")),
      diag(
        `validateStepShape did not flag empty c2 — non-vacuity check failed (errors=${
          JSON.stringify(shapeErrors)
        })`,
        "validateStepShape on empty-c2 input",
        "validateStepShape must remain the single owner of address.c2/c3/edition non-empty checks.",
      ),
    );
  },
);

Deno.test(
  "T30 call-order independence: validateStepKindIntents and validateStepRegistry are independently callable",
  () => {
    // Loader currently runs validateStepKindIntents (intent) then
    // validateStepRegistry (semantics). With the partition, removing one
    // call must NOT cause the other to start absorbing the dropped check.
    // Concretely: a registry that violates ONLY intent containment is
    // caught only by the intent validator, regardless of which validator
    // ran first or whether the other ran at all.
    const intentOnlyViolation = baselineRegistry((step) => ({
      ...step,
      kind: "closure",
      structuredGate: {
        ...(step.structuredGate as Record<string, unknown>),
        allowedIntents: ["closing", "next"],
      },
    }));

    // Run only validateStepRegistry: must pass (semantics are clean).
    validateStepRegistry(intentOnlyViolation);

    // Run only validateStepKindIntents: must throw SR-VALID-001.
    let caught: unknown = undefined;
    try {
      validateStepKindIntents(intentOnlyViolation);
    } catch (e) {
      caught = e;
    }
    assert(
      caught instanceof ConfigError &&
        (caught as ConfigError).code === "SR-VALID-001",
      diag(
        `expected SR-VALID-001 from validateStepKindIntents alone, got ${
          caught instanceof ConfigError
            ? (caught as ConfigError).code
            : caught === undefined
            ? "undefined (intent containment silently passed)"
            : typeof caught
        }`,
        "validateStepKindIntents standalone on intent-only violation",
        "validateStepKindIntents must catch the violation regardless of whether validateStepRegistry ran; do not depend on call order.",
      ),
    );

    // Symmetric direction: a semantic-only violation must be caught by
    // validateStepRegistry alone (validateStepKindIntents passes).
    const semanticsOnlyViolation = baselineRegistry((step) => ({
      ...step,
      uvVariables: "not-an-array" as unknown,
    }));
    validateStepKindIntents(semanticsOnlyViolation);
    let caught2: unknown = undefined;
    try {
      validateStepRegistry(semanticsOnlyViolation);
    } catch (e) {
      caught2 = e;
    }
    assert(
      caught2 instanceof ConfigError &&
        (caught2 as ConfigError).code === "SR-VALID-004",
      diag(
        `expected SR-VALID-004 from validateStepRegistry alone, got ${
          caught2 instanceof ConfigError
            ? (caught2 as ConfigError).code
            : caught2 === undefined
            ? "undefined (uvVariables type silently passed)"
            : typeof caught2
        }`,
        "validateStepRegistry standalone on semantics-only violation",
        "validateStepRegistry must catch its semantic concerns regardless of whether validateStepKindIntents ran first.",
      ),
    );
  },
);
