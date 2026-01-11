/**
 * Climpt Adapter - Prompt loading using Climpt CLI
 *
 * Responsibility: Load prompts via Climpt CLI calls
 * Side effects: External command execution
 *
 * Climpt is a wrapper for the breakdown package,
 * providing C3L (Category 3 Level) format prompt retrieval
 */

import { PromptAdapter, PromptNotFoundError } from "./adapter.ts";

/**
 * C3L reference structure for Climpt prompts.
 */
export interface ClimptReference {
  /** Category 1 (e.g., "to") */
  c1: string;
  /** Category 2 (e.g., "issue") */
  c2: string;
  /** Category 3 (e.g., "create") */
  c3: string;
  /** Optional edition */
  edition?: string;
}

/**
 * Climpt CLI based prompt adapter.
 */
export class ClimptAdapter implements PromptAdapter {
  constructor(
    private readonly basePath?: string,
  ) {}

  /**
   * Load prompt using Climpt CLI.
   * Path format: "c1/c2/c3" or "c1/c2/c3:edition"
   */
  async load(path: string): Promise<string> {
    const ref = this.parseReference(path);

    try {
      const args = ["--c1", ref.c1, "--c2", ref.c2, "--c3", ref.c3];
      if (ref.edition) {
        args.push("--edition", ref.edition);
      }
      if (this.basePath) {
        args.push("--base", this.basePath);
      }

      const command = new Deno.Command("climpt", {
        args,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await command.output();

      if (!output.success) {
        const stderr = new TextDecoder().decode(output.stderr);
        if (stderr.includes("not found") || stderr.includes("does not exist")) {
          throw new PromptNotFoundError(path);
        }
        throw new Error(`Climpt command failed: ${stderr}`);
      }

      return new TextDecoder().decode(output.stdout);
    } catch (error) {
      if (error instanceof PromptNotFoundError) throw error;
      if (error instanceof Deno.errors.NotFound) {
        throw new Error("climpt CLI not found. Please install climpt.");
      }
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.load(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse path string to C3L reference.
   * Supports "c1/c2/c3" format or "c1/c2/c3:edition" format.
   */
  private parseReference(path: string): ClimptReference {
    const [pathPart, edition] = path.split(":");
    const parts = pathPart.split("/");

    if (parts.length !== 3) {
      throw new Error(
        `Invalid C3L path format: ${path}. Expected "c1/c2/c3" or "c1/c2/c3:edition"`,
      );
    }

    return {
      c1: parts[0],
      c2: parts[1],
      c3: parts[2],
      edition,
    };
  }
}

/**
 * Convert ClimptReference to path string.
 */
export function toClimptPath(ref: ClimptReference): string {
  const path = `${ref.c1}/${ref.c2}/${ref.c3}`;
  return ref.edition ? `${path}:${ref.edition}` : path;
}
