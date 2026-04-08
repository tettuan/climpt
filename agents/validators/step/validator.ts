/**
 * StepValidator
 *
 * Validates step validation conditions and returns pattern and parameters on failure.
 */

import type {
  StepValidatorContext,
  ValidationCondition,
  ValidatorDefinition,
  ValidatorRegistry,
  ValidatorResult,
  ValidatorRunResult,
} from "./types.ts";
import { checkSuccessCondition, CommandRunner } from "./command-runner.ts";
import { ParamExtractor } from "./param-extractors.ts";
import type {
  SemanticValidatorContext,
  SemanticValidatorPlugin,
} from "../plugins/semantic-validator.ts";
import { commitMessageValidator } from "../plugins/commit-message-validator.ts";

// ---------------------------------------------------------------------------
// Semantic plugin registry
// ---------------------------------------------------------------------------

/**
 * Registry of available semantic validator plugins, keyed by checkType.
 *
 * New plugins are added here. The StepValidator dispatches to the
 * appropriate plugin based on ValidatorDefinition.semanticConfig.checkType.
 */
const semanticPlugins = new Map<string, SemanticValidatorPlugin>();

/**
 * Register a semantic validator plugin.
 *
 * @param plugin The plugin to register
 * @throws Error if a plugin with the same name is already registered
 */
export function registerSemanticPlugin(plugin: SemanticValidatorPlugin): void {
  if (semanticPlugins.has(plugin.name)) {
    throw new Error(
      `Semantic plugin '${plugin.name}' is already registered`,
    );
  }
  semanticPlugins.set(plugin.name, plugin);
}

/**
 * Get a semantic validator plugin by name.
 */
export function getSemanticPlugin(
  name: string,
): SemanticValidatorPlugin | undefined {
  return semanticPlugins.get(name);
}

/**
 * List all registered semantic plugins.
 */
export function listSemanticPlugins(): SemanticValidatorPlugin[] {
  return Array.from(semanticPlugins.values());
}

/**
 * Clear all semantic plugins (for testing).
 * @internal
 */
export function clearSemanticPlugins(): void {
  semanticPlugins.clear();
}

/**
 * Reset semantic plugins to built-in defaults (for testing).
 * @internal
 */
export function resetSemanticPlugins(): void {
  semanticPlugins.clear();
  initializeBuiltinSemanticPlugins();
}

/**
 * Initialize built-in semantic plugins.
 */
function initializeBuiltinSemanticPlugins(): void {
  if (!semanticPlugins.has(commitMessageValidator.name)) {
    semanticPlugins.set(commitMessageValidator.name, commitMessageValidator);
  }
}

// Initialize on module load
initializeBuiltinSemanticPlugins();

// ---------------------------------------------------------------------------
// StepValidator
// ---------------------------------------------------------------------------

/**
 * StepValidator
 *
 * Validates step conditions and returns information for pattern-based
 * retry prompt generation on failure.
 */
export class StepValidator {
  private readonly registry: ValidatorRegistry;
  private readonly commandRunner: CommandRunner;
  private readonly paramExtractor: ParamExtractor;
  private readonly ctx: StepValidatorContext;

  constructor(
    registry: ValidatorRegistry,
    ctx: StepValidatorContext,
  ) {
    this.registry = registry;
    this.ctx = ctx;
    this.commandRunner = new CommandRunner(ctx.workingDir);
    this.paramExtractor = new ParamExtractor();
  }

