/**
 * Valid category values for document entries.
 * Source of truth — keep in sync with scripts/generate-docs-manifest.ts
 * (inferCategory + EXTRA_SOURCES).
 */
export const VALID_CATEGORIES = [
  "guides",
  "reference",
  "internal",
  "builder-guides",
] as const;

/** Category type derived from VALID_CATEGORIES */
export type Category = (typeof VALID_CATEGORIES)[number];

/** Document entry */
export interface Entry {
  id: string;
  path: string;
  category: Category;
  lang?: "ja" | "en";
  title?: string;
  bytes?: number;
}

/** Manifest (docs/manifest.json) */
export interface Manifest {
  version: string;
  entries: Entry[];
}

/** Install options */
export interface Options {
  output: string;
  version?: string;
  category?: string;
  lang?: string;
  mode?: "preserve" | "flatten" | "single";
}

/** Install result */
export interface Result {
  version: string;
  installed: string[];
  failed: string[];
}
