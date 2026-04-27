/**
 * Decision ADT — `Accept | Reject(ValidationError[])` for Boot validation.
 *
 * Every validator returns a `Decision`. `Reject` accumulates **all**
 * failures rather than failing on the first one, so a single
 * `--validate` run surfaces every issue. The boundary entry point
 * (see {@link bootValidationFailed}) collapses the aggregate
 * `Decision` back into a single thrown error to preserve fail-fast
 * semantics for callers that already catch generic errors.
 *
 * Design ref: `agents/docs/design/realistic/13-agent-config.md` §G
 *             "Decision: Accept / Reject".
 *
 * @module
 */

import type { ValidationError } from "./errors.ts";

/**
 * Validation verdict for a single validator (or a combination).
 *
 * `accept` carries an arbitrary value (use `void`/`undefined` when
 * the validator only expresses a yes/no judgement). `reject` carries
 * the accumulated `ValidationError[]`.
 */
export type Decision<T = void> =
  | { readonly kind: "accept"; readonly value: T }
  | { readonly kind: "reject"; readonly errors: readonly ValidationError[] };

/**
 * Construct an `Accept` variant.
 */
export function accept<T>(value: T): Decision<T> {
  return { kind: "accept", value };
}

/**
 * Convenience: `Decision<void>` accept with no payload.
 */
export function acceptVoid(): Decision<void> {
  return { kind: "accept", value: undefined };
}

/**
 * Construct a `Reject` variant. Caller must pass at least one error;
 * an empty rejection is a contradiction in terms.
 */
export function reject(
  errors: readonly ValidationError[],
): Decision<never> {
  return { kind: "reject", errors };
}

/**
 * Type guard: `Decision` is `accept`.
 */
export function isAccept<T>(
  d: Decision<T>,
): d is { readonly kind: "accept"; readonly value: T } {
  return d.kind === "accept";
}

/**
 * Type guard: `Decision` is `reject`.
 */
export function isReject<T>(
  d: Decision<T>,
): d is {
  readonly kind: "reject";
  readonly errors: readonly ValidationError[];
} {
  return d.kind === "reject";
}

/**
 * Combine multiple Decisions into one. Errors accumulate; values are
 * lifted into a tuple of `T[]`.
 *
 * - All inputs `accept` ⇒ `accept(values)`
 * - Any input `reject`  ⇒ `reject(errors)` (errors from every Reject
 *   are concatenated — first-error-wins is **not** preserved)
 */
export function combineDecisions<T>(
  decisions: readonly Decision<T>[],
): Decision<readonly T[]> {
  const errors: ValidationError[] = [];
  const values: T[] = [];
  for (const d of decisions) {
    if (d.kind === "reject") {
      for (const err of d.errors) errors.push(err);
    } else {
      values.push(d.value);
    }
  }
  if (errors.length > 0) {
    return reject(errors);
  }
  return accept(values);
}

/**
 * Map an `accept(value)` to `accept(f(value))` and pass `reject`
 * through unchanged. Useful when chaining validators that produce
 * derived results.
 */
export function mapDecision<T, U>(
  d: Decision<T>,
  f: (value: T) => U,
): Decision<U> {
  if (d.kind === "accept") {
    return accept(f(d.value));
  }
  return d;
}
