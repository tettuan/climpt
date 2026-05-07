/**
 * Step Registry Test Helpers (test-only utilities)
 *
 * Build a typed {@link Step} from a partial fixture spec. After T7b the
 * helper requires the ADT-shape input (`kind` + `address`) — the
 * legacy 5-tuple synthesis (flat `c2`/`c3`/`edition`/`adaptation` +
 * optional `stepKind`) was deleted because it violated the "no synthesis"
 * principle the strict on-disk validator now enforces.
 *
 * IMPORTANT: This module is for test code only. Production code must
 * construct `Step` directly (or get one from `loadStepRegistry`).
 */

import type { Step } from "./types.ts";

/**
 * Required-shape input for {@link makeStep} — mirrors the typed `Step`
 * ADT. `stepId`, `kind`, and `address` are mandatory; everything else
 * has a sensible default for terse fixtures.
 */
export type StepFixtureInput =
  & Pick<Step, "stepId" | "kind" | "address">
  & Partial<Omit<Step, "stepId" | "kind" | "address">>;

/**
 * Build a typed {@link Step} from an ADT-shape fixture.
 *
 * Defaults:
 * - `name` defaults to `stepId`.
 * - `uvVariables` defaults to `[]`, `usesStdin` to `false`.
 *
 * The address aggregate is taken verbatim — no flat-field synthesis.
 */
export function makeStep(input: StepFixtureInput): Step {
  const { stepId, kind, address, name, uvVariables, usesStdin, ...rest } =
    input;

  return {
    stepId,
    kind,
    address,
    name: name ?? stepId,
    uvVariables: uvVariables ?? [],
    usesStdin: usesStdin ?? false,
    ...(rest as Partial<Step>),
  };
}
