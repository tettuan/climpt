/**
 * Schema contract tests for `deferred_items[]` in `closure.consider`.
 *
 * Source of truth: `.agent/considerer/schemas/considerer.schema.json`.
 *
 * These tests verify the schema's acceptance / rejection behavior and the
 * structural AC from issue #480 ("labels 含む", "title non-empty"). The
 * schema is loaded at runtime — no expected shape is hardcoded beyond what
 * issue #480 AC literally states.
 *
 * Test pattern: Validator-as-boundary (see test-design skill).
 * - Acceptance: valid instance ⇒ schema.validate passes
 * - Rejection:  invalid instance ⇒ schema.validate fails with a diagnostic
 *               that names the offending path
 * - Structural: the schema declares the AC-required fields
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { Ajv } from "npm:ajv@^8.17.1";

// =============================================================================
// Source of truth: load schema from disk — never hardcode its contents.
// =============================================================================

const SCHEMA_PATH = fromFileUrl(
  new URL(
    "../../.agent/considerer/schemas/considerer.schema.json",
    import.meta.url,
  ),
);

interface RawSchema {
  $schema?: string;
  $id?: string;
  "closure.consider": Record<string, unknown>;
}

async function loadCloseConsiderSchema(): Promise<Record<string, unknown>> {
  const raw = JSON.parse(await Deno.readTextFile(SCHEMA_PATH)) as RawSchema;
  assert(
    raw["closure.consider"],
    `Schema at ${SCHEMA_PATH} is missing top-level "closure.consider" key. ` +
      `Fix: restore the schema or update SCHEMA_PATH in this test.`,
  );
  return raw["closure.consider"];
}

function compileValidator(schema: Record<string, unknown>) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

/** Minimal instance satisfying `closure.consider`'s required-fields contract. */
function baseInstance(): Record<string, unknown> {
  return {
    stepId: "consider",
    status: "completed",
    summary: "Answered",
    next_action: { action: "closing" },
    verdict: "done",
  };
}

// =============================================================================
// I3 — Structural AC: deferred_items field with labels, title non-empty
// (issue #480 AC bullet 1: "schema 定義が追加済み (labels 含む)")
// =============================================================================

Deno.test(
  "schema structural AC: deferred_items defines title/body/labels with title minLength>=1",
  async () => {
    const schema = await loadCloseConsiderSchema();
    // deno-lint-ignore no-explicit-any
    const di = (schema as any).properties?.deferred_items;
    assert(
      di,
      "closure.consider.properties.deferred_items must exist. " +
        `Fix: update ${SCHEMA_PATH} per issue #480 AC bullet 1.`,
    );
    assertEquals(
      di.type,
      "array",
      "deferred_items must be an array type. Fix: schema.",
    );

    const itemProps = di.items?.properties;
    assert(
      itemProps,
      "deferred_items.items.properties is required. " +
        "Fix: declare title/body/labels under items.properties.",
    );
    // All three AC fields declared
    for (const field of ["title", "body", "labels"]) {
      assert(
        itemProps[field],
        `deferred_items.items.properties.${field} missing. ` +
          `Fix: add it to ${SCHEMA_PATH} (issue #480 AC requires labels 含む).`,
      );
    }
    // title non-empty — required for "must describe a real task"
    assertEquals(
      itemProps.title.minLength,
      1,
      "deferred_items.items.properties.title.minLength must be 1. " +
        "Fix: add minLength to prevent empty-title issue creation.",
    );
    // labels is array of strings
    assertEquals(
      itemProps.labels.type,
      "array",
      "deferred_items.items.properties.labels.type must be 'array'.",
    );
    assertEquals(
      itemProps.labels.items?.type,
      "string",
      "deferred_items.items.properties.labels.items.type must be 'string'.",
    );
    // required bundles all three
    const required: string[] = di.items.required ?? [];
    for (const field of ["title", "body", "labels"]) {
      assert(
        required.includes(field),
        `deferred_items.items.required must include "${field}". ` +
          `Currently: [${required.join(", ")}]. Fix: schema.`,
      );
    }
  },
);

