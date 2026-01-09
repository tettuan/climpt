/**
 * File action handler - writes or appends to files
 */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  type ActionContext,
  type ActionResult,
  BaseActionHandler,
  type DetectedAction,
} from "../types.ts";

export class FileActionHandler extends BaseActionHandler {
  constructor(type: string) {
    super(type);
  }

  async execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult> {
    const { content, metadata } = action;
    const filename = (metadata.filename as string) ?? "output.md";
    const mode = (metadata.mode as "write" | "append") ?? "append";

    const filePath = filename.startsWith("/")
      ? filename
      : join(context.cwd, filename);

    try {
      // Ensure directory exists
      await ensureDir(dirname(filePath));

      if (mode === "append") {
        await Deno.writeTextFile(filePath, content + "\n", { append: true });
      } else {
        await Deno.writeTextFile(filePath, content);
      }

      context.logger.info(`[Action: ${action.type}] File written`, {
        path: filePath,
        mode,
      });

      return this.success(action, { path: filePath, mode });
    } catch (error) {
      return this.failure(
        action,
        `Failed to write file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
