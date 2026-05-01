/**
 * Unit tests for tools/lint-inline-schema.ts (T6.3).
 *
 * Source of truth: design 13 §I + 14 §I anti-list — agent.json must
 * reference external `*.schema.json` files via `schemaRef`, not embed
 * `{ "type": "object", "properties": ... }` shapes directly.
 *
 * Test design follows .claude/rules/test-design.md:
 *  - Contract test (positive): an agent.json with `schemaRef` only
 *    yields zero hits.
 *  - Contract test (negative): an agent.json with an inline schema
 *    yields ≥1 hit AND identifies the JSON path.
 *  - Conformance test: the helper accepts both `properties` as
 *    `{}` (empty) and `{ a: {} }` (populated) — both are still inline.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import {
  findInlineSchemas,
  lintInlineSchemas,
  looksLikeInlineSchema,
} from "./lint-inline-schema.ts";

Deno.test("lint-inline-schema: schemaRef-only agent.json is clean", () => {
  const json = {
    name: "agent-x",
    runner: {
      flow: { prompts: { schemaRef: "schemas/output.schema.json" } },
    },
  };
  const hits = findInlineSchemas("/tmp/agent.json", json);
  assertEquals(
    hits.length,
    0,
    "schemaRef-only structure must produce zero hits. " +
      "Fix: tools/lint-inline-schema.ts looksLikeInlineSchema heuristic.",
  );
});

Deno.test("lint-inline-schema: inline {type:object, properties:{}} is detected", () => {
  const json = {
    name: "agent-y",
    runner: {
      output: {
        type: "object",
        properties: { verdict: { type: "string" } },
      },
    },
  };
  const hits = findInlineSchemas("/tmp/agent.json", json);
  assertEquals(
    hits.length,
    1,
    "Inline { type:'object', properties:{} } must yield exactly one hit",
  );
  assertEquals(
    hits[0].path,
    "$.runner.output",
    "Hit path must point to the offending object via dotted JSON path. " +
      "Fix: findInlineSchemas path accumulation.",
  );
});

Deno.test("lint-inline-schema: looksLikeInlineSchema requires both type and properties", () => {
  // Conformance: the heuristic is intentionally narrow — `type` alone or
  // `properties` alone must NOT trigger, otherwise legitimate
  // configuration objects (e.g. `{ properties: { ... } }` for runtime
  // metadata) would false-positive.
  assertEquals(looksLikeInlineSchema({ type: "object" }), false);
  assertEquals(
    looksLikeInlineSchema({ properties: { a: {} } } as Record<
      string,
      unknown
    >),
    false,
  );
  assertEquals(
    looksLikeInlineSchema({ type: "string", properties: {} } as Record<
      string,
      unknown
    >),
    false,
    "type must equal 'object' (not just any string) for the inline-schema rule",
  );
  assertEquals(
    looksLikeInlineSchema({ type: "object", properties: {} } as Record<
      string,
      unknown
    >),
    true,
    "Empty properties still counts as an inline schema shape — its " +
      "presence (not population) is what design 13 §I forbids.",
  );
});

Deno.test("lint-inline-schema: walks an .agent-style directory", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const dirty = join(tmp, "dirty");
    await Deno.mkdir(dirty);
    await Deno.writeTextFile(
      join(dirty, "agent.json"),
      JSON.stringify({
        name: "dirty",
        runner: {
          output: {
            type: "object",
            properties: { x: { type: "number" } },
          },
        },
      }),
    );
    const clean = join(tmp, "clean");
    await Deno.mkdir(clean);
    await Deno.writeTextFile(
      join(clean, "agent.json"),
      JSON.stringify({
        name: "clean",
        runner: { flow: { prompts: { schemaRef: "schemas/x.schema.json" } } },
      }),
    );
    // Sibling schema file under schemas/ — must be skipped by the walker
    // (otherwise it would self-trigger on legitimate JSON Schema files).
    await Deno.mkdir(join(tmp, "schemas"));
    await Deno.writeTextFile(
      join(tmp, "schemas", "x.schema.json"),
      JSON.stringify({ type: "object", properties: { a: {} } }),
    );
    const hits = await lintInlineSchemas([tmp]);
    assertEquals(
      hits.length,
      1,
      "Walker must report dirty/agent.json only. Got " + hits.length + ": " +
        JSON.stringify(hits),
    );
    assertEquals(
      hits[0].file.endsWith(join("dirty", "agent.json")),
      true,
      "Hit file must be dirty/agent.json. Got: " + hits[0].file,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("lint-inline-schema: malformed JSON does not raise (treated as separate concern)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const a = join(tmp, "broken");
    await Deno.mkdir(a);
    await Deno.writeTextFile(join(a, "agent.json"), "{ this is not json");
    const hits = await lintInlineSchemas([tmp]);
    assertEquals(
      hits.length,
      0,
      "Malformed JSON is a JSON-lint concern, not an inline-schema " +
        "concern. lintInlineSchemas must skip parse failures silently.",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
