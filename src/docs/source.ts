/** JSR source for fetching docs */

import type { Manifest } from "./types.ts";

const PKG = "@aidevtool/climpt";
const BASE = `https://jsr.io/${PKG}`;
const FETCH_TIMEOUT_MS = 30_000;

export async function getLatestVersion(): Promise<string> {
  const url = `${BASE}/meta.json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Failed to fetch latest version: ${res.status} ${url}`);
  }
  const meta = await res.json();
  return meta.latest;
}

export async function getManifest(version: string): Promise<Manifest> {
  const url = `${BASE}/${version}/docs/manifest.json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Failed to fetch manifest: ${res.status} ${url}`);
  }
  return res.json();
}

export async function getContent(
  version: string,
  path: string,
): Promise<string> {
  const url = `${BASE}/${version}/docs/${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Failed to fetch content: ${res.status} ${url}`);
  }
  return res.text();
}
