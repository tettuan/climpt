/**
 * Loader Invariants — Production-call boundary checks
 *
 * Two structural invariants for the steps_registry.json loading surface:
 *
 *   #11 (R2 single-caller): The untyped loader `loadStepsRegistry` (plural)
 *       at `agents/config/loader.ts` and `agents/shared/config-service.ts`
 *       is exported only to feed the `--validate` CLI's accumulator UX
 *       (R2b in `agents/config/mod.ts`). Any other production caller is a
 *       regression — new code must use the validating singular loader
 *       `loadStepRegistry` from `agents/common/step-registry/loader.ts`.
 *
 *   #13 (No inline parse): Production code MUST NOT `JSON.parse` the
 *       contents of a `steps_registry.json` file directly. The single
 *       sanctioned site is `agents/shared/config-service.ts`'s
 *       `loadStepsRegistry` method. Every other production reader must
 *       go through `loadStepRegistry` so that strict shape validation
 *       runs before any typed access.
 *
 * Pattern: Invariant Test (whole-collection sweep). Both checks walk the
 * full `agents/` tree to guarantee non-vacuity and surface the offending
 * file:line on regression. Test fixtures, schemas, and *_test.ts files
 * are excluded — they are not production code paths.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs/walk";
import { fromFileUrl, relative } from "@std/path";

// =============================================================================
// Repo-root resolution
// =============================================================================
// This test file lives at `<repo>/agents/common/`. Resolve repo root and
// the agents/ root from the file URL so the suite is location-independent.
const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const AGENTS_ROOT = fromFileUrl(new URL("../", import.meta.url));

// =============================================================================
// Walk helpers
// =============================================================================

/**
 * Production .ts files under agents/. Excludes test files, fixtures,
 * docs, and JSON-schema directories — none of which are runtime code.
 */
async function collectProductionTsFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (
    const entry of walk(AGENTS_ROOT, {
      exts: [".ts"],
      includeDirs: false,
      includeSymlinks: false,
    })
  ) {
    const path = entry.path;
    if (path.includes("_test.ts")) continue;
    if (path.includes("/_fixtures/")) continue;
    if (path.includes("/docs/")) continue;
    if (path.includes("/schemas/")) continue;
    files.push(path);
  }
  return files.sort();
}

/** Convert an absolute path to a repo-rooted relative path for diagnostics. */
function toRepoRelative(absPath: string): string {
  return relative(REPO_ROOT, absPath);
}

// =============================================================================
// Invariant #11 — R2 (untyped loader) has exactly one production caller
// =============================================================================

Deno.test(
  "invariant #11: loadStepsRegistry has exactly one production caller (R2b in agents/config/mod.ts)",
  async () => {
    // Definition sites — these declare the function, they don't call it.
    // The grep pattern /\bloadStepsRegistry\s*\(/ matches both call sites
    // and the function-definition signature, so we must subtract them.
    const DEFINITION_SITES = new Set<string>([
      "agents/config/loader.ts",
      "agents/shared/config-service.ts",
    ]);

    // The single sanctioned production caller (R2b in --validate accumulator UX).
    const ALLOWED_CALLERS = ["agents/config/mod.ts"];

    const files = await collectProductionTsFiles();
    const callers: string[] = [];

    for (const absPath of files) {
      const rel = toRepoRelative(absPath);
      if (DEFINITION_SITES.has(rel)) continue;

      const text = await Deno.readTextFile(absPath);
      // Word-boundary + opening paren — matches `loadStepsRegistry(` calls,
      // not `loadStepRegistry` (singular) and not bare identifier mentions
      // in comments/docstrings.
      if (/\bloadStepsRegistry\s*\(/.test(text)) {
        callers.push(rel);
      }
    }

    callers.sort();

    assertEquals(
      callers,
      ALLOWED_CALLERS,
      [
        `R2 invariant violated: loadStepsRegistry (plural, untyped) must have`,
        `exactly one production caller — the --validate accumulator path in`,
        `agents/config/mod.ts (R2b).`,
        ``,
        `Expected callers: ${JSON.stringify(ALLOWED_CALLERS)}`,
        `Actual   callers: ${JSON.stringify(callers)}`,
        ``,
        `Fix: any new caller must use loadStepRegistry (singular) from`,
        `agents/common/step-registry/loader.ts, which performs strict shape`,
        `validation before returning a typed StepRegistry. The untyped plural`,
        `form is reserved for the --validate CLI which intentionally collects`,
        `errors instead of throwing.`,
      ].join("\n"),
    );
  },
);

// =============================================================================
// Invariant #13 — No inline JSON.parse on steps_registry.json in production
// =============================================================================

Deno.test(
  "invariant #13: only agents/shared/config-service.ts JSON.parses steps_registry content",
  async () => {
    // The single sanctioned site: ConfigService.loadStepsRegistry implementation.
    const ALLOWED_SITES = ["agents/shared/config-service.ts"];

    const files = await collectProductionTsFiles();
    const offenders: Array<{ file: string; line: number; snippet: string }> =
      [];

    for (const absPath of files) {
      const text = await Deno.readTextFile(absPath);
      const lines = text.split("\n");

      for (let i = 0; i < lines.length; i++) {
        // Match `JSON.parse(` exactly. Comment text like "JSON parse failure"
        // (no dot) is correctly ignored.
        if (!/JSON\.parse\(/.test(lines[i])) continue;

        // Look at the 10-line window: the line itself + 9 preceding lines.
        // If the window mentions either the path string `steps_registry` or
        // the constant name `STEPS_REGISTRY`, classify as a candidate.
        const start = Math.max(0, i - 9);
        const window = lines.slice(start, i + 1).join("\n");
        if (
          window.includes("steps_registry") ||
          window.includes("STEPS_REGISTRY")
        ) {
          offenders.push({
            file: toRepoRelative(absPath),
            line: i + 1,
            snippet: lines[i].trim(),
          });
        }
      }
    }

    const offenderFiles = Array.from(
      new Set(offenders.map((o) => o.file)),
    ).sort();

    assertEquals(
      offenderFiles,
      ALLOWED_SITES,
      [
        `Invariant #13 violated: production code must not JSON.parse`,
        `steps_registry.json content directly. The sanctioned site is`,
        `ConfigService.loadStepsRegistry in agents/shared/config-service.ts.`,
        ``,
        `Expected sites: ${JSON.stringify(ALLOWED_SITES)}`,
        `Actual   sites: ${JSON.stringify(offenderFiles)}`,
        ``,
        `Offending matches:`,
        ...offenders.map((o) => `  - ${o.file}:${o.line}  ${o.snippet}`),
        ``,
        `Fix: replace inline JSON.parse with loadStepRegistry from`,
        `agents/common/step-registry/loader.ts, which validates the raw`,
        `shape (design 14 §B/§C) before exposing the typed StepRegistry.`,
      ].join("\n"),
    );
  },
);
