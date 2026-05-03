/**
 * Shared validation module — `Decision = Accept | Reject(ValidationError)`.
 *
 * Public exports for the unified Boot validation layer (T1.4).
 *
 * Three layers:
 *  - {@link errors.ts}    — `ValidationError` ADT (W / A / S code)
 *  - {@link decision.ts}  — `Decision<T>` ADT + combinators
 *  - {@link adapter.ts}   — bridge from legacy `ValidationResult`
 *  - {@link boundary.ts}  — `BootValidationFailed` for the entry-point throw
 *
 * @module
 */

export type { ValidationError, ValidationErrorCode } from "./errors.ts";
export { validationError } from "./errors.ts";

export type { Decision } from "./decision.ts";
export {
  accept,
  acceptVoid,
  combineDecisions,
  isAccept,
  isReject,
  mapDecision,
  reject,
} from "./decision.ts";

export type { LegacyValidationLike } from "./adapter.ts";
export {
  acceptValue,
  decisionFromLegacy,
  decisionFromLegacyMapped,
  decisionFromSchema,
} from "./adapter.ts";

export { BootValidationFailed, throwIfRejected } from "./boundary.ts";
