#!/usr/bin/env -S deno run --allow-read --allow-run
// deno-lint-ignore-file no-console
/**
 * Version Consistency Check
 *
 * Validates that deno.json and src/version.ts have matching versions.
 * On release/* branches, also validates that the branch version matches.
 *
 * Mirrors the GitHub Actions "Check version consistency" step
 * so mismatches are caught locally before push.
 *
 * @module
 */

const DENO_JSON_PATH = "deno.json";
const VERSION_TS_PATH = "src/version.ts";

function extractDenoJsonVersion(content: string): string | null {
  const match = content.match(/"version"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

function extractVersionTs(content: string): string | null {
  const match = content.match(/export const CLIMPT_VERSION\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

async function getBranchName(): Promise<string> {
  const cmd = new Deno.Command("git", {
    args: ["branch", "--show-current"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  return new TextDecoder().decode(output.stdout).trim();
}

async function main(): Promise<void> {
  const denoJsonContent = await Deno.readTextFile(DENO_JSON_PATH);
  const versionTsContent = await Deno.readTextFile(VERSION_TS_PATH);

  const denoVersion = extractDenoJsonVersion(denoJsonContent);
  const tsVersion = extractVersionTs(versionTsContent);

  if (!denoVersion) {
    console.error("ERROR: Could not extract version from deno.json");
    Deno.exit(1);
  }
  if (!tsVersion) {
    console.error("ERROR: Could not extract version from src/version.ts");
    Deno.exit(1);
  }

  console.log(`  deno.json:   ${denoVersion}`);
  console.log(`  version.ts:  ${tsVersion}`);

  if (denoVersion !== tsVersion) {
    console.error(
      `\nERROR: Version mismatch: deno.json=${denoVersion}, version.ts=${tsVersion}`,
    );
    Deno.exit(1);
  }

  const branch = await getBranchName();
  console.log(`  branch:      ${branch}`);

  if (branch.startsWith("release/")) {
    const branchVersion = branch.replace("release/", "");
    if (branchVersion !== denoVersion) {
      console.error(
        `\nERROR: Branch version mismatch: branch=${branchVersion}, deno.json=${denoVersion}`,
      );
      console.error("Run: deno task bump-version");
      Deno.exit(1);
    }
  }

  console.log("\n✓ Version consistency check passed");
}

main();
