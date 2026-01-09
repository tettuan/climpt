/**
 * Deep merge utility for configuration objects
 */

/**
 * Check if a value is a plain object (not null, array, or other types)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/**
 * Deep merge two objects, with values from `override` taking precedence.
 * Arrays are replaced, not merged.
 *
 * @param base - The base object
 * @param override - The object whose values take precedence
 * @returns A new merged object
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>,
): T {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(override)) {
    const baseValue = base[key];
    const overrideValue = override[key];

    if (overrideValue === undefined) {
      continue;
    }

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>,
      );
    } else {
      result[key] = overrideValue;
    }
  }

  return result as T;
}

/**
 * Deep merge multiple objects from left to right
 *
 * @param objects - Objects to merge
 * @returns A new merged object
 */
export function deepMergeAll<T extends Record<string, unknown>>(
  ...objects: Partial<T>[]
): T {
  if (objects.length === 0) {
    return {} as T;
  }

  if (objects.length === 1) {
    return { ...objects[0] } as T;
  }

  return objects.reduce(
    (acc, obj) => deepMerge(acc as T, obj),
    {} as Partial<T>,
  ) as T;
}
