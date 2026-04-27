/**
 * Step Registry Test Helpers (test-only utilities)
 *
 * Bridge legacy 5-tuple step fixtures to the typed `Step` ADT introduced
 * in T1.3 (P1 of realistic-design migration). Test fixtures previously
 * constructed `PromptStepDefinition` with `c2`/`c3`/`edition`/`adaptation`
 * as separate fields and `stepKind` optional; the new ADT uses an
 * `address: C3LAddress` aggregate and a required `kind` discriminator.
 *
 * IMPORTANT: This module is for test code only. Production code must
 * construct `Step` directly (or get one from `loadStepRegistry`).
 */

import type { C3LAddress, Step, StepKind } from "./types.ts";

/**
 * Disk-shape input for {@link makeStep} — the loose shape that legacy
 * tests have historically used. Mirrors the on-disk JSON layout that
 * T1.7 will eventually migrate.
 */
export type StepFixtureInput = {
  stepId: string;
  name?: string;
  kind?: StepKind;
  /** Legacy alias for `kind`. Tests written before T1.3 used this. */
  stepKind?: StepKind;
  c1?: string;
  c2?: string;
  c3?: string;
  edition?: string;
  adaptation?: string;
  uvVariables?: string[];
  usesStdin?: boolean;
} & Partial<Omit<Step, "stepId" | "kind" | "address" | "name">>;

/**
 * Build a typed {@link Step} from a legacy disk-shape fixture.
 *
 * Defaults that match the previous PromptStepDefinition behavior:
 * - `kind` is taken from `kind` or `stepKind`; otherwise inferred from `c2`
 *   the same way the loader does.
 * - `c1` defaults to `"steps"` (the registry-level c1 used in shipped
 *   agents).
 * - `edition` defaults to `"default"`.
 * - `uvVariables` defaults to `[]`, `usesStdin` to `false`.
 *
 * Use this helper anywhere a test previously wrote
 * `{ stepId, name, c2, c3, edition, ... } as PromptStepDefinition`.
 */
export function makeStep(input: StepFixtureInput): Step {
  const c2 = input.c2 ?? "test";
  const c3 = input.c3 ?? "step";
  const kind = input.kind ?? input.stepKind ?? inferKindFromC2(c2);
  const address: C3LAddress = input.adaptation !== undefined
    ? {
      c1: input.c1 ?? "steps",
      c2,
      c3,
      edition: input.edition ?? "default",
      adaptation: input.adaptation,
    }
    : {
      c1: input.c1 ?? "steps",
      c2,
      c3,
      edition: input.edition ?? "default",
    };

  // Strip disk-only keys; the rest map onto Step.
  const {
    stepId,
    name,
    kind: _k,
    stepKind: _sk,
    c1: _c1,
    c2: _c2,
    c3: _c3,
    edition: _ed,
    adaptation: _ad,
    uvVariables,
    usesStdin,
    ...rest
  } = input;

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

function inferKindFromC2(c2: string): StepKind {
  switch (c2) {
    case "initial":
    case "continuation":
      return "work";
    case "verification":
      return "verification";
    case "closure":
      return "closure";
    default:
      return "work";
  }
}
