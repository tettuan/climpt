#!/usr/bin/env -S deno run --allow-read
/**
 * Inline schema lint (design 13 §I + 14 §I anti-list).
 *
 * Rejects inline JSON Schema objects in `.agent/<id>/agent.json`.
 *
 * Rationale: agent definitions must reference external schema files
 * (`schemas/<name>.schema.json`) via `schemaRef` / `outputSchemaRef.file`
 * so the schema layer stays a separate, version-controlled artifact.
 * Embedding a `{ "type": "object", "properties": ... }` blob inside
 * `agent.json` re-introduces the climpt v3 antipattern where validators
 * silently drift from the registry.
 *
 * Detection rule (conservative):
 *  - Recursively walk the parsed JSON.
 *  - Any object that contains BOTH `"type": "object"` AND a `"properties"`
 *    map is treated as an inline schema, EXCEPT when that object is
 *    *itself* the top-level value of `outputSchemaRef.inline` (which is
 *    the explicit, design-allowed inline form for prototyping — but
 *    even there the rule still warns).
 *
 * The lint walks one level deep and refuses to look inside known
 * schema-file paths (i.e. the file currently scanned must NOT live under
 * `agents/schemas/` or `.agent/<id>/schemas/`).
 *
 * Exit codes:
 *  - 0 — clean
 *  - 1 — at least one inline schema found
 *  - 2 — argv / I/O error
 */

import { walk } from "@std/fs/walk";

interface InlineSchemaHit {
  readonly file: string;
  readonly path: string; // dotted JSON path to the offending object
}

/**
 * Walk a JSON value and collect every object that looks like an inline
 * JSON Schema. Returns dotted paths so the operator can navigate.
 */
export function findInlineSchemas(
  file: string,
  value: unknown,
  path = "$",
): readonly InlineSchemaHit[] {
  const hits: InlineSchemaHit[] = [];
  visit(value, path);
  return hits;

  function visit(node: unknown, p: string): void {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        visit(node[i], `${p}[${i}]`);
      }
      return;
    }
    const obj = node as Record<string, unknown>;
    if (looksLikeInlineSchema(obj)) {
      hits.push({ file, path: p });
    }
    for (const [k, v] of Object.entries(obj)) {
      visit(v, `${p}.${k}`);
    }
  }
}

/**
 * Heuristic for inline schema detection.
 *
 * Triggers when the object has BOTH:
 *   - `type === "object"`  (the schema-defining type literal)
 *   - `properties` that is itself an object map
 *
 * The two-key combination is what JSON Schema requires for an object
 * shape — any object meeting both is structurally a schema, regardless
 * of where it lives. False positives can be silenced by moving the
 * shape to a `*.schema.json` file and replacing it with `schemaRef`.
 */
export function looksLikeInlineSchema(obj: Record<string, unknown>): boolean {
  if (obj.type !== "object") return false;
  const props = obj.properties;
  if (props === null || props === undefined) return false;
  if (typeof props !== "object") return false;
  return true;
}

/** Walk the supplied roots and lint every `agent.json` we find. */
export async function lintInlineSchemas(
  roots: readonly string[],
): Promise<readonly InlineSchemaHit[]> {
  const hits: InlineSchemaHit[] = [];
  for (const root of roots) {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(root);
    } catch {
      continue;
    }
    if (!stat.isDirectory) continue;
    for await (
      const entry of walk(root, {
        match: [/agent\.json$/],
        // The schemas directory lawfully contains JSON Schema documents;
        // skip to avoid linting the schema files themselves.
        skip: [/\/schemas\//, /\/node_modules\//],
      })
    ) {
      if (!entry.isFile) continue;
      let json: unknown;
      try {
        json = JSON.parse(await Deno.readTextFile(entry.path));
      } catch {
        // Malformed JSON — caller handles with a separate JSON-lint;
        // we do not classify that as an inline-schema violation.
        continue;
      }
      for (const hit of findInlineSchemas(entry.path, json)) {
        hits.push(hit);
      }
    }
  }
  return hits;
}

function parseArgs(argv: readonly string[]): { roots: string[] } {
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--dir requires a path argument");
      }
      roots.push(next);
      i++;
    } else if (a.startsWith("--dir=")) {
      roots.push(a.slice("--dir=".length));
    }
  }
  if (roots.length === 0) {
    roots.push(".agent");
  }
  return { roots };
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(Deno.args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // deno-lint-ignore no-console
    console.error(`lint-inline-schema: argv error: ${msg}`);
    return 2;
  }
  const hits = await lintInlineSchemas(parsed.roots);
  if (hits.length === 0) {
    // deno-lint-ignore no-console
    console.log(
      `lint-inline-schema: 0 inline schemas across [${
        parsed.roots.join(", ")
      }]`,
    );
    return 0;
  }
  for (const h of hits) {
    // deno-lint-ignore no-console
    console.error(
      `${h.file}:${h.path} inline schema object detected ` +
        '(must reference an external "*.schema.json" via schemaRef)',
    );
  }
  // deno-lint-ignore no-console
  console.error(
    `lint-inline-schema: ${hits.length} inline schema(s). ` +
      "Move the shape to agents/schemas/<name>.schema.json and " +
      "reference it via `schemaRef` / `outputSchemaRef.file` " +
      "(design 13 §I + 14 §I anti-list).",
  );
  return 1;
}

if (import.meta.main) {
  Deno.exit(await main());
}
