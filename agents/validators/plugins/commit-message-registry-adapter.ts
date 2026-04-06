/**
 * Commit Message Registry Adapter
 *
 * Adapts the commit-message SemanticValidatorPlugin to the pre-close
 * Validator interface used by ValidatorRegistry.
 *
 * The semantic plugin operates on in-memory data (SemanticValidatorContext),
 * while the registry Validator receives a ValidatorContext with workingDir.
 * This adapter bridges the two by extracting commit messages from git log.
 */

import type { Validator, ValidatorContext, ValidatorResult } from "../types.ts";
import { commitMessageValidator } from "./commit-message-validator.ts";
import type { SemanticValidatorContext } from "./semantic-validator.ts";

/**
 * Extract recent commit messages from the working directory.
 *
 * Reads the last 10 commit messages from HEAD. Returns an empty array
 * if the directory is not a git repository or has no commits.
 */
async function getRecentCommitMessages(
  workingDir: string,
): Promise<string[]> {
  try {
    const command = new Deno.Command("git", {
      args: ["log", "--format=%s", "-n", "10"],
      cwd: workingDir,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    if (!output.success) {
      return [];
    }

    const stdout = new TextDecoder().decode(output.stdout);
    return stdout.split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Pre-close Validator adapter for the commit-message semantic plugin.
 *
 * When used via ValidatorRegistry (pre-close validation), this adapter
 * extracts commit messages from git and delegates to the semantic plugin.
 * Without a task description in pre-close context, the validator will
 * only check for generic commit messages.
 */
export const commitMessageRegistryValidator: Validator = {
  id: "commit-message",
  name: "Commit Message Validator",
  description:
    "Checks that commit messages are meaningful and not overly generic",

  async validate(ctx: ValidatorContext): Promise<ValidatorResult> {
    const commitMessages = await getRecentCommitMessages(ctx.workingDir);

    if (commitMessages.length === 0) {
      return { valid: true };
    }

    const semanticContext: SemanticValidatorContext = {
      stepId: ctx.agentId,
      commitMessages,
      // No task description available in pre-close context;
      // the validator will only check for generic messages
      taskDescription: undefined,
    };

    const result = commitMessageValidator.validate(semanticContext);

    if (result.valid) {
      return { valid: true };
    }

    return {
      valid: false,
      error: result.message,
      details: result.severity ? [`severity: ${result.severity}`] : undefined,
    };
  },
};
