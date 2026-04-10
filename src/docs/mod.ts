/**
 * @module Climpt Docs Installer
 *
 * ```bash
 * dx jsr:@aidevtool/climpt/docs install ./docs --lang=ja
 * ```
 */

import type { Entry, Options, Result } from "./types.ts";
import { getContent, getLatestVersion, getManifest } from "./source.ts";
import { filterEntries } from "./resolver.ts";
import { getOutputPath, writeCombined, writeFile } from "./writer.ts";

export type { Entry, Options, Result };

const FETCH_CONCURRENCY = 10;

/** Run async fn over items with bounded concurrency, returning settled results. */
async function settledConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    // Intentional: bounded concurrency requires sequential await per chunk
    // deno-lint-ignore no-await-in-loop
    results.push(...await Promise.allSettled(chunk.map(fn)));
  }
  return results;
}

/** Install docs to local filesystem */
export async function install(options: Options): Promise<Result> {
  const version = options.version ?? (await getLatestVersion());
  const manifest = await getManifest(version);
  const entries = filterEntries(
    manifest.entries,
    options.category,
    options.lang,
  );
  const mode = options.mode ?? "preserve";

  const result: Result = { version, installed: [], failed: [] };

  if (mode === "single") {
    const results = await settledConcurrent(
      entries,
      FETCH_CONCURRENCY,
      async (entry) => ({
        entry,
        content: await getContent(version, entry.path),
      }),
    );

    const collected: Array<{ entry: Entry; content: string }> = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        collected.push(r.value);
      } else {
        result.failed.push(entries[i].id);
      }
    }

    const path = `${options.output}/climpt-docs.md`;
    await writeCombined(path, collected);
    result.installed.push(path);
  } else {
    const results = await settledConcurrent(
      entries,
      FETCH_CONCURRENCY,
      async (entry) => {
        const content = await getContent(version, entry.path);
        const path = getOutputPath(entry, options.output, mode);
        await writeFile(path, content);
        return { entry, path };
      },
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        result.installed.push(r.value.path);
      } else {
        result.failed.push(entries[i].id);
      }
    }
  }

  return result;
}

/** List available docs */
export async function list(
  version?: string,
  category?: string,
  lang?: string,
): Promise<{ version: string; entries: Entry[] }> {
  const ver = version ?? (await getLatestVersion());
  const manifest = await getManifest(ver);
  return {
    version: ver,
    entries: filterEntries(manifest.entries, category, lang),
  };
}
