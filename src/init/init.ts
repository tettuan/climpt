/**
 * @fileoverview Main init orchestrator for climpt
 * @module init/init
 */

import { resolve } from "@std/path";
import { detectExisting, hasExistingFiles } from "./detector.ts";
import { initBasic } from "./basic-init.ts";
import { initMetaDomain } from "./meta-init.ts";
import { initRegistryAndSchema } from "./registry-init.ts";
import type { InitOptions, InitResult } from "./types.ts";

const DEFAULT_OPTIONS: InitOptions = {
  workingDir: ".agent/climpt",
  force: false,
  skipMeta: false,
  skipRegistry: false,
  projectRoot: ".",
};

/**
 * climpt init メイン処理
 */
export async function runInit(args: string[]): Promise<InitResult> {
  const options = parseInitArgs(args);
  const result: InitResult = {
    success: true,
    created: [],
    skipped: [],
    errors: [],
  };

  console.log("\nInitializing Climpt...\n");

  // Phase 1: 環境検出
  console.log("Phase 1: Detecting existing configuration");
  const detection = await detectExisting(options.projectRoot, options.workingDir);

  if (detection.hasWorkingDir) {
    console.log(`  Working directory: ${options.workingDir} (found)`);
  } else {
    console.log(`  Working directory: ${options.workingDir} (not found)`);
  }

  // 上書き確認
  if (hasExistingFiles(detection) && !options.force) {
    console.log("\nExisting configuration detected.");
    console.log("Use --force to overwrite existing files.");
    result.success = false;
    return result;
  }

  // Phase 2: 基本構成初期化（ディレクトリ作成のみ）
  console.log("\nPhase 2: Basic configuration initialization");
  try {
    const basicResult = await initBasic(
      options.projectRoot,
      options.workingDir,
    );
    result.created.push(...basicResult.created);
    result.skipped.push(...basicResult.skipped);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(`Basic init failed: ${errorMessage}`);
  }

  // Phase 3: Meta Domain初期化
  if (!options.skipMeta) {
    console.log("\nPhase 3: Meta domain initialization");
    try {
      const fullWorkingDir = resolve(options.projectRoot, options.workingDir);
      const metaResult = await initMetaDomain(fullWorkingDir, options.force);
      result.created.push(...metaResult.created);
      result.skipped.push(...metaResult.skipped);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Meta init failed: ${errorMessage}`);
    }
  } else {
    console.log("\nPhase 3: Meta domain initialization (skipped)");
  }

  // Phase 4: Registry & Schema初期化
  if (!options.skipRegistry) {
    console.log("\nPhase 4: Registry & Schema initialization");
    try {
      const registryResult = await initRegistryAndSchema(
        options.projectRoot,
        options.workingDir,
        options.force,
      );
      result.created.push(...registryResult.created);
      result.skipped.push(...registryResult.skipped);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Registry init failed: ${errorMessage}`);
    }
  } else {
    console.log("\nPhase 4: Registry & Schema initialization (skipped)");
  }

  // 完了メッセージ
  printSummary(result, options);

  result.success = result.errors.length === 0;
  return result;
}

/**
 * CLI引数をパース
 */
function parseInitArgs(args: string[]): InitOptions {
  const options = { ...DEFAULT_OPTIONS };

  for (const arg of args) {
    if (arg.startsWith("--working-dir=")) {
      options.workingDir = arg.slice(14);
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg === "--skip-meta") {
      options.skipMeta = true;
    } else if (arg === "--skip-registry") {
      options.skipRegistry = true;
    }
  }

  return options;
}

/**
 * 結果サマリーを表示
 */
function printSummary(result: InitResult, options: InitOptions): void {
  console.log("\n" + "=".repeat(50));
  console.log("Initialization complete!");
  console.log("=".repeat(50));

  if (result.created.length > 0) {
    console.log(`\nCreated (${result.created.length} items)`);
  }

  if (result.skipped.length > 0) {
    console.log(`Skipped (${result.skipped.length} items - already exist)`);
  }

  if (result.errors.length > 0) {
    console.log(`\nErrors:`);
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }

  console.log("\nAvailable meta commands:");
  console.log("  climpt-meta build frontmatter    # Generate C3L frontmatter for new instruction");
  console.log("  climpt-meta create instruction   # Create new Climpt instruction file");

  console.log("\nNext steps:");
  console.log("  1. Create new instruction:");
  console.log('     echo "Domain: code, Action: review, Target: pull-request" | climpt-meta create instruction');
  console.log(`  2. Or add prompts manually to ${options.workingDir}/prompts/<domain>/`);
  console.log("  3. Run 'deno run -A jsr:@aidevtool/climpt/reg' to update registry");
}
