/** File system writer */

import type { Entry } from "./types.ts";

export function getOutputPath(
  entry: Entry,
  outputDir: string,
  mode: "preserve" | "flatten" | "single",
): string {
  if (mode === "flatten") return `${outputDir}/${entry.id}.md`;
  if (mode === "single") return `${outputDir}/climpt-docs.md`;
  return `${outputDir}/${entry.path}`;
}

export async function writeFile(path: string, content: string): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, content);
}

export async function writeCombined(
  path: string,
  entries: Array<{ entry: Entry; content: string }>,
): Promise<void> {
  const combined = entries
    .map(({ entry, content }) => `# ${entry.title ?? entry.id}\n\n${content}`)
    .join("\n\n---\n\n");
  await writeFile(path, combined);
}
