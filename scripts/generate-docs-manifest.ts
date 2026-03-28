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
  if (
    path.startsWith("mcp-setup") ||
    path.startsWith("prompt-customization-guide") ||
    path.startsWith("c3l_specification") ||
    path.startsWith("C3L-")
  ) {
    return "guides";
  }
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

// --- Extra sources outside docs/ ---

/** Files or directories outside docs/ that should appear in the manifest. */
const EXTRA_SOURCES: Array<{
  /** File or directory path relative to project root. */
  path: string;
  /** Category to assign. */
  category: string;
  /** ID prefix (replaces auto-generated prefix). */
  idPrefix: string;
}> = [
  {
    path: "agents/docs/builder/reference/blueprint",
    category: "reference",
    idPrefix: "blueprint",
  },
  {
    path: "agents/schemas/agent-blueprint.schema.json",
    category: "reference",
    idPrefix: "schema",
  },
];

function generateExtraId(idPrefix: string, filePath: string): string {
  const base = filePath
    .replace(/.*\//, "") // filename only
    .replace(/^\d+-/, "") // strip leading number prefix
    .replace(/\.schema\.json$/, "") // strip .schema.json
    .replace(/\.(?:md|json)$/, "") // strip .md or .json
    .replace(/\./g, "-");
  return `${idPrefix}-${base}`;
}

function extractTitleFromJson(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed.title === "string") return parsed.title;
    if (typeof parsed.$id === "string") return parsed.$id;
  } catch {
    // not JSON
  }
  return undefined;
}

async function collectExtraSource(
  source: typeof EXTRA_SOURCES[number],
): Promise<Entry[]> {
  const stat = await Deno.stat(source.path).catch(() => null);
  if (!stat) return [];

  if (stat.isDirectory) {
    const files: string[] = [];
    for await (
      const file of walk(source.path, {
        exts: [".md", ".json"],
        skip: [/index\.md/],
      })
    ) {
      if (file.isFile) files.push(file.path);
    }
    const contents = await Promise.all(
      files.map((f) => Deno.readTextFile(f)),
    );
    return files.map((filePath, j) => {
      const relPath = relative("docs", filePath);
      return {
        id: generateExtraId(source.idPrefix, filePath),
        path: relPath,
        category: source.category,
        title: filePath.endsWith(".json")
          ? extractTitleFromJson(contents[j])
          : extractTitle(contents[j]),
        bytes: new TextEncoder().encode(contents[j]).length,
      };
    });
  }

  const content = await Deno.readTextFile(source.path);
  const relPath = relative("docs", source.path);
  return [{
    id: generateExtraId(source.idPrefix, source.path),
    path: relPath,
    category: source.category,
    title: source.path.endsWith(".json")
      ? extractTitleFromJson(content)
      : extractTitle(content),
    bytes: new TextEncoder().encode(content).length,
  }];
}

async function main(): Promise<void> {
  const config = JSON.parse(await Deno.readTextFile("deno.json"));
  const entries: Entry[] = [];

  // 1. Scan docs/ directory
  for await (
    const file of walk("docs", {
      exts: [".md"],
      // Manifest targets AI consumers -- English docs suffice.
      // Japanese guides (guides/ja/) are for human reference only.
      // internal/ docs are development-only and not distributed.
      skip: [
        /manifest\.json/,
        /index\.md/,
        /guides\/ja\//,
        /internal\//,
      ],
    })
  ) {
    if (!file.isFile) continue;

    const path = relative("docs", file.path);
    const category = inferCategory(path);
    if (category === "internal") continue;

    const content = await Deno.readTextFile(file.path);

    entries.push({
      id: generateId(path),
      path,
      category,
      lang: inferLang(path),
      title: extractTitle(content),
      bytes: new TextEncoder().encode(content).length,
    });
  }

  // 2. Scan extra sources (blueprint, schemas, etc.)
  const extraEntries = await Promise.all(
    EXTRA_SOURCES.map((source) => collectExtraSource(source)),
  );
  for (const batch of extraEntries) {
    entries.push(...batch);
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
