/**
 * CompletionValidator
 *
 * Validates step completion conditions and returns pattern and parameters on failure.
 */

import type {
  CompletionCondition,
  CompletionValidatorContext,
  ValidatorDefinition,
  ValidatorRegistry,
  ValidatorResult,
  ValidatorRunResult,
} from "./types.ts";
import { checkSuccessCondition, CommandRunner } from "./command-runner.ts";
import { ParamExtractor } from "./param-extractors.ts";

/**
 * CompletionValidator
 *
 * Validates completion conditions and returns information for pattern-based
 * retry prompt generation on failure.
 */
export class CompletionValidator {
  private readonly registry: ValidatorRegistry;
  private readonly commandRunner: CommandRunner;
  private readonly paramExtractor: ParamExtractor;
  private readonly ctx: CompletionValidatorContext;

  constructor(
    registry: ValidatorRegistry,
    ctx: CompletionValidatorContext,
  ) {
    this.registry = registry;
    this.ctx = ctx;
    this.commandRunner = new CommandRunner(ctx.workingDir);
    this.paramExtractor = new ParamExtractor();
  }

  /**
   * Validates multiple completion conditions sequentially
   *
   * Returns valid: true only if all conditions succeed.
   * Returns pattern and parameters on the first failing condition.
   */
  async validate(
    conditions: CompletionCondition[],
  ): Promise<ValidatorResult> {
    for (const condition of conditions) {
      const def = this.registry.validators[condition.validator];
      if (!def) {
        this.ctx.logger.warn(`Validator not found: ${condition.validator}`);
        continue;
      }

      // Sequential execution required - need to return early on first failure
      // deno-lint-ignore no-await-in-loop
      const result = await this.runValidator(def, condition.params);

      if (!result.valid) {
        return {
          valid: false,
          pattern: def.failurePattern,
          params: result.params,
          error: result.error,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Executes a single validator
   */
  private async runValidator(
    def: ValidatorDefinition,
    conditionParams?: Record<string, unknown>,
  ): Promise<ValidatorRunResult> {
    switch (def.type) {
      case "command":
        return await this.runCommandValidator(def);
      case "file":
        return this.runFileValidator(def, conditionParams);
      case "custom":
        return await this.runCustomValidator(def, conditionParams);
      default:
        throw new Error(
          `Unknown validator type: ${(def as { type: string }).type}`,
        );
    }
  }

  /**
   * Executes a command-type validator
   */
  private async runCommandValidator(
    def: ValidatorDefinition,
  ): Promise<ValidatorRunResult> {
    if (!def.command) {
      throw new Error("Command validator requires 'command' field");
    }

    this.ctx.logger.debug(`Running command validator: ${def.command}`);

    const result = await this.commandRunner.run(def.command);
    const success = checkSuccessCondition(def.successWhen, result);

    if (success) {
      return { valid: true };
    }

    const params = this.paramExtractor.extract(def.extractParams, result);

    this.ctx.logger.debug(
      `Command validator failed: pattern=${def.failurePattern}`,
    );

    return {
      valid: false,
      params,
      error: result.stderr || result.stdout,
    };
  }

  /**
   * Executes a file-existence validator
   */
  private runFileValidator(
    def: ValidatorDefinition,
    conditionParams?: Record<string, unknown>,
  ): ValidatorRunResult {
    const paths = (conditionParams?.paths as string[]) ?? [];

    if (def.path) {
      paths.push(def.path);
    }

    const missingPaths: string[] = [];

    for (const path of paths) {
      try {
        Deno.statSync(path);
      } catch {
        missingPaths.push(path);
      }
    }

    if (missingPaths.length === 0) {
      return { valid: true };
    }

    this.ctx.logger.debug(
      `File validator failed: missing=${missingPaths.join(", ")}`,
    );

    return {
      valid: false,
      params: {
        missingFiles: missingPaths,
        expectedPath: paths[0],
      },
      error: `Missing files: ${missingPaths.join(", ")}`,
    };
  }

  /**
   * Executes a custom-type validator
   *
   * Custom validators use existing validators implemented
   * in agents/validators/plugins/.
   */
  private async runCustomValidator(
    def: ValidatorDefinition,
    _conditionParams?: Record<string, unknown>,
  ): Promise<ValidatorRunResult> {
    // Custom validators are for future extension
    // Currently falls back to command execution
    if (def.command) {
      return await this.runCommandValidator(def);
    }

    this.ctx.logger.warn(
      `Custom validator without command: ${JSON.stringify(def)}`,
    );
    return { valid: true };
  }
}

/**
 * Factory function for CompletionValidator
 */
export function createCompletionValidator(
  registry: ValidatorRegistry,
  ctx: CompletionValidatorContext,
): CompletionValidator {
  return new CompletionValidator(registry, ctx);
}
