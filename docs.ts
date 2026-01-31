/**
 * Climpt Docs Installer
 *
 * Install climpt documentation locally as markdown files.
 *
 * @example CLI
 * ```bash
 * dx jsr:@aidevtool/climpt/docs
 * dx jsr:@aidevtool/climpt/docs install ./docs --lang=ja
 * ```
 *
 * @example API
 * ```typescript
 * import { install, list } from "jsr:@aidevtool/climpt/docs";
 * await install({ output: "./docs", lang: "ja" });
 * ```
 *
 * @module
 */

export { install, list } from "./src/docs/mod.ts";
export type { Entry, Options, Result } from "./src/docs/types.ts";

if (import.meta.main) {
  const { main } = await import("./src/docs/cli.ts");
  await main();
}
