/**
 * Validator Registry
 *
 * Manages registration and retrieval of validators for pre-close validation.
 * Validators can be built-in or custom (registered at runtime).
 */

import type {
  AggregateValidationResult,
  Validator,
  ValidatorContext,
} from "./types.ts";
import { gitCleanValidator } from "./plugins/git-clean.ts";

/**
 * Registry of available validators
 */
const validators = new Map<string, Validator>();

/**
 * Initialize built-in validators
 */
function initializeBuiltinValidators(): void {
  // Only register if not already registered (idempotent)
  if (!validators.has(gitCleanValidator.id)) {
    validators.set(gitCleanValidator.id, gitCleanValidator);
  }
}

// Initialize on module load
initializeBuiltinValidators();

/**
 * Get a validator by ID
 * @param id Validator identifier
 * @returns The validator or undefined if not found
 */
export function getValidator(id: string): Validator | undefined {
  return validators.get(id);
}

/**
 * Register a custom validator
 * @param validator Validator to register
 * @throws Error if a validator with the same ID already exists
 */
export function registerValidator(validator: Validator): void {
  if (validators.has(validator.id)) {
    throw new Error(
      `Validator with ID '${validator.id}' is already registered`,
    );
  }
  validators.set(validator.id, validator);
}

/**
 * List all registered validators
 * @returns Array of all registered validators
 */
export function listValidators(): Validator[] {
  return Array.from(validators.values());
}

/**
 * Run multiple validators and aggregate results
 * @param validatorIds Array of validator IDs to run
 * @param ctx Validator context
 * @returns Aggregate result from all validators
 */
export async function runValidators(
  validatorIds: string[],
  ctx: ValidatorContext,
): Promise<AggregateValidationResult> {
  const result: AggregateValidationResult = {
    valid: true,
    errors: [],
    details: [],
    results: {},
  };

  // Sequential execution: validators may depend on previous results or shared state
  for (const id of validatorIds) {
    const validator = getValidator(id);

    if (!validator) {
      ctx.logger.warn(`Validator not found: ${id}`);
      continue;
    }

    try {
      // deno-lint-ignore no-await-in-loop
      const validationResult = await validator.validate(ctx);
      result.results[id] = validationResult;

      if (!validationResult.valid) {
        result.valid = false;
        if (validationResult.error) {
          result.errors.push(`[${id}] ${validationResult.error}`);
        }
        if (validationResult.details) {
          result.details.push(...validationResult.details);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(
        error,
      );
      ctx.logger.error(`Validator '${id}' threw an error`, {
        error: errorMessage,
      });
      result.results[id] = {
        valid: false,
        error: `Validator error: ${errorMessage}`,
      };
      result.valid = false;
      result.errors.push(`[${id}] Validator error: ${errorMessage}`);
    }
  }

  return result;
}

/**
 * Check if a validator is registered
 * @param id Validator identifier
 * @returns True if the validator exists
 */
export function hasValidator(id: string): boolean {
  return validators.has(id);
}

/**
 * Clear all registered validators (for testing purposes)
 * @internal
 */
export function clearValidators(): void {
  validators.clear();
}

/**
 * Reset to default built-in validators (for testing purposes)
 * @internal
 */
export function resetValidators(): void {
  validators.clear();
  initializeBuiltinValidators();
}
