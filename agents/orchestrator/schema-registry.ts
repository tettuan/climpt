/**
 * Schema Registry — in-memory JSON Schema validator store.
 *
 * Workflow declarations reference schemas by id (e.g.
 * `"pr-merger-verdict@1.0.0"`). At load time, schemas are registered
 * here; at emit time, the ArtifactEmitter retrieves the compiled
 * validator to check resolved payloads before writing artifacts.
 *
 * The registry is intentionally agent-agnostic: it knows nothing about
 * workflow semantics, payload key names, or agent ids.
 */

import { Ajv, type ValidateFunction } from "npm:ajv@^8.17.1";

/** Outcome of a {@link SchemaRegistry.validate} call. */
export interface ValidationOutcome {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
}

/**
 * Registry of JSON Schema validators keyed by reference string.
 */
export interface SchemaRegistry {
  /**
   * Register a schema under `ref`. Throws if `ref` is already registered.
   * Intentionally strict: workflows must declare each schema exactly once
   * at load time to prevent silent overrides.
   */
  register(ref: string, schema: Record<string, unknown>): void;

  /** Retrieve the compiled validator for `ref`, or `undefined` if absent. */
  get(ref: string): ValidateFunction | undefined;

  /**
   * Validate `data` against the schema registered under `ref`.
   * Returns structured outcome; unknown `ref` yields `valid: false`
   * with a diagnostic error (does not throw).
   */
  validate(ref: string, data: unknown): ValidationOutcome;
}

/**
 * Default in-memory implementation. One {@link Ajv} instance is shared
 * across all registered schemas for cache locality.
 */
export class InMemorySchemaRegistry implements SchemaRegistry {
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #ajv: Ajv;

  constructor(ajv?: Ajv) {
    this.#ajv = ajv ?? new Ajv({ allErrors: true, strict: false });
  }

  register(ref: string, schema: Record<string, unknown>): void {
    if (this.#validators.has(ref)) {
      throw new Error(`Schema already registered: ${ref}`);
    }
    const validator = this.#ajv.compile(schema);
    this.#validators.set(ref, validator);
  }

  get(ref: string): ValidateFunction | undefined {
    return this.#validators.get(ref);
  }

  validate(ref: string, data: unknown): ValidationOutcome {
    const validator = this.#validators.get(ref);
    if (!validator) {
      return {
        valid: false,
        errors: [`Schema not registered: ${ref}`],
      };
    }
    const ok = validator(data);
    if (ok === true) {
      return { valid: true, errors: [] };
    }
    const errors = (validator.errors ?? []).map((err) =>
      `${err.instancePath} ${err.message}`.trim()
    );
    return { valid: false, errors };
  }
}
