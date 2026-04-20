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

// =============================================================================
// I2b — Rejection: maxItems cap (issue #513).
// Schema must reject arrays exceeding the per-cycle cap. Boundary value
// analysis: 10 items accepted, 11 items rejected.
// =============================================================================

Deno.test("schema accepts deferred_items with exactly 10 items (boundary)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const items = Array.from({ length: 10 }, (_, i) => ({
    title: `task-${i}`,
    body: `body-${i}`,
    labels: ["kind:impl"],
  }));
  const ok = validate({ ...baseInstance(), deferred_items: items });
  assertEquals(
    ok,
    true,
    `10 items must be accepted (at cap boundary): ${
      JSON.stringify(validate.errors)
    }. Fix: maxItems must be >= 10.`,
  );
});

Deno.test("schema rejects deferred_items with 11 items (maxItems exceeded)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const items = Array.from({ length: 11 }, (_, i) => ({
    title: `task-${i}`,
    body: `body-${i}`,
    labels: ["kind:impl"],
  }));
  const ok = validate({ ...baseInstance(), deferred_items: items });
  assertEquals(
    ok,
    false,
    "11 items must be rejected by maxItems cap. " +
      "Fix: add maxItems: 10 to deferred_items in considerer.schema.json.",
  );
  const paths = (validate.errors ?? []).map((e) => e.instancePath);
  assert(
    paths.some((p) => p.includes("/deferred_items")),
    `Expected an error pointing to /deferred_items, got: ${
      paths.join(", ")
    }. Fix: schema diagnostic quality.`,
  );
});

// =============================================================================
// P1 — Projects field three-form semantics (issue #509).
// Source of truth: considerer.schema.json deferred_items.items.properties.projects
//
// Three valid forms:
//   1. Absent  → inherit parent's projects (default)
//   2. []      → explicit opt-out
//   3. [{…}]   → explicit list (owner/number OR id)
// =============================================================================

Deno.test("schema accepts deferred_item with projects absent (inherit form)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      {
        title: "Inherit task",
        body: "inherits parent projects",
        labels: ["kind:impl"],
      },
    ],
  });
  assertEquals(
    ok,
    true,
    `Projects-absent item rejected: ${JSON.stringify(validate.errors)}. ` +
      `Fix: projects must be optional in deferred_items item schema.`,
  );
});

Deno.test("schema accepts deferred_item with projects empty array (opt-out form)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      {
        title: "Opt-out task",
        body: "no project binding",
        labels: ["kind:impl"],
        projects: [],
      },
    ],
  });
  assertEquals(
    ok,
    true,
    `Projects-empty-array item rejected: ${JSON.stringify(validate.errors)}. ` +
      `Fix: empty array must be a valid projects value (opt-out semantics).`,
  );
});

Deno.test("schema accepts deferred_item with projects owner/number (explicit form)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      {
        title: "Explicit task",
        body: "bound to specific project",
        labels: ["kind:impl"],
        projects: [{ owner: "tettuan", number: 3 }],
      },
    ],
  });
  assertEquals(
    ok,
    true,
    `Projects with {owner,number} rejected: ${
      JSON.stringify(validate.errors)
    }. ` +
      `Fix: oneOf must include the {owner,number} variant.`,
  );
});

Deno.test("schema accepts deferred_item with projects id (explicit form)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      {
        title: "ID-ref task",
        body: "bound by project node ID",
        labels: ["kind:consider"],
        projects: [{ id: "PVT_kwHOAxxxxxxx" }],
      },
    ],
  });
  assertEquals(
    ok,
    true,
    `Projects with {id} rejected: ${JSON.stringify(validate.errors)}. ` +
      `Fix: oneOf must include the {id} variant.`,
  );
});

Deno.test("schema accepts deferred_item with mixed project refs in one array", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      {
        title: "Mixed refs task",
        body: "both ref forms in one array",
        labels: ["kind:impl"],
        projects: [
          { owner: "tettuan", number: 5 },
          { id: "PVT_kwHOBxxxxxxx" },
        ],
      },
    ],
  });
  assertEquals(
    ok,
    true,
    `Mixed project refs rejected: ${JSON.stringify(validate.errors)}. ` +
      `Fix: projects.items.oneOf must allow both variants coexisting in the array.`,
  );
});

// =============================================================================
// P2 — Projects field rejection: invalid shapes (issue #509).
// =============================================================================

