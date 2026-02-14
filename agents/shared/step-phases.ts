/**
 * Step Phase Constants
 *
 * Centralized string constants for step phases used in the step flow system.
 * Step phases identify the C2-level prompt category in the C3L path system.
 *
 * NOTE: StepPhase is different from StepKind (defined in common/step-registry.ts).
 * - StepPhase: C2 value in C3L paths ("initial", "continuation", "verification", "closure")
 * - StepKind: Tool policy category ("work", "verification", "closure")
 *
 * The mapping is: initial/continuation -> work (StepKind), verification -> verification, closure -> closure
 */

export const STEP_PHASE = {
  INITIAL: "initial",
  CONTINUATION: "continuation",
  VERIFICATION: "verification",
  CLOSURE: "closure",
} as const;

export type StepPhase = typeof STEP_PHASE[keyof typeof STEP_PHASE];
