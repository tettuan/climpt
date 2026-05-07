/**
 * deepFreeze — recursive `Object.freeze` for the BootArtifacts tree.
 *
 * `Object.freeze` does **not** propagate to nested objects, so a single
 * top-level freeze leaves Layer 4's nested config maps mutable in
 * practice. This helper walks the value tree and freezes every
 * non-primitive node so the post-boot artifact is structurally
 * immutable per design 20 §B / §E (Layer 4 Run-immutable).
 *
 * Properties:
 * - Idempotent: skips already-frozen nodes (cycle-safe).
 * - Type-only freeze: returns `Readonly<T>` so the type system mirrors
 *   the runtime guarantee.
 * - Walks own enumerable keys only (Symbols are intentionally not
 *   recursed — none appear in BootArtifacts).
 *
 * Design ref: `tmp/realistic-migration/phased-plan.md` §P2 mitigation —
 * "Object.freeze はネストオブジェクトには伝播しない... 専用の deepFreeze
 *  helper を agents/boot/freeze.ts で実装する".
 *
 * Note: a sibling `deepFreeze` exists in `agents/config/defaults.ts`
 * for the legacy `applyDefaults` path; the Boot layer keeps its own
 * copy so `agents/boot/` has no upward dependency on `agents/config/`.
 *
 * @module
 */

/**
 * Recursively freeze `value` and every nested object / array reachable
 * through own enumerable keys. Primitives and already-frozen nodes are
 * returned unchanged.
 *
 * @param value Any value; objects (including arrays) are frozen in place.
 * @returns The same reference, typed as `Readonly<T>`.
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (
    value === null || typeof value !== "object" || Object.isFrozen(value)
  ) {
    return value as Readonly<T>;
  }
  // Freeze BEFORE recursing so cyclic graphs short-circuit on the
  // already-frozen check and the recursion terminates. Property
  // descriptors are unaffected — Object.freeze only flips the
  // `[[Writable]]` / `[[Configurable]]` bits and does not block our
  // subsequent reads of own enumerable keys.
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== null && typeof nested === "object") {
      deepFreeze(nested);
    }
  }
  return value as Readonly<T>;
}
