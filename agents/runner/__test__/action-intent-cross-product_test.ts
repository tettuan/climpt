/**
 * TC-NEW-G8 — ACTION_TO_INTENT × STEP_KIND_ALLOWED_INTENTS cross-product invariant.
 *
 * Invariant under test (Invariant):
 *   Every value in `ACTION_TO_INTENT` is admitted by at least one entry in
 *   `STEP_KIND_ALLOWED_INTENTS`. In other words, no alias resolves to an
 *   intent that no StepKind is allowed to emit — such an alias would be
 *   structurally unroutable, since the validator would reject it on every
 *   kind.
 *
 * Source-of-truth citations:
 *   - agents/runner/step-gate-interpreter.ts:39 (ACTION_TO_INTENT map)
 *   - agents/common/step-registry/types.ts (STEP_KIND_ALLOWED_INTENTS)
 *
 * Diagnosability:
 *   The test imports both tables as the single source of truth and
 *   iterates `Object.entries(ACTION_TO_INTENT)`. No alias list and no
 *   intent set is hardcoded — adding or removing an alias or a StepKind
 *   automatically reshapes the cross product.
 *
 * Non-vacuity:
 *   The test pre-asserts `Object.keys(ACTION_TO_INTENT).length >= 6` so a
 *   regression that empties the alias table fails loudly instead of
 *   passing vacuously.
 */

import { assert } from "@std/assert";
import { ACTION_TO_INTENT } from "../step-gate-interpreter.ts";
import { STEP_KIND_ALLOWED_INTENTS } from "../../common/step-registry/types.ts";

Deno.test(
  "TC-NEW-G8: every ACTION_TO_INTENT value is admitted by at least one StepKind in STEP_KIND_ALLOWED_INTENTS",
  () => {
    // ----- Non-vacuity: ACTION_TO_INTENT must declare a non-trivial alias
    // surface. The historical surface is at least 6 keys (the canonical
    // intent names plus user-facing aliases). A regression that empties
    // the table is caught here. -----
    const aliasCount = Object.keys(ACTION_TO_INTENT).length;
    assert(
      aliasCount >= 6,
      `non-vacuity: ACTION_TO_INTENT must declare at least 6 alias entries ` +
        `(found ${aliasCount}: ${
          JSON.stringify(Object.keys(ACTION_TO_INTENT))
        }) ` +
        `| where: agents/runner/step-gate-interpreter.ts:39 ` +
        `| how-to-fix: do not remove the canonical alias surface; ` +
        `the runtime alias table is part of the public contract`,
    );

    const allowlists = Object.values(STEP_KIND_ALLOWED_INTENTS);

    // Per-entry invariant: every (alias -> intent) pair must be admitted
    // by at least one StepKind allowlist. An alias whose intent is in no
    // allowlist is structurally unroutable.
    for (const [alias, intent] of Object.entries(ACTION_TO_INTENT)) {
      const admitted = allowlists.some((arr) => arr.includes(intent));
      assert(
        admitted,
        `Fix: ACTION_TO_INTENT alias "${alias}" -> "${intent}" is not admitted ` +
          `by any StepKind in STEP_KIND_ALLOWED_INTENTS. Either add the kind ` +
          `or drop the alias. step-gate-interpreter.ts:39 + ` +
          `common/step-registry/types.ts.`,
      );
    }
  },
);
