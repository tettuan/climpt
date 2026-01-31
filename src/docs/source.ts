/** JSR source for fetching docs */

import type { Manifest } from "./types.ts";

const PKG = "@aidevtool/climpt";
const BASE = `https://jsr.io/${PKG}`;

export async function getLatestVersion(): Promise<string> {
  const res = await fetch(`${BASE}/meta.json`);
  const meta = await res.json();
  return meta.latest;
}

export async function getManifest(version: string): Promise<Manifest> {
  const res = await fetch(`${BASE}/${version}/docs/manifest.json`);
  return res.json();
}

export async function getContent(
  version: string,
  path: string,
): Promise<string> {
  const res = await fetch(`${BASE}/${version}/docs/${path}`);
  return res.text();
}
