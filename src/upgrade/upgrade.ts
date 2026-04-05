/**
 * @fileoverview Main upgrade orchestrator for climpt
 * @module upgrade/upgrade
 */

import { CLIMPT_VERSION } from "../version.ts";
import { getLatestVersion } from "../docs/source.ts";
import { install, list } from "../docs/mod.ts";
import type {
  UpgradeOptions,
  UpgradeResult,
  ValidationResult,
} from "./types.ts";

const DEFAULT_OPTIONS: UpgradeOptions = {
  docsDir: ".agent/climpt/docs",
  skipDocs: false,
  skipValidate: false,
};

export async function runUpgrade(args: string[]): Promise<UpgradeResult> {
  const options = parseUpgradeArgs(args);
  const result: UpgradeResult = {
    success: true,
    previousVersion: CLIMPT_VERSION,
    latestVersion: "",
    docsInstalled: 0,
    docsFailed: 0,
    validation: { version: false, docsList: false },
    errors: [],
  };

  // deno-lint-ignore no-console
  console.log("\nClimpt Upgrade\n");

  // Phase 1: Check latest version on JSR
  // deno-lint-ignore no-console
  console.log("Phase 1: Checking latest version on JSR");
  try {
    result.latestVersion = await getLatestVersion();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to fetch latest version: ${msg}`);
    result.success = false;
    printResult(result);
    return result;
  }

  // deno-lint-ignore no-console
  console.log(`  Current:  v${result.previousVersion}`);
  // deno-lint-ignore no-console
  console.log(`  Latest:   v${result.latestVersion}`);

  if (result.previousVersion === result.latestVersion) {
    // deno-lint-ignore no-console
    console.log("  Already up to date.");
  } else {
    // deno-lint-ignore no-console
    console.log("  Update available. Run with latest version:");
    // deno-lint-ignore no-console
    console.log(`    deno run -Ar jsr:@aidevtool/climpt/cli --version`);
  }

  // Phase 2: Update docs
  if (!options.skipDocs) {
    // deno-lint-ignore no-console
    console.log(`\nPhase 2: Updating docs to ${options.docsDir}`);
    try {
      const docsResult = await install({
        output: options.docsDir,
        version: result.latestVersion,
      });
      result.docsInstalled = docsResult.installed.length;
      result.docsFailed = docsResult.failed.length;
      // deno-lint-ignore no-console
      console.log(`  Installed: ${result.docsInstalled} files`);
      if (result.docsFailed > 0) {
        // deno-lint-ignore no-console
        console.log(`  Failed: ${result.docsFailed} files`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Docs install failed: ${msg}`);
    }
  } else {
    // deno-lint-ignore no-console
    console.log("\nPhase 2: Docs update (skipped)");
  }

  // Phase 3: Validate
  if (!options.skipValidate) {
    // deno-lint-ignore no-console
    console.log("\nPhase 3: Validation");
    result.validation = await validate(result.latestVersion);
  } else {
    // deno-lint-ignore no-console
    console.log("\nPhase 3: Validation (skipped)");
  }

  result.success = result.errors.length === 0;
  printResult(result);
  return result;
}

async function validate(expectedVersion: string): Promise<ValidationResult> {
  const validation: ValidationResult = { version: false, docsList: false };

  // 3a. Version check
  try {
    const latest = await getLatestVersion();
    validation.version = latest === expectedVersion;
    // deno-lint-ignore no-console
    console.log(
      `  Version:   ${validation.version ? "PASS" : "FAIL"} (${latest})`,
    );
  } catch {
    // deno-lint-ignore no-console
    console.log("  Version:   FAIL (fetch error)");
  }

  // 3b. Docs list check
  try {
    const { entries } = await list(expectedVersion);
    validation.docsList = entries.length > 0;
    // deno-lint-ignore no-console
    console.log(
      `  Docs list: ${
        validation.docsList ? "PASS" : "FAIL"
      } (${entries.length} entries)`,
    );
  } catch {
    // deno-lint-ignore no-console
    console.log("  Docs list: FAIL (fetch error)");
  }

  return validation;
}

function printResult(result: UpgradeResult): void {
  // deno-lint-ignore no-console
  console.log("\n" + "=".repeat(50));

  if (result.errors.length > 0) {
    // deno-lint-ignore no-console
    console.log("Upgrade completed with errors:");
    for (const error of result.errors) {
      // deno-lint-ignore no-console
      console.log(`  - ${error}`);
    }
  } else {
    // deno-lint-ignore no-console
    console.log("Upgrade complete.");
  }

  // deno-lint-ignore no-console
  console.log("=".repeat(50));
}

function parseUpgradeArgs(args: string[]): UpgradeOptions {
  const options = { ...DEFAULT_OPTIONS };

  for (const arg of args) {
    if (arg.startsWith("--docs-dir=")) {
      options.docsDir = arg.slice(11);
    } else if (arg === "--skip-docs") {
      options.skipDocs = true;
    } else if (arg === "--skip-validate") {
      options.skipValidate = true;
    }
  }

  return options;
}
