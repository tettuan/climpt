#!/usr/bin/env -S deno run --allow-net --allow-write --allow-read
/**
 * Climpt Docs CLI
 *
 * Command-line interface for installing and listing Climpt documentation.
 * Downloads documentation from JSR and saves locally as markdown files.
 *
 * @module
 *
 * @example Install all docs
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/docs
 * ```
 *
 * @example Install Japanese guides only
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/docs install ./docs --lang=ja --category=guides
 * ```
 *
 * @example Update to latest version
 * ```bash
 * deno run -Ar jsr:@aidevtool/climpt/docs install ./docs
 * ```
 */

import { parseArgs } from "@std/cli/parse-args";
import { install, list } from "./mod.ts";

const HELP = `
Usage: deno run -A jsr:@aidevtool/climpt/docs [command] [options]

Commands:
  install [dir]   Install docs (default: ./climpt-docs)
  list            List available docs

Options:
  --category=CAT  Filter: guides | reference | internal
  --lang=LANG     Filter: ja | en
  --mode=MODE     Output: preserve | flatten | single
  --version=VER   Specific version (default: latest)
  -h, --help      Show help

Update to latest:
  deno run -Ar jsr:@aidevtool/climpt/docs install ./docs
`;

export async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    boolean: ["help"],
    string: ["category", "lang", "mode", "version"],
    alias: { h: "help" },
  });

  if (args.help) {
    // deno-lint-ignore no-console
    console.log(HELP);
    return;
  }

  const cmd = args._[0]?.toString() ?? "install";

  if (cmd === "list") {
    const { version, entries } = await list(
      args.version,
      args.category,
      args.lang,
    );
    // deno-lint-ignore no-console
    console.log(`\n  @aidevtool/climpt v${version} - ${entries.length} docs\n`);
    for (const e of entries) {
      // deno-lint-ignore no-console
      console.log(`  ${e.id}${e.lang ? ` (${e.lang})` : ""}`);
    }
    return;
  }

  const dir = (cmd === "install" ? args._[1]?.toString() : cmd) ??
    "./climpt-docs";
  const result = await install({
    output: dir,
    version: args.version,
    category: args.category,
    lang: args.lang,
    mode: args.mode as "preserve" | "flatten" | "single",
  });

  // deno-lint-ignore no-console
  console.log(`\n  Installed ${result.installed.length} docs to ${dir}\n`);
}

if (import.meta.main) main();
