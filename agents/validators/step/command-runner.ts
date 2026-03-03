/**
 * Command Runner
 *
 * Command execution utility.
 * Executes commands used by validators and returns results.
 */

import type { CommandResult } from "./types.ts";

/**
 * Command runner
 */
export class CommandRunner {
  constructor(
    private workingDir: string,
  ) {}

  /**
   * Executes a command and returns the result
   */
  async run(command: string): Promise<CommandResult> {
    try {
      const cmd = new Deno.Command("sh", {
        args: ["-c", command],
        cwd: this.workingDir,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await cmd.output();
      const decoder = new TextDecoder();

      return {
        success: output.success,
        exitCode: output.code,
        stdout: decoder.decode(output.stdout),
        stderr: decoder.decode(output.stderr),
      };
    } catch (error) {
      return {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Checks the success condition
 */
export function checkSuccessCondition(
  condition: string,
  result: CommandResult,
): boolean {
  if (condition === "empty") {
    return result.stdout.trim() === "";
  }

  if (condition.startsWith("exitCode:")) {
    const expectedCode = parseInt(condition.split(":")[1], 10);
    return result.exitCode === expectedCode;
  }

  if (condition.startsWith("contains:")) {
    const searchString = condition.substring("contains:".length);
    return result.stdout.includes(searchString);
  }

  if (condition.startsWith("matches:")) {
    const pattern = condition.substring("matches:".length);
    return new RegExp(pattern).test(result.stdout);
  }

  // Unknown condition, treat as failure
  return false;
}
