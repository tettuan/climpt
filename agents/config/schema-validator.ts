/**
 * Schema Validator - Lightweight JSON Schema Draft-07 Validator
 *
 * Validates data against agent.schema.json and steps_registry.schema.json
 * without external dependencies.
 *
 * Supported keywords: required, type, enum, pattern, properties,
 * additionalProperties, $ref (local only), minimum, oneOf, default, items.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SchemaValidationResult {
  valid: boolean;
  errors: { path: string; message: string }[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Minimal representation of a JSON Schema node. */
interface SchemaNode {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean | SchemaNode;
  items?: SchemaNode;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  $ref?: string;
  oneOf?: SchemaNode[];
  default?: unknown;
  description?: string;
  definitions?: Record<string, SchemaNode>;
  // deno-lint-ignore no-explicit-any
  [key: string]: any; // allow extra schema keywords we do not handle
}

// ---------------------------------------------------------------------------
// Schema loading (module-level, lazy)
// ---------------------------------------------------------------------------

let _agentSchema: SchemaNode | null = null;
let _registrySchema: SchemaNode | null = null;

async function loadSchema(relPath: string): Promise<SchemaNode> {
  const url = new URL(relPath, import.meta.url);
  const text = await Deno.readTextFile(url);
  return JSON.parse(text) as SchemaNode;
}

async function agentSchema(): Promise<SchemaNode> {
  if (!_agentSchema) {
    _agentSchema = await loadSchema("../schemas/agent.schema.json");
  }
  return _agentSchema;
}

async function registrySchema(): Promise<SchemaNode> {
  if (!_registrySchema) {
    _registrySchema = await loadSchema("../schemas/steps_registry.schema.json");
  }
  return _registrySchema;
}

// ---------------------------------------------------------------------------
// Core validation engine
// ---------------------------------------------------------------------------

function validateValue(
  value: unknown,
  schema: SchemaNode,
  path: string,
  definitions: Record<string, SchemaNode>,
): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];

  // Handle $ref - resolve local #/definitions/Xxx references
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, definitions);
    if (!resolved) {
      errors.push({ path, message: `Unresolvable $ref: ${schema.$ref}` });
      return errors;
    }
    return validateValue(value, resolved, path, definitions);
  }

  // Handle oneOf
  if (schema.oneOf) {
    let matchCount = 0;
    for (const sub of schema.oneOf) {
      const subErrors = validateValue(value, sub, path, definitions);
      if (subErrors.length === 0) {
        matchCount++;
      }
    }
    if (matchCount !== 1) {
      errors.push({
        path,
        message:
          `Must match exactly one of ${schema.oneOf.length} schemas (matched ${matchCount})`,
      });
    }
    // When oneOf fails we report the mismatch; do not cascade sub-errors
    return errors;
  }

  // Type check (supports both "string" and ["string", "null"] forms)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => checkType(value, t))) {
      errors.push({
        path,
        message: `Expected type "${
          Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type
        }", got ${typeOf(value)}`,
      });
      // If type doesn't match, deeper checks are meaningless
      return errors;
    }
  }

  // enum
  if (schema.enum) {
    if (!schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
      errors.push({
        path,
        message: `Value ${JSON.stringify(value)} not in enum [${
          schema.enum.map((e) => JSON.stringify(e)).join(", ")
        }]`,
      });
    }
  }

  // pattern (strings only)
  if (schema.pattern && typeof value === "string") {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push({
        path,
        message: `Does not match pattern "${schema.pattern}"`,
      });
    }
  }

  // minimum (numbers only)
  if (schema.minimum !== undefined && typeof value === "number") {
    if (value < schema.minimum) {
      errors.push({
        path,
        message: `Value ${value} is less than minimum ${schema.minimum}`,
      });
    }
  }

  // Object-level checks
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // required
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({
            path: joinPath(path, key),
            message: "Required property is missing",
          });
        }
      }
    }

    // properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          errors.push(
            ...validateValue(
              obj[key],
              propSchema,
              joinPath(path, key),
              definitions,
            ),
          );
        }
      }
    }

    // additionalProperties
    if (schema.additionalProperties !== undefined) {
      const knownKeys = new Set(
        schema.properties ? Object.keys(schema.properties) : [],
      );
      const extraKeys = Object.keys(obj).filter((k) => !knownKeys.has(k));

      if (schema.additionalProperties === false) {
        for (const key of extraKeys) {
          errors.push({
            path: joinPath(path, key),
            message: "Additional property is not allowed",
          });
        }
      } else if (
        typeof schema.additionalProperties === "object" &&
        schema.additionalProperties !== null
      ) {
        for (const key of extraKeys) {
          errors.push(
            ...validateValue(
              obj[key],
              schema.additionalProperties as SchemaNode,
              joinPath(path, key),
              definitions,
            ),
          );
        }
      }
    }
  }

  // Array-level checks
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      errors.push(
        ...validateValue(value[i], schema.items, `${path}[${i}]`, definitions),
      );
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRef(
  ref: string,
  definitions: Record<string, SchemaNode>,
): SchemaNode | null {
  const prefix = "#/definitions/";
  if (!ref.startsWith(prefix)) return null;
  const name = ref.slice(prefix.length);
  return definitions[name] ?? null;
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function checkType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "object":
      return typeof value === "object" && value !== null &&
        !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true; // unknown type - lenient
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate data against an arbitrary JSON Schema object.
 *
 * This is the general-purpose entry point used by format-validator and
 * any other caller that has an inline schema (not loaded from a file).
 */
export function validateDataAgainstSchema(
  data: unknown,
  schema: Record<string, unknown>,
): SchemaValidationResult {
  const defs = (schema.definitions ?? {}) as Record<string, SchemaNode>;
  const errors = validateValue(data, schema as SchemaNode, "", defs);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate data against agent.schema.json.
 */
export async function validateAgentSchema(
  data: unknown,
): Promise<SchemaValidationResult> {
  const schema = await agentSchema();
  const defs = schema.definitions ?? {};
  const errors = validateValue(data, schema, "", defs);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate data against steps_registry.schema.json.
 */
export async function validateRegistrySchema(
  data: unknown,
): Promise<SchemaValidationResult> {
  const schema = await registrySchema();
  const defs = schema.definitions ?? {};
  const errors = validateValue(data, schema, "", defs);
  return { valid: errors.length === 0, errors };
}
