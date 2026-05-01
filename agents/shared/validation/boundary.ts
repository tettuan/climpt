/**
 * Boot validation boundary — convert aggregated Decision rejections
 * back into a single thrown exception so existing callers that catch
 * generic errors keep working unchanged.
 *
 * The {@link BootValidationFailed} class is the **only** point at
 * which the validator chain throws. Inner validators return
 * {@link Decision} (no throw); the entry point (e.g. `validateFull` in
 * `agents/config/mod.ts`) folds them with `combineDecisions` and, on
 * Reject, throws once — so a single `--validate` run surfaces every
 * collected error at the surface.
 *
 * Design ref: `agents/docs/design/realistic/13-agent-config.md` §G —
 * "Boot Reject = ValidationError ADT" (single throw at boundary).
 *
 * @module
 */

import type { ValidationError } from "./errors.ts";
import { ClimptError } from "../errors/base.ts";

/**
 * Aggregated boot validation failure thrown at the boundary.
 *
 * Carries the full `ValidationError[]` collected from every validator
 * that rejected. The `message` is a flattened summary so logs / CLI
 * output stay readable; structured tooling should use `errors`.
 */
export class BootValidationFailed extends ClimptError {
  readonly recoverable = false;
  readonly code = "BOOT-VALIDATION-FAILED";

  constructor(readonly errors: readonly ValidationError[]) {
    super(formatMessage(errors));
    this.name = "BootValidationFailed";
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      errors: this.errors.map((e) => ({
        code: e.code,
        message: e.message,
        source: e.source,
        context: e.context,
      })),
    };
  }
}

/**
 * Throw a {@link BootValidationFailed} if `errors` is non-empty;
 * no-op otherwise. Convenience for boundary entry points.
 */
export function throwIfRejected(
  errors: readonly ValidationError[],
): void {
  if (errors.length > 0) {
    throw new BootValidationFailed(errors);
  }
}

function formatMessage(errors: readonly ValidationError[]): string {
  if (errors.length === 0) {
    // Defensive: BootValidationFailed should never be constructed with
    // an empty list. The boundary helper guards against this.
    return "Boot validation failed (no errors recorded — likely a bug)";
  }
  const lines = errors.map((e) => {
    const src = e.source ? ` [${e.source}]` : "";
    return `  [${e.code}]${src} ${e.message}`;
  });
  return `Boot validation failed (${errors.length} error${
    errors.length === 1 ? "" : "s"
  }):\n${lines.join("\n")}`;
}
