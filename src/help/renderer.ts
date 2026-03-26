/**
 * @fileoverview Terminal text renderer for Help protocol nodes
 * @module help/renderer
 */

import type { HelpConstraint, HelpNode, HelpProtocol } from "./types.ts";
import { CLIMPT_VERSION } from "../version.ts";

/** Render root help node for `climpt --help` / `climpt help` */
export function renderRootHelp(node: HelpNode, protocol: HelpProtocol): string {
  const lines: string[] = [];

  lines.push(`Climpt v${CLIMPT_VERSION} — ${node.description}`);
  lines.push("");

  // Construction tree
  if (node.constructionTree) {
    lines.push(node.constructionTree);
    lines.push("");
  }

  // Capabilities (children)
  if (node.children && node.children.length > 0) {
    lines.push("Capabilities:");
    for (const child of node.children) {
      const desc = child.description.length > 68
        ? child.description.slice(0, 65) + "..."
        : child.description;
      lines.push(`  ${child.id.padEnd(15)} ${desc}`);
    }
    lines.push("");
  }

  // Protocol
  lines.push(`Protocol: ${protocol.order}`);
  lines.push("");

  // Usage
  lines.push("Usage:");
  lines.push(
    "  climpt help [capability]     Construction guide (describe/scaffold/validate)",
  );
  lines.push("  climpt [command] [options]    Execute prompt command");
  lines.push("  climpt init                  Initialize configuration");
  lines.push("");

  // Agent runner and workflow
  lines.push("Agent Runner:");
  lines.push("  deno task agent --agent <name> --issue <number>");
  lines.push("");
  lines.push("Workflow Orchestrator:");
  lines.push(
    "  deno task orchestrator --issue <number> [--verbose] [--dry-run]",
  );
  lines.push("");

  // Next action hint
  lines.push("Run 'climpt help <capability>' for detailed construction guide.");

  return lines.join("\n");
}

/** Render detail help node for `climpt help <id>` */
export function renderDetailHelp(node: HelpNode): string {
  const lines: string[] = [];

  // Title
  const title = node.id.charAt(0).toUpperCase() + node.id.slice(1);
  lines.push(`${title} Construction Guide`);
  lines.push("");
  lines.push(node.description);
  lines.push("");

  // Build spec
  if (node.build) {
    lines.push("Files:");
    for (const f of node.build.files) {
      lines.push(`  ${f}`);
    }
    lines.push("");

    lines.push("Parameters:");
    for (const [key, desc] of Object.entries(node.build.params)) {
      lines.push(`  ${key.padEnd(12)} ${desc}`);
    }
    lines.push("");

    if (node.build.context) {
      lines.push("Context:");
      for (const [key, val] of Object.entries(node.build.context)) {
        lines.push(`  ${key.padEnd(16)} ${val}`);
      }
      lines.push("");
    }
  }

  // Edges as components
  const requireEdges = node.edges.filter((e) => e.rel === "requires");
  if (requireEdges.length > 0) {
    lines.push("Components:");
    for (const edge of requireEdges) {
      const shortTarget = edge.target.replace("component:", "");
      lines.push(`  ${shortTarget.padEnd(20)} ${edge.label}`);
    }
    lines.push("");
  }

  // Validation edges
  const validateEdges = node.edges.filter((e) => e.rel === "validates");
  if (validateEdges.length > 0) {
    lines.push("Validation:");
    for (const edge of validateEdges) {
      lines.push(`  ${edge.label}`);
    }
    lines.push("");
  }

  // Constraints
  if (node.constraints && node.constraints.length > 0) {
    lines.push(`Integrity Constraints (${node.constraints.length} rules):`);
    for (const c of node.constraints) {
      lines.push(`  ${c.rule.padEnd(12)} ${formatConstraint(c)}`);
    }
    lines.push("");
  }

  // Next action
  if (node.next) {
    lines.push(
      `Next: ${node.next.action}({ target: "${node.next.target}"${
        node.next.params ? `, params: ${JSON.stringify(node.next.params)}` : ""
      } })`,
    );
    if (node.next.action === "scaffold" && node.next.target === "agent") {
      lines.push(`  → deno task agent --init --agent {name}`);
    }
  }

  return lines.join("\n");
}

/** Format a constraint as a concise one-liner */
function formatConstraint(c: HelpConstraint): string {
  const opSymbol: Record<string, string> = {
    equals: "===",
    contains: "⊇",
    "subset_of": "⊆",
    "maps_to": "→∈",
    references: "→$",
    exists: "∃",
    matches: "~",
  };
  const op = opSymbol[c.operator] ?? c.operator;
  return `${c.from.file} ${c.from.field} ${op} ${c.to.file} ${c.to.field}`;
}
