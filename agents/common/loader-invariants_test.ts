/**
 * Loader Invariants — Production-call boundary checks
 *
 * Three structural invariants for the steps_registry.json loading surface:
 *
 *   #11 (R2 single-caller): The untyped loader `loadStepsRegistry` (plural)
 *       is exported only to feed the `--validate` CLI's accumulator UX
 *       (R2b in `agents/config/mod.ts`). The lone delegation hop in
 *       `agents/config/loader.ts` re-exports the ConfigService method to
 *       preserve the historical import path. Any other production caller
 *       is a regression — new code must use the validating singular loader
 *       `loadStepRegistry` from `agents/common/step-registry/loader.ts`.
 *
 *   #13 (No inline parse): Production code MUST NOT `JSON.parse` the
 *       contents of a `steps_registry.json` file directly. The single
 *       sanctioned site is `agents/shared/config-service.ts:122` inside
 *       `ConfigService.loadStepsRegistry`. Every other production reader
 *       must go through `loadStepRegistry` so that strict shape validation
 *       runs before any typed access.
 *
 *   #N6 (opt-out cap): The discriminated `RegistryLoaderOptOutOptions`
 *       variant (`validateIntentEnums: false`) is reserved for callers
 *       that resolve `schemasDir` post-load and re-run
 *       `validateIntentSchemaEnums` themselves. The single sanctioned site
 *       is `agents/runner/closure-manager.ts`. Any other caller passing
 *       `validateIntentEnums: false` to `loadStepRegistry` is a regression:
 *       it disables enum validation by convention and CI was previously
 *       silent (T29 hardened the type, T39 hardens CI enforcement).
 *
 * Pattern: Invariant Test (whole-collection sweep). All checks walk the
 * full `agents/` tree to guarantee non-vacuity and surface the offending
 * file:line on regression. Test fixtures, schemas, and *_test.ts files
 * are excluded — they are not production code paths.
 *
 * Non-vacuity proof: helper functions are exported and re-run against a
 * synthetic temp tree containing a deliberate violation. The synthetic
 * runs assert that the detection actually fires — the green-on-real-tree
 * result is therefore not a vacuous pass.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs/walk";
import { fromFileUrl, join, relative } from "@std/path";

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
 * Production .ts files under a given root. Excludes test files, fixtures,
 * docs, and JSON-schema directories — none of which are runtime code.
 *
 * Exported so synthetic-violation tests can target a temp tree.
 */
