/**
 * @fileoverview CLI help module
 * @module help/mod
 *
 * Provides construction guidance via CLI.
 * Replaces the static showHelp() with graph-driven help.
 */

import { DETAIL_NODES, HELP_PROTOCOL, ROOT_NODE } from "./graph.ts";
import { renderDetailHelp, renderRootHelp } from "./renderer.ts";

/**
 * Show help for the given capability ID, or root help if no ID given.
 *
 * @param id - Optional capability ID (e.g., "agent", "prompt", "orchestrator")
 */
export function showHelp(id?: string): void {
  let output: string;

  if (!id) {
    output = renderRootHelp(ROOT_NODE, HELP_PROTOCOL);
  } else {
    // Look up in detail nodes first, then root children
    const node = DETAIL_NODES[id] ??
      ROOT_NODE.children?.find((c) => c.id === id);
    if (!node) {
      const valid = ROOT_NODE.children?.map((c) => c.id).join(", ") ?? "";
      // deno-lint-ignore no-console
      console.error(`Unknown capability: ${id}. Valid: ${valid}`);
      Deno.exit(1);
    }
    output = renderDetailHelp(node);
  }

  // deno-lint-ignore no-console
  console.log(output);
}
