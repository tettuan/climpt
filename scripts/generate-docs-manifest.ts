#!/usr/bin/env -S deno run --allow-read --allow-write
/** Generate docs/manifest.json from docs directory */

import { walk } from "@std/fs/walk";
import { relative } from "@std/path";

interface Entry {
  id: string;
  path: string;
  category: string;
  lang?: string;
  title?: string;
  bytes: number;
}

function generateId(path: string): string {
  return path
    .replace(/\.md$/, "")
    .replace(/\//g, "-")
    .replace(/^\d+-/, "");
}

function inferCategory(path: string): string {
  if (path.startsWith("guides/")) return "guides";
  if (path.startsWith("reference/")) return "reference";
  return "internal";
}

function inferLang(path: string): string | undefined {
  if (path.includes("/ja/")) return "ja";
  if (path.includes("/en/")) return "en";
  return undefined;
}

function extractTitle(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1];
}

async function main(): Promise<void> {
  const config = JSON.parse(await Deno.readTextFile("deno.json"));
  const entries: Entry[] = [];

  for await (
    const file of walk("docs", {
      exts: [".md"],
      skip: [/manifest\.json/, /index\.md/, /guides\/ja\//, /reference\//],
    })
  ) {
    if (!file.isFile) continue;

    const path = relative("docs", file.path);
    const content = await Deno.readTextFile(file.path);

    entries.push({
      id: generateId(path),
      path,
      category: inferCategory(path),
      lang: inferLang(path),
      title: extractTitle(content),
      bytes: new TextEncoder().encode(content).length,
    });
  }

  entries.sort((a, b) =>
    a.category.localeCompare(b.category) || a.id.localeCompare(b.id)
  );

  const manifest = { version: config.version, entries };
  await Deno.writeTextFile(
    "docs/manifest.json",
    JSON.stringify(manifest, null, 2),
  );

  // deno-lint-ignore no-console
  console.log(`Generated docs/manifest.json (${entries.length} entries)`);
}

if (import.meta.main) main();
