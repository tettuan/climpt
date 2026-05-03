#!/usr/bin/env -S deno run --allow-read
/**
 * Anti-list CLI lint (design 13 §I + 14 §I).
 *
 * Rejects forbidden CLI flags in `agents/scripts/`:
 *  - `--edition`        (steps_registry.json owns edition selection)
 *  - `--adaptation`     (failure adaptation is registry-driven, not CLI)
 *
 * The two flags above were on the realistic-design "anti-list": surfacing
 * them on a CLI re-introduces the climpt v3 `factory.ts` antipattern
 * where prompt selection bypassed the registry. Per memory feedback
 * `feedback_no_dispatch_sh` and design 14 §I, all retry / variant control
 * MUST go through `steps_registry.json#completionPatterns`.
 *
 * Design behaviour:
 *  - Default scan target: `agents/scripts/` (recursive, *.ts files).
 *  - Override via `--dir <path>` (one or more).
 *  - Conservative detection: matches the literal flag string (`"--edition"`
 *    / `"--adaptation"`) anywhere in source. False positives are
 *    documented inline by adding `// lint-anti-list:allow <flag>` on
 *    the same line (escape hatch for vendored snippets / docs).
 *
 * Exit codes:
 *  - 0  — clean (or only allow-listed lines)
 *  - 1  — violation found (printed as `path:line:col message`)
 *  - 2  — unrecoverable I/O / argv error
 */

import { walk } from "@std/fs/walk";
import { fromFileUrl, toFileUrl } from "@std/path";

const FORBIDDEN_FLAGS: readonly string[] = ["--edition", "--adaptation"];
const ALLOW_MARKER = "lint-anti-list:allow";

interface Violation {
  readonly file: string;
  readonly line: number; // 1-based
  readonly column: number; // 1-based
  readonly flag: string;
  readonly snippet: string;
}

/**
 * Scan a single source string for forbidden flags.
 *
 * Conservative: matches the literal flag string anywhere on a line. The
 * caller is responsible for skipping non-source files (e.g. compiled
 * output). The escape hatch (`lint-anti-list:allow <flag>` in a comment
 * on the same line) is honoured here.
 */
export function scanSource(
  file: string,
  source: string,
): readonly Violation[] {
  const violations: Violation[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const flag of FORBIDDEN_FLAGS) {
      const col = line.indexOf(`"${flag}"`);
      const altCol = line.indexOf(`'${flag}'`);
      const idx = col >= 0 ? col : altCol;
      if (idx < 0) continue;
      // Allow-marker escape hatch: same line, must include `<flag>` token.
      const allowIdx = line.indexOf(ALLOW_MARKER);
      if (allowIdx >= 0 && line.slice(allowIdx).includes(flag)) {
        continue;
      }
      violations.push({
        file,
        line: i + 1,
        column: idx + 1,
        flag,
        snippet: line.trim(),
      });
    }
  }
  return violations;
}

/** Walk the supplied directories and collect violations. */
export async function lintAntiList(
  roots: readonly string[],
): Promise<readonly Violation[]> {
  const violations: Violation[] = [];
  for (const root of roots) {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(root);
    } catch {
      continue; // missing dir is treated as clean (CI may run before scaffold)
    }
    if (!stat.isDirectory) continue;
    for await (
      const entry of walk(root, {
        exts: [".ts"],
        // Skip *_test.ts so test fixtures that string-quote the flag
        // (to assert rejection) do not trip the lint.
        skip: [/_test\.ts$/, /\.test\.ts$/],
      })
    ) {
      if (!entry.isFile) continue;
      const text = await Deno.readTextFile(entry.path);
      for (const v of scanSource(entry.path, text)) {
        violations.push(v);
      }
    }
  }
  return violations;
}

/** CLI argv parsing — minimalist, no third-party deps. */
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
    roots.push("agents/scripts");
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
    console.error(`lint-anti-list: argv error: ${msg}`);
    return 2;
  }
  const violations = await lintAntiList(parsed.roots);
  if (violations.length === 0) {
    // deno-lint-ignore no-console
    console.log(
      `lint-anti-list: 0 violations across [${parsed.roots.join(", ")}]`,
    );
    return 0;
  }
  for (const v of violations) {
    // deno-lint-ignore no-console
    console.error(
      `${v.file}:${v.line}:${v.column} forbidden flag "${v.flag}" — ${v.snippet}`,
    );
  }
  // deno-lint-ignore no-console
  console.error(
    `lint-anti-list: ${violations.length} violation(s). ` +
      `Forbidden flags: [${FORBIDDEN_FLAGS.join(", ")}]. ` +
      "Edition/adaptation control belongs in steps_registry.json#completionPatterns " +
      "(design 14 §I anti-list).",
  );
  return 1;
}

// Run when invoked as a script (not when imported by the test).
if (import.meta.main) {
  Deno.exit(await main());
}

// Exports kept for the test harness.
export { ALLOW_MARKER, FORBIDDEN_FLAGS };
// `fromFileUrl` / `toFileUrl` re-exported as a stable surface for callers
// that build paths against this module URL.
export { fromFileUrl, toFileUrl };
