/**
 * Adapter — bridge legacy `ValidationResult` (string-message arrays)
 * to the unified `Decision<void>` ADT.
 *
 * Existing validators (`agents/config/*-validator.ts`) historically
 * return `ValidationResult` (`{ valid, errors[], warnings[] }`). T1.4
 * does not rewrite all of them in one pass — that would explode the
 * change surface and risk reviewer churn. Instead this adapter lifts
 * each `ValidationResult` into the unified `Decision` shape, tagging
 * each emitted error with the design rule code (W / A / S) the
 * validator covers.
 *
 * For validators whose check covers a single rule, pass that single
 * code. For validators whose checks span multiple rules but cannot
 * be cleanly split without semantic rewrite, pass the **closest-fit**
 * code and rely on the message body to carry the specific failure.
 * Genuine multi-code split is deferred to T2.2 (BootKernel.boot).
 *
 * @module
 */

import type { ValidationError, ValidationErrorCode } from "./errors.ts";
import { validationError } from "./errors.ts";
import { accept, acceptVoid, type Decision, reject } from "./decision.ts";

/**
 * Minimal shape of legacy validation results consumed by the adapter.
 *
 * Both `ValidationResult` (config layer) and `CrossRefResult`
 * (registry layer) satisfy this shape. Warnings are intentionally
 * dropped — they are non-blocking and live in a separate channel.
 */
export interface LegacyValidationLike {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Lift a legacy `ValidationResult`-like shape into a `Decision<void>`.
 *
 * @param result   The legacy validator output.
 * @param code     The design rule code to tag each error with. When the
 *                 validator's checks span multiple rules, pass the
 *                 closest-fit code (T2.2 finalizes per-rule split).
 * @param source   Optional source identifier (file path / location).
 */
export function decisionFromLegacy(
  result: LegacyValidationLike,
  code: ValidationErrorCode,
  source?: string,
): Decision<void> {
  if (result.valid && result.errors.length === 0) {
    return acceptVoid();
  }
  const errors: ValidationError[] = result.errors.map((message) =>
    validationError(code, message, source ? { source } : undefined)
  );
  return reject(errors);
}

/**
 * Lift a legacy result with **per-message code mapping**.
 *
 * Some validators emit messages whose code is determinable from the
 * text (e.g. flow-validator covers A3 reachability + A4 boundary +
 * S2 dangling target). Pass a `mapMessage` that returns the most
 * specific code per message; default to a fallback when no pattern
 * matches.
 *
 * @param result      Legacy validator output.
 * @param mapMessage  Function that selects the rule code per message.
 * @param fallback    Code used when `mapMessage` returns `undefined`.
 * @param source      Optional source identifier.
 */
export function decisionFromLegacyMapped(
  result: LegacyValidationLike,
  mapMessage: (message: string) => ValidationErrorCode | undefined,
  fallback: ValidationErrorCode,
  source?: string,
): Decision<void> {
  if (result.valid && result.errors.length === 0) {
    return acceptVoid();
  }
  const errors: ValidationError[] = result.errors.map((message) => {
    const code = mapMessage(message) ?? fallback;
    return validationError(code, message, source ? { source } : undefined);
  });
  return reject(errors);
}

/**
 * Lift a legacy `SchemaValidationResult` shape (path + message pairs).
 *
 * This is structurally distinct from `ValidationResult` because each
 * error carries a `path` — preserved as `context.path`. All entries
 * are tagged with the same `code` since schema validation is one rule
 * (S4 / agent.schema or steps_registry.schema).
 */
export function decisionFromSchema(
  result: {
    readonly valid: boolean;
    readonly errors: readonly { path: string; message: string }[];
  },
  code: ValidationErrorCode,
  source?: string,
): Decision<void> {
  if (result.valid && result.errors.length === 0) {
    return acceptVoid();
  }
  const errors: ValidationError[] = result.errors.map((e) =>
    validationError(code, e.message, {
      source,
      context: { path: e.path },
    })
  );
  return reject(errors);
}

/**
 * Bind a value to an Accept decision. Convenience for validators that
 * compute a derived value (e.g. a parsed registry) when they accept.
 */
export function acceptValue<T>(value: T): Decision<T> {
  return accept(value);
}
