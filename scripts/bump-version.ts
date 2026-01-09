#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Version Bump Script
 *
 * Updates version in deno.json and src/version.ts to match.
 * Can auto-detect version from release/* branch name.
 *
 * @module
 *
 * @example Auto-detect from branch name
 * ```bash
 * deno run -A scripts/bump-version.ts
 * ```
 *
 * @example Specify version explicitly
 * ```bash
 * deno run -A scripts/bump-version.ts 1.10.2
 * ```
 *
 * @example Dry run (show what would change)
 * ```bash
 * deno run -A scripts/bump-version.ts --dry-run
 * ```
 */

const DENO_JSON_PATH = "deno.json";
const VERSION_TS_PATH = "src/version.ts";

interface VersionInfo {
  denoJson: string;
  versionTs: string;
  branch: string | null;
}

async function getCurrentVersions(): Promise<VersionInfo> {
  // Read deno.json
  const denoJsonText = await Deno.readTextFile(DENO_JSON_PATH);
  const denoJson = JSON.parse(denoJsonText);
  const denoJsonVersion = denoJson.version;

  // Read version.ts
  const versionTsText = await Deno.readTextFile(VERSION_TS_PATH);
  const versionMatch = versionTsText.match(
    /export const CLIMPT_VERSION = "([^"]+)"/,
  );
  const versionTsVersion = versionMatch ? versionMatch[1] : "unknown";

  // Get branch name
  let branchVersion: string | null = null;
  try {
    const cmd = new Deno.Command("git", {
      args: ["branch", "--show-current"],
      stdout: "piped",
    });
    const { stdout } = await cmd.output();
    const branch = new TextDecoder().decode(stdout).trim();
    if (branch.startsWith("release/")) {
      branchVersion = branch.replace("release/", "");
    }
  } catch {
    // Git not available or not in a repo
  }

  return {
    denoJson: denoJsonVersion,
    versionTs: versionTsVersion,
    branch: branchVersion,
  };
}

async function updateVersion(
  newVersion: string,
  dryRun: boolean,
): Promise<void> {
  // Update deno.json
  const denoJsonText = await Deno.readTextFile(DENO_JSON_PATH);
  const updatedDenoJson = denoJsonText.replace(
    /"version": "[^"]+"/,
    `"version": "${newVersion}"`,
  );

  // Update version.ts
  const versionTsText = await Deno.readTextFile(VERSION_TS_PATH);
  const updatedVersionTs = versionTsText.replace(
    /export const CLIMPT_VERSION = "[^"]+"/,
    `export const CLIMPT_VERSION = "${newVersion}"`,
  );

  if (dryRun) {
    console.log(`[Dry Run] Would update ${DENO_JSON_PATH} to ${newVersion}`);
    console.log(`[Dry Run] Would update ${VERSION_TS_PATH} to ${newVersion}`);
  } else {
    await Deno.writeTextFile(DENO_JSON_PATH, updatedDenoJson);
    await Deno.writeTextFile(VERSION_TS_PATH, updatedVersionTs);
    console.log(`Updated ${DENO_JSON_PATH} to ${newVersion}`);
    console.log(`Updated ${VERSION_TS_PATH} to ${newVersion}`);
  }
}

function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

async function main(): Promise<void> {
  const args = Deno.args;
  const dryRun = args.includes("--dry-run");
  const help = args.includes("--help") || args.includes("-h");

  if (help) {
    console.log(`
Version Bump Script

Usage:
  bump-version.ts [version] [options]

Arguments:
  version         Target version (e.g., 1.10.2)
                  If omitted, auto-detects from release/* branch name

Options:
  --dry-run       Show what would change without writing files
  --help, -h      Show this help message

Examples:
  # Auto-detect from branch name (on release/1.10.2 branch)
  bump-version.ts

  # Specify version explicitly
  bump-version.ts 1.10.2

  # Check what would change
  bump-version.ts --dry-run
`);
    Deno.exit(0);
  }

  // Get current state
  const current = await getCurrentVersions();
  console.log("\nCurrent versions:");
  console.log(`  deno.json:   ${current.denoJson}`);
  console.log(`  version.ts:  ${current.versionTs}`);
  console.log(`  branch:      ${current.branch ?? "(not on release branch)"}`);

  // Determine target version
  let targetVersion: string | null = null;

  // Check for explicit version argument
  for (const arg of args) {
    if (!arg.startsWith("-") && isValidVersion(arg)) {
      targetVersion = arg;
      break;
    }
  }

  // Fall back to branch name
  if (!targetVersion && current.branch) {
    targetVersion = current.branch;
  }

  if (!targetVersion) {
    console.error(
      "\nError: No version specified and not on a release/* branch",
    );
    console.error("Usage: bump-version.ts <version> or run on release/* branch");
    Deno.exit(1);
  }

  if (!isValidVersion(targetVersion)) {
    console.error(`\nError: Invalid version format: ${targetVersion}`);
    console.error("Expected format: X.Y.Z (e.g., 1.10.2)");
    Deno.exit(1);
  }

  // Check if update is needed
  if (
    current.denoJson === targetVersion && current.versionTs === targetVersion
  ) {
    console.log(`\nVersions already at ${targetVersion}. No update needed.`);
    Deno.exit(0);
  }

  console.log(`\nUpdating to version: ${targetVersion}`);
  await updateVersion(targetVersion, dryRun);

  if (!dryRun) {
    console.log("\nDone! Next steps:");
    console.log("  1. deno task ci");
    console.log('  2. git add deno.json src/version.ts');
    console.log(`  3. git commit -m "chore: bump version to ${targetVersion}"`);
  }
}

if (import.meta.main) {
  main();
}