Deno.test("schema rejects projects as string (type=array enforced)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      { title: "t", body: "b", labels: [], projects: "PVT_invalid" },
    ],
  });
  assertEquals(
    ok,
    false,
    "projects as string must be rejected. Fix: projects.type must be 'array'.",
  );
  const paths = (validate.errors ?? []).map((e) => e.instancePath);
  assert(
    paths.some((p) => p.includes("/deferred_items/0/projects")),
    `Expected an error pointing to /deferred_items/0/projects, got: ${
      paths.join(", ")
    }. Fix: schema diagnostic quality.`,
  );
});

Deno.test("schema rejects projects as number (type=array enforced)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      { title: "t", body: "b", labels: [], projects: 42 },
    ],
  });
  assertEquals(
    ok,
    false,
    "projects as number must be rejected. Fix: projects.type must be 'array'.",
  );
});

Deno.test("schema rejects projects item with empty owner (minLength enforced)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      {
        title: "t",
        body: "b",
        labels: [],
        projects: [{ owner: "", number: 1 }],
      },
    ],
  });
  assertEquals(
    ok,
    false,
    "Empty owner must be rejected. Fix: owner.minLength must be 1.",
  );
});

Deno.test("schema rejects projects item with zero number (minimum enforced)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      {
        title: "t",
        body: "b",
        labels: [],
        projects: [{ owner: "x", number: 0 }],
      },
    ],
  });
  assertEquals(
    ok,
    false,
    "number=0 must be rejected. Fix: number.minimum must be 1.",
  );
});

Deno.test("schema rejects projects item with empty id (minLength enforced)", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      { title: "t", body: "b", labels: [], projects: [{ id: "" }] },
    ],
  });
  assertEquals(
    ok,
    false,
    "Empty id must be rejected. Fix: id.minLength must be 1.",
  );
});

Deno.test("schema rejects projects item matching neither oneOf variant", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);
  const ok = validate({
    ...baseInstance(),
    deferred_items: [
      { title: "t", body: "b", labels: [], projects: [{ unknown: "field" }] },
    ],
  });
  assertEquals(
    ok,
    false,
    "Project item with unknown shape must be rejected by oneOf. " +
      "Fix: projects.items.oneOf must require {owner,number} or {id}.",
  );
});

// =============================================================================
// P3 — Prompt fixture: full considerer output with all three projects forms
// validates against schema (issue #509 AC bullet 2).
// =============================================================================

Deno.test("prompt fixture with all three projects forms validates against schema", async () => {
  const schema = await loadCloseConsiderSchema();
  const validate = compileValidator(schema);

  // Fixture: a considerer output that carves off three follow-up tasks, each
  // using a different projects form (absent, empty, explicit).
  const fixture = {
    stepId: "consider",
    status: "completed",
    summary: "Answered: three-form projects fixture",
    next_action: { action: "closing" },
    verdict: "done",
    deferred_items: [
      // Form 1: absent — inherits parent projects
      {
        title: "Inherit parent projects",
        body: "Uses default inheritance",
        labels: ["kind:impl"],
      },
      // Form 2: empty array — opt-out
      {
        title: "No project binding",
        body: "Explicitly opts out",
        labels: ["kind:consider"],
        projects: [],
      },
      // Form 3: explicit list with both ref variants
      {
        title: "Explicit project binding",
        body: "Bound to specific projects",
        labels: ["kind:impl"],
        projects: [
          { owner: "tettuan", number: 3 },
          { id: "PVT_kwHOCxxxxxxx" },
        ],
      },
    ],
  };

  const ok = validate(fixture);
  assertEquals(
    ok,
    true,
    `Prompt fixture with all three projects forms rejected: ${
      JSON.stringify(validate.errors)
    }. Fix: schema must accept absent, empty, and explicit projects forms coexisting.`,
  );

  // Non-vacuity: verify the fixture actually has all three forms
  const items = fixture.deferred_items;
  assertEquals(
    items.length,
    3,
    "Fixture must contain exactly 3 items (one per form).",
  );
  assert(
    !("projects" in items[0]),
    "First item must have projects absent (inherit form).",
  );
  assertEquals(
    (items[1].projects as unknown[]).length,
    0,
    "Second item must have empty projects array (opt-out form).",
  );
  assert(
    (items[2].projects as unknown[]).length > 0,
    "Third item must have non-empty projects array (explicit form).",
  );
});