  /**
   * Validates multiple validation conditions sequentially
   *
   * Returns valid: true only if all conditions succeed.
   * Returns pattern and parameters on the first failing condition.
   */
  async validate(
    conditions: ValidationCondition[],
  ): Promise<ValidatorResult> {
    for (const condition of conditions) {
      const def = this.registry.validators[condition.validator];
      if (!def) {
        throw new Error(
          `Validator not found: "${condition.validator}". Check that this validator is defined in the registry's "validators" section.`,
        );
      }

      // Sequential execution required - need to return early on first failure
      // deno-lint-ignore no-await-in-loop
      const result = await this.runValidator(def, condition.params);

      if (!result.valid) {
        return {
          valid: false,
          pattern: def.failurePattern,
          params: result.params,
          semanticParams: result.semanticParams,
          error: result.error,
          recoverable: result.recoverable,
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
      case "semantic":
        return this.runSemanticValidator(def, conditionParams);
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
    const semanticParams = this.paramExtractor.extractSemantic(
      def.extractParams,
      result,
      params,
    );

    this.ctx.logger.debug(
      `Command validator failed: pattern=${def.failurePattern}`,
    );

    // Classify recoverability
    const recoverable = classifyRecoverable(
      result.exitCode,
      result.stderr,
      def.recoverableByDefault,
    );

    return {
      valid: false,
      params,
      semanticParams,
      error: result.stderr || result.stdout,
      recoverable,
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

  /**
   * Executes a semantic-type validator
   *
   * Dispatches to the appropriate SemanticValidatorPlugin based on
   * the semanticConfig.checkType in the validator definition.
   *
   * Condition params may supply context fields:
   *   - taskDescription: string
   *   - changedFiles: string[]
   *   - commitMessages: string[]
   */
  private runSemanticValidator(
    def: ValidatorDefinition,
    conditionParams?: Record<string, unknown>,
  ): ValidatorRunResult {
    const checkType = def.semanticConfig?.checkType;
    if (!checkType) {
      this.ctx.logger.warn(
        `Semantic validator missing semanticConfig.checkType: ${
          JSON.stringify(def)
        }`,
      );
      return { valid: true };
    }

    const plugin = getSemanticPlugin(checkType);
    if (!plugin) {
      this.ctx.logger.warn(
        `Semantic plugin not found for checkType: ${checkType}`,
      );
      return { valid: true };
    }

    // Build context from condition params
    const context: SemanticValidatorContext = {
      stepId: this.ctx.agentId ?? "unknown",
      taskDescription: conditionParams?.taskDescription as string | undefined,
      changedFiles: conditionParams?.changedFiles as string[] | undefined,
      commitMessages: conditionParams?.commitMessages as string[] | undefined,
    };

    this.ctx.logger.debug(
      `Running semantic validator: ${plugin.name}`,
    );

    const result = plugin.validate(context);

    if (result.valid) {
      return { valid: true };
    }

    this.ctx.logger.debug(
      `Semantic validator failed: plugin=${plugin.name}, severity=${
        result.severity ?? "warning"
      }`,
    );

    return {
      valid: false,
      error: result.message,
      // Semantic validators always produce recoverable results
      // (they are advisory, not blocking)
      recoverable: true,
    };
  }
}

/**
 * Classify whether a command validator failure is recoverable.
 *
 * Unrecoverable conditions:
 * - Exit code 126: permission denied (cannot execute)
 * - Exit code 127: command not found
 * - stderr contains "EACCES" or "Permission denied"
 *
 * All other failures (test failures, lint errors, etc.) are recoverable.
 * Falls back to the validator's `recoverableByDefault` setting, or `true`.
 */
export function classifyRecoverable(
  exitCode: number,
  stderr: string,
  recoverableByDefault?: boolean,
): boolean {
  // Exit code 126: permission denied (cannot execute)
  // Exit code 127: command not found
  if (exitCode === 126 || exitCode === 127) {
    return false;
  }

  // Check stderr for unrecoverable patterns
  if (
    stderr.includes("EACCES") ||
    stderr.includes("Permission denied")
  ) {
    return false;
  }

  // Fall back to validator-level default, then true
  return recoverableByDefault ?? true;
}

/**
 * Factory function for StepValidator
 */
export function createStepValidator(
  registry: ValidatorRegistry,
  ctx: StepValidatorContext,
): StepValidator {
  return new StepValidator(registry, ctx);
}
