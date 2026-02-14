/**
 * Git Errors - Errors related to git operations
 */

import { ClimptError } from "./base.ts";

/**
 * Git command error
 *
 * This error is thrown when a git command fails.
 */
export class GitCommandError extends ClimptError {
  readonly code = "GIT_COMMAND_ERROR";
  readonly recoverable = false;
  readonly args: string[];
  readonly exitCode: number;
  readonly stderr: string;

  constructor(args: string[], stderr: string, exitCode = 1) {
    super(`Git command failed: git ${args.join(" ")}\n${stderr}`);
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      args: this.args,
      exitCode: this.exitCode,
      stderr: this.stderr,
    };
  }
}
