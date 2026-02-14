/**
 * Prompt Adapter - Abstraction for prompt loading
 *
 * Responsibility: Load prompt file content
 * Adapter pattern isolates external dependencies
 */

/**
 * Interface for loading prompts from various sources.
 */
export interface PromptAdapter {
  /**
   * Load prompt content from a path.
   * @param path - Path to the prompt file
   * @returns Prompt content as string
   * @throws PromptNotFoundError if file doesn't exist
   */
  load(path: string): Promise<string>;

  /**
   * Check if a prompt exists at the given path.
   * @param path - Path to check
   * @returns true if prompt exists
   */
  exists(path: string): Promise<boolean>;
}

/**
 * Error thrown when a prompt is not found - canonical source: shared/errors/env-errors.ts
 */
import { PromptNotFoundError } from "../shared/errors/env-errors.ts";
export { PromptNotFoundError };

/**
 * File-based prompt adapter.
 * Reads prompts directly from the filesystem.
 */
export class FilePromptAdapter implements PromptAdapter {
  async load(path: string): Promise<string> {
    try {
      return await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new PromptNotFoundError(path);
      }
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