export async function collectProductionTsFiles(
  walkRoot: string,
): Promise<string[]> {
  const files: string[] = [];
  for await (
    const entry of walk(walkRoot, {
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

/** Convert an absolute path to a path relative to the given root. */
function toRelative(absPath: string, root: string): string {
  return relative(root, absPath);
}

// =============================================================================
// Comment stripping
// =============================================================================

/**
 * Strip line (`//`) and block (`/* ... *\/`) comments from source. The
 * stripped text preserves line count (each removed line is replaced by an
 * empty line) so that downstream line-number diagnostics stay accurate.
 *
 * Heuristic-grade: does not honor strings/regexp containing comment-like
 * sequences. Adequate for the JSON.parse / loadStepsRegistry detection
 * surface, where mentions live in code, not string literals.
 */
export function stripComments(source: string): string {
  // Block comments first — replace with same-length newline run.
  const blockStripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    const newlineCount = (m.match(/\n/g) ?? []).length;
    return "\n".repeat(newlineCount);
  });
  // Line comments — strip from `//` to end of line, preserve line break.
  return blockStripped.replace(/\/\/[^\n]*/g, "");
}

// =============================================================================
// Definition-range detection (invariant #11)
// =============================================================================

/**
 * Locate the lines that BELONG TO the function/method signature for a
 * `loadStepsRegistry` definition (export function or class method). The
 * walker stops at the FIRST `{` (body opens) OR `;` (overload terminator) —
 * whichever comes first. This makes the helper overload-aware: each
 * overload signature claims only its own line range, never bleeding into
 * the next overload or into the body.
 *
 * Rationale (critique-5 B#4 + critique-6 N#1): file-level skip would hide
 * a future second function in the same file that calls the plural form;
 * the older `\)...\{` walker silently consumed overload pairs whole because
 * the `;`-terminated header has no `{`. Stopping at the first `{` or `;`
 * narrows the blind spot to exactly the declarator.
 *
 * @param lines  Source file split on `\n`
 * @returns 0-based line indices that are part of a signature header
 */
export function findLoadStepsRegistrySignatureLines(
  lines: string[],
): Set<number> {
  const skip = new Set<number>();
  // Match either `function loadStepsRegistry(` or class-method
  // `loadStepsRegistry(` at the start of a non-comment line. Excludes
  // call-shaped patterns like `configService.loadStepsRegistry(` because
  // the leading `\b` after a `.` would still match — so we anchor on
  // `(function\s+|^\s+(async\s+)?)loadStepsRegistry\s*\(`.
  const sigStart =
    /^(\s*export\s+(async\s+)?function\s+loadStepsRegistry\s*\()|(^\s+(async\s+|public\s+|private\s+|protected\s+)*loadStepsRegistry\s*\()/;
  // Match `)` (param-list close) followed by optional return-type
  // annotation, then either `{` (body open) or `;` (overload terminator).
  // Restricting to "after `)`" avoids tripping on `;` inside an inline
  // object-type parameter annotation like `{ a: string; b: number }`.
  const sigEnd = /\)\s*(:\s*[^{;]+)?\s*[{;]/;
  for (let i = 0; i < lines.length; i++) {
    if (!sigStart.test(lines[i])) continue;
    let j = i;
    while (j < lines.length) {
      skip.add(j);
      if (sigEnd.test(lines[j])) break;
      j++;
    }
  }
  return skip;
}

// =============================================================================
// Invariant #11 — caller scan
// =============================================================================

/**
 * Scan production files under `walkRoot` for any line that calls the
 * plural `loadStepsRegistry(...)` outside its own signature header.
 * Comments are stripped before matching so JSDoc mentions don't count.
 *
 * Returns repo-relative paths (relative to `walkRoot`) of the offenders.
 * The caller decides which paths are sanctioned.
 */
export async function scanLoadStepsRegistryCallers(
  walkRoot: string,
): Promise<string[]> {
  const files = await collectProductionTsFiles(walkRoot);
  const callers: string[] = [];
  // `g` flag so we can count occurrences per line (signature self-ref vs
  // nested delegation). Recreated per use because `lastIndex` is stateful.
  const callRe = /\bloadStepsRegistry\s*\(/g;
  // Lines that carry the signature's own name occurrence (`function
  // loadStepsRegistry(` or class-method `loadStepsRegistry(`). Exactly
  // these lines may legitimately contain ONE self-reference; param
  // continuation lines may contain none.
  const selfRefRe =
    /^(\s*export\s+(async\s+)?function\s+loadStepsRegistry\s*\()|(^\s+(async\s+|public\s+|private\s+|protected\s+)*loadStepsRegistry\s*\()/;
  for (const absPath of files) {
    const text = await Deno.readTextFile(absPath);
    const stripped = stripComments(text);
    const lines = stripped.split("\n");
    const skip = findLoadStepsRegistrySignatureLines(lines);
    let detected = false;
    for (let i = 0; i < lines.length && !detected; i++) {
      const matches = lines[i].match(callRe) ?? [];
      if (matches.length === 0) continue;
      // critique-6 N#1 + N#8: skip-membership alone is too coarse. A
      // signature header line carries ONE self-reference (the function
      // name itself); param-continuation lines carry ZERO. Nested calls
      // beyond this allowance are real delegation regressions and must
      // count, even inside the signature window.
      const allowance = skip.has(i) && selfRefRe.test(lines[i]) ? 1 : 0;
      if (matches.length > allowance) {
        callers.push(toRelative(absPath, walkRoot));
        detected = true;
      }
    }
  }
  callers.sort();
  return callers;
}

Deno.test(
  "invariant #11: loadStepsRegistry callers are exactly the sanctioned 2 (delegation hop + R2b)",
  async () => {
    // Two sanctioned callers:
    //   - agents/config/loader.ts        : delegation hop to ConfigService
    //   - agents/config/mod.ts           : R2b --validate accumulator UX
    // Any third caller is a regression.
    const ALLOWED_CALLERS = [
      "agents/config/loader.ts",
      "agents/config/mod.ts",
    ];

    const callers = await scanLoadStepsRegistryCallers(AGENTS_ROOT);
    // Convert agents-relative paths returned by scanner into repo-relative
    // paths so the diagnostic message matches developer mental model.
    const repoRelative = callers.map((p) =>
      relative(REPO_ROOT, join(AGENTS_ROOT, p))
    ).sort();

    assertEquals(
      repoRelative,
      ALLOWED_CALLERS,
      [
        `R2 invariant violated: loadStepsRegistry (plural, untyped) must be`,
        `called only from the sanctioned 2 sites — the delegation hop in`,
        `agents/config/loader.ts and the --validate accumulator path in`,
        `agents/config/mod.ts (R2b).`,
        ``,
        `Expected callers: ${JSON.stringify(ALLOWED_CALLERS)}`,
        `Actual   callers: ${JSON.stringify(repoRelative)}`,
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
// Invariant #13 — JSON.parse scan
// =============================================================================

/**
 * Scan production files under `walkRoot` for inline `JSON.parse(` of
 * steps_registry content. Whole-file mention scope: if any line in the
 * comment-stripped source mentions `steps_registry` or `STEPS_REGISTRY`,
 * every `JSON.parse(...)` in that file is surfaced as a candidate. The
 * caller asserts against an exact allowlist of file:line tuples.
 *
 * Rationale (critique-5 B#4): the previous 10-line lookback window let
 * helper-resolved paths and >10-line preprocessing escape detection.
 * Whole-file mention scope catches both — at the cost of pulling in
 * co-resident parses for unrelated config files (e.g., agent.json in
 * ConfigService). Those are sanctioned via the line-precise allowlist.
 */
export async function scanInlineStepsRegistryJsonParse(
  walkRoot: string,
): Promise<Array<{ file: string; line: number; snippet: string }>> {
  const files = await collectProductionTsFiles(walkRoot);
  const offenders: Array<{ file: string; line: number; snippet: string }> = [];
  const mentionRe = /steps_registry|STEPS_REGISTRY/;
  for (const absPath of files) {
    const text = await Deno.readTextFile(absPath);
    const stripped = stripComments(text);
    if (!mentionRe.test(stripped)) continue;

    const lines = stripped.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/JSON\.parse\(/.test(lines[i])) continue;
      offenders.push({
        file: toRelative(absPath, walkRoot),
        line: i + 1,
        snippet: lines[i].trim(),
      });
    }
  }
  return offenders;
}

Deno.test(
  "invariant #13: only agents/shared/config-service.ts:122 JSON.parses steps_registry content (with co-resident agent.json/config.json parses sanctioned)",
  async () => {
    // file:line tuples — line-precise allowlist. Whole-file mention scope
    // pulls in all JSON.parse calls of any file that references
    // `steps_registry` / `STEPS_REGISTRY`. ConfigService is such a file
    // because it imports `PATHS.STEPS_REGISTRY`. The sanctioned site for
    // *steps_registry* parsing is :122 (inside `loadStepsRegistry`).
    // The other two (:69 agent.json, :96 config.json) are co-resident
    // parses for unrelated config files — sanctioned because they are
    // load surfaces for distinct schemas, locked here so a 4th JSON.parse
    // in this file would still trip the test.
    const ALLOWED_TUPLES = [
      "agents/shared/config-service.ts:122",
      "agents/shared/config-service.ts:69",
      "agents/shared/config-service.ts:96",
    ].sort();

    const offendersAgentRel = await scanInlineStepsRegistryJsonParse(
      AGENTS_ROOT,
    );
    const offenderTuples = offendersAgentRel
      .map((o) => {
        const repoRel = relative(REPO_ROOT, join(AGENTS_ROOT, o.file));
        return `${repoRel}:${o.line}`;
      })
      .sort();
    // De-duplicate while preserving line precision (same file:line should
    // only appear once anyway, but guard against future helper edits).
    const uniqueTuples = Array.from(new Set(offenderTuples));

    assertEquals(
      uniqueTuples,
      ALLOWED_TUPLES,
      [
        `Invariant #13 violated: production code must not JSON.parse`,
        `steps_registry.json content directly. The sanctioned site is`,
        `ConfigService.loadStepsRegistry at agents/shared/config-service.ts:122.`,
        ``,
        `Expected sites: ${JSON.stringify(ALLOWED_TUPLES)}`,
        `Actual   sites: ${JSON.stringify(uniqueTuples)}`,
        ``,
        `Offending matches:`,
        ...offendersAgentRel.map((o) => {
          const repoRel = relative(REPO_ROOT, join(AGENTS_ROOT, o.file));
          return `  - ${repoRel}:${o.line}  ${o.snippet}`;
        }),
        ``,
        `Fix: replace inline JSON.parse with loadStepRegistry from`,
        `agents/common/step-registry/loader.ts, which validates the raw`,
        `shape (design 14 §B/§C) before exposing the typed StepRegistry.`,
      ].join("\n"),
    );
  },
);

// =============================================================================
// Invariant #N6 — validateIntentEnums opt-out caller scan
// =============================================================================

/**
 * Allowed callers for the `validateIntentEnums: false` opt-out variant.
 * Paths are repo-relative (relative to `<repo>/`). The sole sanctioned
 * site is `closure-manager`, which resolves `schemasDir` from a cwd-rooted
 * `.agent/<name>/schemas` *after* `loadStepRegistry` returns and runs
 * `validateIntentSchemaEnums` itself. Any other caller is a regression.
 *
 * Exported so the synthetic-violation test can reuse the constant.
 */
export const ALLOWED_OPT_OUT_CALLERS: readonly string[] = [
  "agents/runner/closure-manager.ts",
] as const;

/**
 * Scan production files under `walkRoot` for any caller that passes
 * `validateIntentEnums: false` as an *object-literal value* — i.e., a
 * caller of `loadStepRegistry` opting out of strict enum validation.
 *
 * Type-declaration sites (`validateIntentEnums: false;` inside an
 * interface/type body) are NOT counted: a trailing `;` belongs to a TS
 * field declaration, while caller object literals close with `,` `)` or
 * `}`. The discriminator is precise — a future caller cannot dodge the
 * scan by reformatting because all valid object-literal terminators are
 * matched, and the type definition itself is the *only* legitimate `;`
 * site (`agents/common/step-registry/types.ts:RegistryLoaderOptOutOptions`).
 *
 * Multi-line caller form is matched: the `\s*` between `false` and the
 * terminator spans newlines, so a caller written as
 *   { validateIntentEnums: false\n  }
 * trips the scan exactly like the same-line `false }`. The scanner runs
 * the regex against the whole comment-stripped file text (not line-by-
 * line) — the previous line-by-line variant required terminator on the
 * same line and missed multi-line forms (T43 / critique-7 N#3).
 *
 * Comments are stripped before matching so JSDoc / inline mentions of
 * `validateIntentEnums:false` (which appear in `loader.ts` and `types.ts`
 * documentation blocks) do not trigger detection.
 *
 * Returns repo-relative paths (relative to `walkRoot`) of the offenders.
 * The caller asserts the result against `ALLOWED_OPT_OUT_CALLERS`.
 */
export async function scanValidateIntentEnumsOptOutCallers(
  walkRoot: string,
): Promise<string[]> {
  const files = await collectProductionTsFiles(walkRoot);
  // Match `validateIntentEnums: false` followed by an object-literal
  // terminator (`,`, `}`, or `)`). Excludes type-declaration form
  // (`validateIntentEnums: false;`) because `;` is not in the terminator
  // class. `\s*` matches arbitrary whitespace including newlines, so
  // multi-line caller forms (terminator on a later line) are detected.
  const optOutRe = /\bvalidateIntentEnums\s*:\s*false\s*[,)}]/;
  const callers: string[] = [];
  for (const absPath of files) {
    const text = await Deno.readTextFile(absPath);
    const stripped = stripComments(text);
    // Whole-file scan: `\s*` in the regex spans newlines, so a single
    // `test()` against the full stripped text catches both same-line and
    // multi-line caller forms. File-level (not line-level) detection is
    // sufficient — the assertion compares file paths, not line numbers.
    if (optOutRe.test(stripped)) {
      callers.push(toRelative(absPath, walkRoot));
    }
  }
  callers.sort();
  return callers;
}

Deno.test(
  "invariant: validateIntentEnums opt-out is restricted to closure-manager (T39 / critique-6 N#6)",
  async () => {
    // The opt-out variant `RegistryLoaderOptOutOptions` is a deliberately
    // narrow escape hatch: enum validation is deferred to the caller, who
    // commits to running `validateIntentSchemaEnums` post-load. Any new
    // caller silently disables the validating loader — exactly the wedge
    // T29 closed at the type level. T39 closes the CI gap so a convention-
    // only opt-out can no longer slip past review.
    const callers = await scanValidateIntentEnumsOptOutCallers(AGENTS_ROOT);
    // Convert agents-relative paths returned by the scanner into repo-
    // relative paths so the diagnostic message matches developer mental
    // model and aligns with `ALLOWED_OPT_OUT_CALLERS`.
    const repoRelative = callers
      .map((p) => relative(REPO_ROOT, join(AGENTS_ROOT, p)))
      .sort();

    assertEquals(
      repoRelative,
      [...ALLOWED_OPT_OUT_CALLERS].sort(),
      [
        `Opt-out cap violated: validateIntentEnums:false is reserved for`,
        `callers that resolve schemasDir post-load and run`,
        `validateIntentSchemaEnums themselves. The sole sanctioned site is`,
        `agents/runner/closure-manager.ts.`,
        ``,
        `Expected callers: ${JSON.stringify(ALLOWED_OPT_OUT_CALLERS)}`,
        `Actual   callers: ${JSON.stringify(repoRelative)}`,
        ``,
        `Fix: omit \`validateIntentEnums\` (or set it to true) and pass a`,
        `\`schemasDir\` so the loader runs strict enum validation. The`,
        `discriminated \`RegistryLoaderStrictOptions\` variant requires`,
        `\`schemasDir: string\` at the type level; picking the opt-out`,
        `variant only makes sense if you genuinely cannot resolve`,
        `\`schemasDir\` until after the load completes.`,
      ].join("\n"),
    );
  },
);

// =============================================================================
// Invariant #N7 — allowMissing opt-in caller scan (T42 / critique-7 N#1 + NEW#1)
// =============================================================================

/**
 * Allowed callers for the `allowMissing: true` opt-in. Paths are repo-
 * relative (relative to `<repo>/`). The three sanctioned sites are
 * domains that legitimately treat an absent registry as "no step graph"
 * and accept a fabricated empty registry:
 *
 *  - `agents/runner/builder.ts` — PromptResolver factory only consumes
 *    `c1` for prompt path suffixing; an empty registry is sufficient.
 *  - `agents/config/agent-bundle-loader.ts` — `loadTypedSteps` projection
 *    collapses to `{ steps: [], entryStep: "" }` for an empty registry.
 *  - `agents/verdict/factory.ts` — non-`detect:graph` verdict handlers
 *    do not consume the step graph, so an empty registry suffices.
 *
 * Any other caller is a regression. T38 added the `allowMissing` opt-in
 * symmetric to `validateIntentEnums`, but did not bring forward the
 * T39-style allow-list invariant. T42 closes that gap.
 *
 * Exported so the synthetic-violation test can reuse the constant.
 */
export const ALLOWED_ALLOW_MISSING_CALLERS: readonly string[] = [
  "agents/config/agent-bundle-loader.ts",
  "agents/runner/builder.ts",
  "agents/verdict/factory.ts",
] as const;

/**
 * Scan production files under `walkRoot` for any caller that passes
 * `allowMissing: true` as an *object-literal value* — i.e., a caller of
 * `loadStepRegistry` opting in to the SR-LOAD-003 swallow.
 *
 * Type-declaration sites (`allowMissing?: boolean;` or `allowMissing: true;`
 * inside an interface/type body) are NOT counted: a trailing `;` belongs
 * to a TS field declaration, while caller object literals close with `,`,
 * `}`, or `)`. The discriminator is precise — the same pattern T39/T43
 * uses for `validateIntentEnums:false`.
 *
 * Whole-file scan (T43 pattern): `\s*` between `true` and the terminator
 * spans newlines, so multi-line caller forms (terminator on a later line)
 * are detected. Comments are stripped before matching so JSDoc / inline
 * mentions of `allowMissing: true` (which appear in `loader.ts` and
 * `types.ts` documentation blocks) do not trigger detection.
 *
 * Returns repo-relative paths (relative to `walkRoot`) of the offenders.
 * The caller asserts the result against `ALLOWED_ALLOW_MISSING_CALLERS`.
 */
export async function scanAllowMissingOptInCallers(
  walkRoot: string,
): Promise<string[]> {
  const files = await collectProductionTsFiles(walkRoot);
  // Match `allowMissing: true` followed by an object-literal terminator
  // (`,`, `}`, or `)`). Excludes type-declaration form
  // (`allowMissing: true;` or `allowMissing?: boolean;`) because `;` and
  // `boolean` are not in the value+terminator class. `\s*` matches
  // arbitrary whitespace including newlines, so multi-line caller forms
  // are detected (T43 pattern).
  const optInRe = /\ballowMissing\s*:\s*true\s*[,)}]/;
  const callers: string[] = [];
  for (const absPath of files) {
    const text = await Deno.readTextFile(absPath);
    const stripped = stripComments(text);
    if (optInRe.test(stripped)) {
      callers.push(toRelative(absPath, walkRoot));
    }
  }
  callers.sort();
  return callers;
}

Deno.test(
  "invariant: allowMissing:true opt-in callers are exactly the sanctioned 3 (T42 / critique-7 N#1 + NEW#1)",
  async () => {
    // The opt-in `allowMissing: true` is a deliberately narrow escape
    // hatch: the loader fabricates an empty registry instead of throwing
    // SR-LOAD-003. Only domains that treat an absent registry as "no step
    // graph" should opt in. T38 added the type-level switch but no CI
    // gate; T42 closes that gap so a 4th caller cannot silently swallow
    // registry absence without review.
    const callers = await scanAllowMissingOptInCallers(AGENTS_ROOT);
    // Convert agents-relative paths returned by the scanner into repo-
    // relative paths so the diagnostic message matches developer mental
    // model and aligns with `ALLOWED_ALLOW_MISSING_CALLERS`.
    const repoRelative = callers
      .map((p) => relative(REPO_ROOT, join(AGENTS_ROOT, p)))
      .sort();

    assertEquals(
      repoRelative,
      [...ALLOWED_ALLOW_MISSING_CALLERS].sort(),
      [
        `Opt-in cap violated: allowMissing:true is reserved for callers`,
        `whose domain legitimately treats an absent registry as "no step`,
        `graph" (PromptResolver factory, bundle loader projection,`,
        `non-detect:graph verdict handlers).`,
        ``,
        `Expected callers: ${JSON.stringify(ALLOWED_ALLOW_MISSING_CALLERS)}`,
        `Actual   callers: ${JSON.stringify(repoRelative)}`,
        ``,
        `Remediation: convert caller to throw on absence (omit`,
        `\`allowMissing\` so the loader raises SR-LOAD-003) OR add the`,
        `caller to ALLOWED_ALLOW_MISSING_CALLERS with a one-line reason`,
        `documenting why an empty registry is a legitimate end state.`,
      ].join("\n"),
    );
  },
);

// =============================================================================
// Synthetic-violation tests (non-vacuity proof)
// =============================================================================
// Each invariant scanner is re-run against a temp directory containing a
// deliberate violation. If the scanner returned an empty list (vacuously
// passing the real-tree test), these would also pass — but they would
// catch zero offenders, which is the fail signal we assert on.

Deno.test(
  "invariant #11 non-vacuity: synthetic loadStepsRegistry( call is detected",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv11-" });
    try {
      // A new production file in a fresh `agents/` clone, with a bare
      // `loadStepsRegistry(...)` call outside any signature header.
      const violator = join(tmp, "synthetic-caller.ts");
      await Deno.writeTextFile(
        violator,
        [
          "// synthetic regression: third caller of plural loader",
          "import { loadStepsRegistry } from './stub.ts';",
          "export async function attack(dir: string): Promise<unknown> {",
          "  return await loadStepsRegistry(dir);",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanLoadStepsRegistryCallers(tmp);
      assertEquals(
        callers,
        ["synthetic-caller.ts"],
        `Synthetic violation must be detected — got ${JSON.stringify(callers)}`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #11 non-vacuity: signature line is correctly skipped, body call is NOT skipped",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv11-skip-" });
    try {
      // Mirror the loader.ts shape: an export defines `loadStepsRegistry`
      // and its body calls `delegate.loadStepsRegistry(...)`. The
      // signature line must be skipped, but the body delegation must
      // still be counted (because future regressions may add a second
      // body in the same file).
      const file = join(tmp, "delegator.ts");
      await Deno.writeTextFile(
        file,
        [
          "import { delegate } from './stub.ts';",
          "export async function loadStepsRegistry(dir: string): Promise<unknown> {",
          "  return await delegate.loadStepsRegistry(dir);",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanLoadStepsRegistryCallers(tmp);
      assertEquals(
        callers,
        ["delegator.ts"],
        `Body delegation must be visible to the scanner, signature must be skipped — got ${
          JSON.stringify(callers)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #13 non-vacuity: synthetic JSON.parse in a registry-aware file is detected",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv13-" });
    try {
      // File mentions `steps_registry` AND contains a JSON.parse — the
      // exact pattern the invariant must catch. Helper-resolved paths
      // and >10-line preprocessing both reduce to "file mentions" under
      // the new whole-file scan, so a single fixture covers them.
      const violator = join(tmp, "rogue-reader.ts");
      await Deno.writeTextFile(
        violator,
        [
          "// synthetic regression: bypass loadStepRegistry validator",
          "import { resolveRegistryPath } from './paths.ts';",
          "function getRegistryPath(): string {",
          "  return resolveRegistryPath('steps_registry');",
          "}",
          "// 10+ lines of preprocessing — escapes the old lookback window",
          "function pad1() {}",
          "function pad2() {}",
          "function pad3() {}",
          "function pad4() {}",
          "function pad5() {}",
          "function pad6() {}",
          "function pad7() {}",
          "function pad8() {}",
          "function pad9() {}",
          "function pad10() {}",
          "export async function rogue(): Promise<unknown> {",
          "  const text = await Deno.readTextFile(getRegistryPath());",
          "  return JSON.parse(text);",
          "}",
          "",
        ].join("\n"),
      );

      const offenders = await scanInlineStepsRegistryJsonParse(tmp);
      assertEquals(
        offenders.length,
        1,
        `Synthetic violation must be detected — got ${
          JSON.stringify(offenders)
        }`,
      );
      assertEquals(offenders[0].file, "rogue-reader.ts");
      assertStringIncludes(offenders[0].snippet, "JSON.parse");
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #11 non-vacuity (T34/N#1): bare call between TS overload signatures is detected",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv11-overload-" });
    try {
      // critique-6 N#1: a `;`-terminated overload header has no `{`, so the
      // pre-T34 walker would slide forward and consume the next overload's
      // body opener — silently swallowing any bare `loadStepsRegistry(`
      // call planted between the two declarations.
      const file = join(tmp, "overload-violator.ts");
      await Deno.writeTextFile(
        file,
        [
          "import { backend } from './stub.ts';",
          "export function loadStepsRegistry(): Promise<unknown>;",
          "// regression: bare delegation slipped between overload + impl",
          "const cached = backend.loadStepsRegistry('cache');",
          "export function loadStepsRegistry(",
          "  dir: string,",
          "): Promise<unknown> {",
          "  return Promise.resolve(cached);",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanLoadStepsRegistryCallers(tmp);
      assertEquals(
        callers,
        ["overload-violator.ts"],
        `Overload-interleaved call must be detected (N#1) — got ${
          JSON.stringify(callers)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #11 non-vacuity (T34/N#8): nested call inside multi-line signature window is detected",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv11-sigwindow-" });
    try {
      // critique-6 N#8: a multi-line signature window has every line in
      // the skip set. A `delegate.loadStepsRegistry(...)` mention placed
      // among the param lines (e.g., as a default-value expression) used
      // to be invisible. T34 budgets ONE self-reference on the sigStart
      // line and ZERO on continuation lines — the call must surface.
      const file = join(tmp, "sigwindow-violator.ts");
      await Deno.writeTextFile(
        file,
        [
          "import { delegate } from './stub.ts';",
          "export async function loadStepsRegistry(",
          "  dir: string,",
          "  preload: unknown = delegate.loadStepsRegistry(dir),",
          "  trailing?: string,",
          "): Promise<unknown> {",
          "  return preload;",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanLoadStepsRegistryCallers(tmp);
      assertEquals(
        callers,
        ["sigwindow-violator.ts"],
        `Nested call inside signature window must be detected (N#8) — got ${
          JSON.stringify(callers)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #13 non-vacuity: comment-only mention does NOT pull file into scope",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv13-comment-" });
    try {
      // File mentions `steps_registry` ONLY in comments and contains an
      // unrelated JSON.parse. Comment stripping must remove the mention,
      // leaving the file out of scope — zero offenders expected.
      const file = join(tmp, "comment-only.ts");
      await Deno.writeTextFile(
        file,
        [
          "/**",
          " * Validates steps_registry.json existence.",
          " * STEPS_REGISTRY constant lives elsewhere.",
          " */",
          "export function unrelated(text: string): unknown {",
          "  return JSON.parse(text);",
          "}",
          "",
        ].join("\n"),
      );

      const offenders = await scanInlineStepsRegistryJsonParse(tmp);
      assertEquals(
        offenders,
        [],
        `Comment-only mention must not pull file into scope — got ${
          JSON.stringify(offenders)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #N6 non-vacuity: pre-violation tree returns empty, post-violation tree returns the planted file (T39)",
  async () => {
    // Two-phase fail-proof: a file with no opt-out call must scan empty
    // (proving the scanner is precise, not blanket-detecting), then the
    // SAME directory with an added violator must surface that file (and
    // only that file). This rules out a vacuous pass on an empty tree.
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv-n6-" });
    try {
      // Phase 1 — clean baseline. A file using the strict variant
      // (validateIntentEnums omitted, schemasDir present) plus a TS
      // type-declaration form (`false;`) which must be ignored.
      const clean = join(tmp, "clean-caller.ts");
      await Deno.writeTextFile(
        clean,
        [
          "import { loadStepRegistry } from './stub.ts';",
          "// type-declaration form must NOT count (terminator is `;`):",
          "interface SomeOpts { validateIntentEnums: false; }",
          "export async function ok(dir: string): Promise<unknown> {",
          "  return await loadStepRegistry('agent', dir, {",
          "    schemasDir: dir,", // strict variant — no opt-out
          "  });",
          "}",
          "",
        ].join("\n"),
      );

      const before = await scanValidateIntentEnumsOptOutCallers(tmp);
      assertEquals(
        before,
        [],
        `Phase 1 (pre-violation) must be empty — got ${JSON.stringify(before)}`,
      );

      // Phase 2 — add a violator that opts out without being on the allow
      // list. Two terminator shapes are exercised: trailing `,` and
      // trailing `}` (last item in object literal).
      const violator = join(tmp, "rogue-opt-out.ts");
      await Deno.writeTextFile(
        violator,
        [
          "// synthetic regression: convention-only opt-out by a non-allowed caller",
          "import { loadStepRegistry } from './stub.ts';",
          "export async function attack(name: string, dir: string) {",
          "  return await loadStepRegistry(name, dir, {",
          "    registryPath: '/tmp/x',",
          "    validateIntentEnums: false,", // trailing `,` form
          "  });",
          "}",
          "export async function attackTrailing(name: string, dir: string) {",
          "  return await loadStepRegistry(name, dir, { validateIntentEnums: false });", // trailing `}` form
          "}",
          "",
        ].join("\n"),
      );

      const after = await scanValidateIntentEnumsOptOutCallers(tmp);
      assertEquals(
        after,
        ["rogue-opt-out.ts"],
        `Phase 2 (post-violation) must surface the planted file — got ${
          JSON.stringify(after)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #N6 non-vacuity: type-declaration form (`false;`) is NOT counted as a caller (T39)",
  async () => {
    // Discriminator regression test: the regex distinguishes object-
    // literal callers (`false,` `false}` `false)`) from TS type-field
    // declarations (`false;`). Without this discriminator,
    // `agents/common/step-registry/types.ts:RegistryLoaderOptOutOptions`
    // would falsely register as a caller and force the allow list to
    // include the type definition itself, weakening the invariant.
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv-n6-typedecl-" });
    try {
      const file = join(tmp, "type-only.ts");
      await Deno.writeTextFile(
        file,
        [
          "// Mirrors RegistryLoaderOptOutOptions in types.ts — type field,",
          "// not a call. The semicolon discriminator must keep this out.",
          "export interface OptOutShape {",
          "  registryPath?: string;",
          "  validateIntentEnums: false;",
          "  schemasDir?: string;",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanValidateIntentEnumsOptOutCallers(tmp);
      assertEquals(
        callers,
        [],
        `Type-declaration form must not be detected as a caller — got ${
          JSON.stringify(callers)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #N6 non-vacuity (T43/N#3): multi-line caller form is detected",
  async () => {
    // critique-7 N#3: the line-by-line regex `false\s*[,)}]` only matched
    // when the terminator sat on the same line as `false`. A caller
    // formatting the option on its own line (`false\n  }`) escaped the
    // scan. T43 switches to whole-file scanning so `\s*` spans newlines
    // and the terminator may live on a later line.
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv-n6-multiline-" });
    try {
      // Two violators exercise both multi-line terminator shapes:
      //   - `false\n  }` (last item, closing brace on next line)
      //   - `false\n  ,` (whitespace then comma on the next line —
      //     unusual but valid TS, and exactly the reformat-bypass
      //     critique-7 names)
      const violator = join(tmp, "rogue-multiline.ts");
      await Deno.writeTextFile(
        violator,
        [
          "// synthetic regression: multi-line opt-out caller (T43)",
          "import { loadStepRegistry } from './stub.ts';",
          "export async function attackTrailingBrace(name: string, dir: string) {",
          "  return await loadStepRegistry(name, dir, {",
          "    registryPath: '/tmp/x',",
          "    validateIntentEnums: false",
          "  });",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanValidateIntentEnumsOptOutCallers(tmp);
      assertEquals(
        callers,
        ["rogue-multiline.ts"],
        `Multi-line caller form (T43/N#3) must be detected — got ${
          JSON.stringify(callers)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #N6 non-vacuity (T43): multi-line type-declaration form is still NOT counted",
  async () => {
    // T43 enabling whole-file scan must not regress the type-declaration
    // discriminator. A multi-line interface body where `false;` sits on
    // its own line, followed by another field, still terminates with `;`
    // (not `,)}`) so the regex must miss it.
    const tmp = await Deno.makeTempDir({
      prefix: "loader-inv-n6-typedecl-ml-",
    });
    try {
      const file = join(tmp, "type-only-multiline.ts");
      await Deno.writeTextFile(
        file,
        [
          "// Multi-line interface: each field on its own line ending in `;`.",
          "export interface OptOutShape {",
          "  registryPath?: string;",
          "  validateIntentEnums: false;",
          "  schemasDir?: string;",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanValidateIntentEnumsOptOutCallers(tmp);
      assertEquals(
        callers,
        [],
        `Multi-line type-declaration form must not be detected — got ${
          JSON.stringify(callers)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #N7 non-vacuity: pre-violation tree returns empty, post-violation tree returns the planted file (T42)",
  async () => {
    // Two-phase fail-proof for the allowMissing opt-in scanner. Phase 1
    // proves the scanner is precise (a strict-variant call without the
    // opt-in plus a TS type declaration must scan empty). Phase 2 proves
    // a planted opt-in caller is detected. Mirrors the T39/T43 pattern.
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv-n7-" });
    try {
      // Phase 1 — clean baseline. A file using the strict variant
      // (allowMissing omitted) plus a TS type-declaration form
      // (`allowMissing?: boolean;`) which must be ignored.
      const clean = join(tmp, "clean-caller.ts");
      await Deno.writeTextFile(
        clean,
        [
          "import { loadStepRegistry } from './stub.ts';",
          "// type-declaration form must NOT count (terminator is `;`):",
          "interface SomeOpts { allowMissing?: boolean; }",
          "// value-form type declaration must also NOT count:",
          "interface OtherOpts { allowMissing: true; }",
          "export async function ok(dir: string): Promise<unknown> {",
          "  return await loadStepRegistry('agent', dir, {",
          "    schemasDir: dir,", // strict variant — no allowMissing opt-in
          "  });",
          "}",
          "",
        ].join("\n"),
      );

      const before = await scanAllowMissingOptInCallers(tmp);
      assertEquals(
        before,
        [],
        `Phase 1 (pre-violation) must be empty — got ${JSON.stringify(before)}`,
      );

      // Phase 2 — add a violator that opts in without being on the allow
      // list. Two terminator shapes are exercised: trailing `,` and
      // trailing `}` (last item in object literal).
      const violator = join(tmp, "rogue-opt-in.ts");
      await Deno.writeTextFile(
        violator,
        [
          "// synthetic regression: convention-only opt-in by a non-allowed caller",
          "import { loadStepRegistry } from './stub.ts';",
          "export async function attack(name: string, dir: string) {",
          "  return await loadStepRegistry(name, dir, {",
          "    schemasDir: dir,",
          "    allowMissing: true,", // trailing `,` form
          "  });",
          "}",
          "export async function attackTrailing(name: string, dir: string) {",
          "  return await loadStepRegistry(name, dir, { schemasDir: dir, allowMissing: true });", // trailing `}` form
          "}",
          "",
        ].join("\n"),
      );

      const after = await scanAllowMissingOptInCallers(tmp);
      assertEquals(
        after,
        ["rogue-opt-in.ts"],
        `Phase 2 (post-violation) must surface the planted file — got ${
          JSON.stringify(after)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #N7 non-vacuity: type-declaration form (`allowMissing?: boolean;` / `allowMissing: true;`) is NOT counted (T42)",
  async () => {
    // Discriminator regression test: the regex distinguishes object-
    // literal callers (`true,` `true}` `true)`) from TS type-field
    // declarations (`true;` / `?: boolean;`). Without this discriminator,
    // `agents/common/step-registry/types.ts:RegistryLoaderStrictOptions`
    // would falsely register as a caller and force the allow list to
    // include the type definition itself, weakening the invariant.
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv-n7-typedecl-" });
    try {
      const file = join(tmp, "type-only.ts");
      await Deno.writeTextFile(
        file,
        [
          "// Mirrors RegistryLoaderStrictOptions in types.ts — type fields,",
          "// not calls. The semicolon discriminator must keep these out.",
          "export interface OptInShape {",
          "  registryPath?: string;",
          "  schemasDir: string;",
          "  allowMissing?: boolean;",
          "}",
          "// Literal-typed field form must also be excluded:",
          "export interface ForcedOnShape {",
          "  allowMissing: true;",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanAllowMissingOptInCallers(tmp);
      assertEquals(
        callers,
        [],
        `Type-declaration form must not be detected as a caller — got ${
          JSON.stringify(callers)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "invariant #N7 non-vacuity (T42): multi-line caller form is detected",
  async () => {
    // T43 established whole-file scanning so multi-line caller forms
    // (`allowMissing: true\n  }`) are detected. T42 inherits the same
    // pattern. This test pins the multi-line detection so a future
    // refactor of the regex cannot regress to line-by-line scope.
    const tmp = await Deno.makeTempDir({ prefix: "loader-inv-n7-multiline-" });
    try {
      const violator = join(tmp, "rogue-multiline.ts");
      await Deno.writeTextFile(
        violator,
        [
          "// synthetic regression: multi-line opt-in caller (T42)",
          "import { loadStepRegistry } from './stub.ts';",
          "export async function attackTrailingBrace(name: string, dir: string) {",
          "  return await loadStepRegistry(name, dir, {",
          "    schemasDir: dir,",
          "    allowMissing: true",
          "  });",
          "}",
          "",
        ].join("\n"),
      );

      const callers = await scanAllowMissingOptInCallers(tmp);
      assertEquals(
        callers,
        ["rogue-multiline.ts"],
        `Multi-line caller form (T42) must be detected — got ${
          JSON.stringify(callers)
        }`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);
