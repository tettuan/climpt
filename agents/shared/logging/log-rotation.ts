/**
 * Log Rotation
 *
 * Extracted from agents/common/logger.ts.
 * Handles automatic cleanup of old log files in a directory.
 */

import { join } from "@std/path";

/**
 * Rotate log files in a directory, keeping only the most recent ones.
 *
 * @param logDir - Directory containing log files
 * @param maxFiles - Maximum number of files to keep
 * @param extension - File extension to match (default: ".jsonl")
 */
export async function rotateLogFiles(
  logDir: string,
  maxFiles: number,
  extension = ".jsonl",
): Promise<void> {
  const files: Array<{ name: string; mtime: Date | null }> = [];

  try {
    for await (const entry of Deno.readDir(logDir)) {
      if (entry.isFile && entry.name.endsWith(extension)) {
        const filePath = join(logDir, entry.name);
        const stat = await Deno.stat(filePath);
        files.push({
          name: entry.name,
          mtime: stat.mtime,
        });
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }

  // Sort by modification time (oldest first)
  files.sort((a, b) => {
    if (!a.mtime || !b.mtime) return 0;
    return a.mtime.getTime() - b.mtime.getTime();
  });

  // Delete oldest files if count exceeds maxFiles
  const filesToDelete = files.length - maxFiles + 1; // +1 for new file about to be created
  if (filesToDelete > 0) {
    const deletePromises = files.slice(0, filesToDelete).map(async (file) => {
      const filePath = join(logDir, file.name);
      try {
        await Deno.remove(filePath);
      } catch (error) {
        // deno-lint-ignore no-console
        console.warn(`Failed to delete old log file ${filePath}:`, error);
      }
    });
    await Promise.all(deletePromises);
  }
}
