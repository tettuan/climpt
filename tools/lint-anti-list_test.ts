/**
 * Unit tests for tools/lint-anti-list.ts (T6.3).
 *
 * Source of truth: design 13 §I + 14 §I anti-list — `--edition` and
 * `--adaptation` MUST NOT appear in `agents/scripts/`.
 *
 * Test design follows .claude/rules/test-design.md:
 *  - Contract test (positive): a clean source returns 0 violations.
 *  - Contract test (negative): a polluted source returns ≥1 violation
 *    AND points to the exact line/column.
 *  - Conformance test: the allow-marker escape hatch suppresses
 *    detection on the same line only.
 *
 * Diagnosability: every assertion message names the violated rule and
 * the file to fix.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import {
  FORBIDDEN_FLAGS,
  lintAntiList,
  scanSource,
} from "./lint-anti-list.ts";

Deno.test("lint-anti-list: clean source produces zero violations", () => {
  const src = [
    'parseArgs(Deno.args, { string: ["issue", "branch"] });',
    "// comment with no flags",
  ].join("\n");
  const v = scanSource("/tmp/clean.ts", src);
  assertEquals(
    v.length,
    0,
    "Clean source must yield zero violations. Fix: tools/lint-anti-list.ts scanSource",
  );
});

Deno.test("lint-anti-list: --edition flag is detected with file/line/column", () => {
  const src = [
    "// line 1",
    'const args = parseArgs(Deno.args, { string: ["edition", "--edition"] });',
  ].join("\n");
  const v = scanSource("/tmp/dirty.ts", src);
  assertEquals(
    v.length,
    1,
    "Source containing the literal --edition flag must yield exactly one violation",
  );
  assertEquals(v[0].flag, "--edition");
  assertEquals(
    v[0].line,
    2,
    "Violation must point to line 2 (1-based). Fix: scanSource line indexing",
  );
});

Deno.test("lint-anti-list: --adaptation flag is detected", () => {
  const src = `parseArgs(Deno.args, { string: ["--adaptation"] });`;
  const v = scanSource("/tmp/d.ts", src);
  assertEquals(v.length, 1);
  assertEquals(v[0].flag, "--adaptation");
});

Deno.test("lint-anti-list: allow-marker on the same line suppresses the violation", () => {
  const src =
    `parseArgs(Deno.args, { string: ["--edition"] }); // lint-anti-list:allow --edition`;
  const v = scanSource("/tmp/allow.ts", src);
  assertEquals(
    v.length,
    0,
    "Same-line allow-marker must suppress the violation. " +
      "Fix: scanSource ALLOW_MARKER handling.",
  );
});

Deno.test("lint-anti-list: allow-marker on a DIFFERENT line does NOT suppress", () => {
  const src = [
    "// lint-anti-list:allow --edition",
    `parseArgs(Deno.args, { string: ["--edition"] });`,
  ].join("\n");
  const v = scanSource("/tmp/cross.ts", src);
  assertEquals(
    v.length,
    1,
    "Allow-marker is line-scoped; cross-line suppression is forbidden. " +
      "Fix: scanSource must restrict ALLOW_MARKER to the same line.",
  );
});

Deno.test("lint-anti-list: walks a directory and ignores _test.ts files", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tmp, "ok.ts"),
      "// no flags here\n",
    );
    await Deno.writeTextFile(
      join(tmp, "bad.ts"),
      `parseArgs(Deno.args, ["--edition"]);\n`,
    );
    // _test.ts deliberately contains the literal flag (e.g. for an
    // assertion fixture); the walker must skip it so the lint does not
    // self-trigger when scanning its own test directory.
    await Deno.writeTextFile(
      join(tmp, "fixture_test.ts"),
      `parseArgs(Deno.args, ["--edition"]);\n`,
    );
    const v = await lintAntiList([tmp]);
    assertEquals(
      v.length,
      1,
      "Walker must report bad.ts (1 hit) and skip fixture_test.ts. " +
        "Fix: lintAntiList walker `skip` regex must match _test.ts.",
    );
    assertEquals(v[0].flag, "--edition");
    assertEquals(
      v[0].file.endsWith("bad.ts"),
      true,
      "Violation file path must end with bad.ts. Got: " + v[0].file,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("lint-anti-list: forbidden flag list is exactly [--edition, --adaptation]", () => {
  // Conformance test: the lint's source-of-truth (FORBIDDEN_FLAGS) must
  // match design 13 §I + 14 §I exactly. Adding or removing a flag here
  // requires updating the design doc and the runner ADR.
  assertEquals(
    [...FORBIDDEN_FLAGS],
    ["--edition", "--adaptation"],
    "FORBIDDEN_FLAGS must equal design 13 §I anti-list. " +
      "Fix: tools/lint-anti-list.ts FORBIDDEN_FLAGS constant + design doc.",
  );
});
