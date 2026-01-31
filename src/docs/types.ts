/** Document entry */
export interface Entry {
  id: string;
  path: string;
  category: "guides" | "reference" | "internal";
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
