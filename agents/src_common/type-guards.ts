/**
 * Type Guards - Common type checking utilities
 *
 * Provides runtime type guards for safe handling of unknown values.
 * Eliminates unsafe type assertions and casts.
 */

/**
 * Check if a value is a non-null object (not an array).
 *
 * @param value - Value to check
 * @returns true if value is a Record-like object
 *
 * @example
 * ```typescript
 * const data: unknown = JSON.parse(text);
 * if (isRecord(data)) {
 *   // data is now typed as Record<string, unknown>
 *   const name = data.name;
 * }
 * ```
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if a value is a string.
 *
 * @param value - Value to check
 * @returns true if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Check if a value is a number (and not NaN).
 *
 * @param value - Value to check
 * @returns true if value is a valid number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

/**
 * Check if a value is a boolean.
 *
 * @param value - Value to check
 * @returns true if value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Check if a value is an array.
 *
 * @param value - Value to check
 * @returns true if value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Check if a value is a string array.
 *
 * @param value - Value to check
 * @returns true if value is a string array
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

/**
 * Get a property from a record safely.
 *
 * @param obj - Object to get property from
 * @param key - Property key
 * @returns Property value or undefined
 *
 * @example
 * ```typescript
 * const value = getProperty(data, "name");
 * if (isString(value)) {
 *   // value is now typed as string
 * }
 * ```
 */
export function getProperty(
  obj: Record<string, unknown>,
  key: string,
): unknown {
  return obj[key];
}

/**
 * Get a string property from a record safely.
 *
 * @param obj - Object to get property from
 * @param key - Property key
 * @returns Property value as string or undefined
 */
export function getStringProperty(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return isString(value) ? value : undefined;
}

/**
 * Get a number property from a record safely.
 *
 * @param obj - Object to get property from
 * @param key - Property key
 * @returns Property value as number or undefined
 */
export function getNumberProperty(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = obj[key];
  return isNumber(value) ? value : undefined;
}