// =============================================================================
// I1 — Acceptance: valid instances pass (empty array, populated, orthogonal
// to both verdicts). Issue #480 AC bullet 4: "empty / populated 両方を検証".
// =============================================================================

Deno.test("schema accepts instance without deferred_items (backward-compat baseline)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const instance = baseInstance();
  const ok = validate(instance);
  assertEquals(
    ok,
    true,
    `Valid baseline rejected: ${JSON.stringify(validate.errors)}. ` +
      `Fix: restore backward-compat — deferred_items must be optional.`,
  );
});

Deno.test("schema accepts instance with empty deferred_items array", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({ ...baseInstance(), deferred_items: [] });
  assertEquals(
    ok,
    true,
    `Empty deferred_items rejected: ${JSON.stringify(validate.errors)}. ` +
      `Fix: remove minItems if present; default [] must validate.`,
  );
});

Deno.test("schema accepts instance with populated deferred_items (done verdict)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    verdict: "done",
    deferred_items: [
      { title: "Phase 2", body: "body2", labels: ["kind:impl"] },
      {
        title: "Phase 3",
        body: "body3",
        labels: ["kind:consider", "enhancement"],
      },
    ],
  });
  assertEquals(
    ok,
    true,
    `Populated deferred_items rejected on 'done': ${
      JSON.stringify(validate.errors)
    }. Fix: deferred_items must be orthogonal to verdict.`,
  );
});

Deno.test("schema accepts populated deferred_items on handoff-detail verdict (orthogonal)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    verdict: "handoff-detail",
    final_summary: "recap",
    handoff_anchor: { file: "a.ts", symbol: null, strategy: null },
    deferred_items: [
      { title: "followup", body: "b", labels: [] },
    ],
  });
  assertEquals(
    ok,
    true,
    `Populated deferred_items rejected on 'handoff-detail': ${
      JSON.stringify(validate.errors)
    }. Fix: deferred_items must be allowed alongside handoff_anchor.`,
  );
});

Deno.test("schema accepts deferred_items with empty labels array", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [{ title: "t", body: "b", labels: [] }],
  });
  assertEquals(
    ok,
    true,
    `Empty labels rejected: ${JSON.stringify(validate.errors)}. ` +
      `Fix: labels.minItems must not be >0; 0 labels is a valid pre-triage state.`,
  );
});

// =============================================================================
// I2 — Rejection: invalid instances caught. Verify the validator names the
// offending instancePath so operators can diagnose.
// =============================================================================

Deno.test("schema rejects deferred_items with empty title (minLength=1 enforced)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [{ title: "", body: "b", labels: [] }],
  });
  assertEquals(
    ok,
    false,
    "Empty title must be rejected. Fix: schema title minLength=1.",
  );
  const paths = (validate.errors ?? []).map((e) => e.instancePath);
  assert(
    paths.some((p) => p.includes("/deferred_items/0/title")),
    `Expected an error pointing to /deferred_items/0/title, got: ${
      paths.join(", ")
    }. Fix: schema diagnostic quality.`,
  );
});

Deno.test("schema rejects deferred_items entry missing title", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [{ body: "b", labels: [] }],
  });
  assertEquals(ok, false, "Missing required field title must be rejected.");
});

Deno.test("schema rejects deferred_items entry missing body", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [{ title: "t", labels: [] }],
  });
  assertEquals(ok, false, "Missing required field body must be rejected.");
});

Deno.test("schema rejects deferred_items entry missing labels", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [{ title: "t", body: "b" }],
  });
  assertEquals(ok, false, "Missing required field labels must be rejected.");
});

Deno.test("schema rejects extra properties inside deferred_items entry (additionalProperties=false)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      { title: "t", body: "b", labels: [], unexpected: "nope" },
    ],
  });
  assertEquals(
    ok,
    false,
    "Unknown property inside a deferred_items entry must be rejected — " +
      "otherwise agents can silently smuggle fields. " +
      "Fix: keep additionalProperties=false on the item schema.",
  );
});

Deno.test("schema rejects deferred_items as non-array (type=array enforced)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({ ...baseInstance(), deferred_items: "oops" });
  assertEquals(ok, false, "Non-array deferred_items must be rejected.");
});
