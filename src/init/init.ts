/**
 * @fileoverview Main init orchestrator for climpt
 * @module init/init
 */

import { resolve } from "@std/path";
import { detectExisting, hasExistingFiles } from "./detector.ts";
import { initBasic } from "./basic-init.ts";
import { initMetaDomain } from "./meta-init.ts";
import { initRegistryAndSchema } from "./registry-init.ts";
import { generateRegistry } from "../reg/index.ts";
import type { InitOptions, InitResult } from "./types.ts";

const DEFAULT_OPTIONS: InitOptions = {
  workingDir: ".agent/climpt",
  force: false,
  skipMeta: false,
  skipRegistry: false,
  projectRoot: ".",
};

/**
 * Main processing for climpt init
 */
export async function runInit(args: string[]): Promise<InitResult> {
  const options = parseInitArgs(args);
  const result: InitResult = {
    success: true,
    created: [],
    skipped: [],
    errors: [],
  };

  // deno-lint-ignore no-console
  console.log("\nInitializing Climpt...\n");

  // Phase 1: Environment detection
  // deno-lint-ignore no-console
  console.log("Phase 1: Detecting existing configuration");
  const detection = await detectExisting(
    options.projectRoot,
    options.workingDir,
  );

  if (detection.hasWorkingDir) {
    // deno-lint-ignore no-console
    console.log(`  Working directory: ${options.workingDir} (found)`);
  } else {
    // deno-lint-ignore no-console
    console.log(`  Working directory: ${options.workingDir} (not found)`);
  }

  // Confirm overwrite
  if (hasExistingFiles(detection) && !options.force) {
    // deno-lint-ignore no-console
    console.log("\nExisting configuration detected.");
    // deno-lint-ignore no-console
    console.log("Use --force to overwrite existing files.");
    result.success = false;
    return result;
  }

  // Phase 2: Basic configuration initialization (directory creation only)
  // deno-lint-ignore no-console
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

  // Phase 3: Meta Domain initialization
  if (!options.skipMeta) {
    // deno-lint-ignore no-console
    console.log("\nPhase 3: Meta domain initialization");
    try {
      const fullWorkingDir = resolve(options.projectRoot, options.workingDir);
      const metaResult = await initMetaDomain(fullWorkingDir, options.force);
      result.created.push(...metaResult.created);
      result.skipped.push(...metaResult.skipped);
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      result.errors.push(`Meta init failed: ${errorMessage}`);
    }
  } else {
    // deno-lint-ignore no-console
    console.log("\nPhase 3: Meta domain initialization (skipped)");
  }

  // Phase 4: Registry & Schema initialization
  if (!options.skipRegistry) {
    // deno-lint-ignore no-console
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
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      result.errors.push(`Registry init failed: ${errorMessage}`);
    }
  } else {
    // deno-lint-ignore no-console
    console.log("\nPhase 4: Registry & Schema initialization (skipped)");
  }

  // Phase 5: Registry Generation (generate registry.json from prompts)
  if (!options.skipRegistry && !options.skipMeta) {
    // deno-lint-ignore no-console
    console.log("\nPhase 5: Generating registry from prompts");
    try {
      const genResult = await generateRegistry({
        baseDir: options.projectRoot,
      });
      // deno-lint-ignore no-console
      console.log(`  Generated: ${genResult.processedDocuments} commands`);
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      result.errors.push(`Registry generation failed: ${errorMessage}`);
    }
  } else {
    // deno-lint-ignore no-console
    console.log("\nPhase 5: Registry generation (skipped)");
  }

  // Completion message
  printSummary(result, options);

  result.success = result.errors.length === 0;
  return result;
}

/**
 * Parse CLI arguments
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
 * Display result summary
 */
function printSummary(result: InitResult, options: InitOptions): void {
  // deno-lint-ignore no-console
  console.log("\n" + "=".repeat(50));
  // deno-lint-ignore no-console
  console.log("Initialization complete!");
  // deno-lint-ignore no-console
  console.log("=".repeat(50));

  if (result.created.length > 0) {
    // deno-lint-ignore no-console
    console.log(`\nCreated (${result.created.length} items)`);
  }

  if (result.skipped.length > 0) {
    // deno-lint-ignore no-console
    console.log(`Skipped (${result.skipped.length} items - already exist)`);
  }

  if (result.errors.length > 0) {
    // deno-lint-ignore no-console
    console.log(`\nErrors:`);
    for (const error of result.errors) {
      // deno-lint-ignore no-console
      console.log(`  - ${error}`);
    }
  }

  // deno-lint-ignore no-console
  console.log("\nAvailable meta commands:");
  // deno-lint-ignore no-console
  console.log(
    "  climpt-meta build frontmatter    # Generate C3L frontmatter for new instruction",
  );
  // deno-lint-ignore no-console
  console.log(
    "  climpt-meta create instruction   # Create new Climpt instruction file",
  );

  // deno-lint-ignore no-console
  console.log("\nNext steps:");
  // deno-lint-ignore no-console
  console.log("  1. Create new instruction:");
  // deno-lint-ignore no-console
  console.log(
    '     echo "Domain: code, Action: review, Target: pull-request" | climpt-meta create instruction',
  );
  // deno-lint-ignore no-console
  console.log(
    `  2. Or add prompts manually to ${options.workingDir}/prompts/<domain>/`,
  );
  // deno-lint-ignore no-console
  console.log(
    "  3. After adding prompts, run 'climpt generate-registry' to update registry",
  );

  // deno-lint-ignore no-console
  console.log("\nClaude Code Plugin:");
  // deno-lint-ignore no-console
  console.log("  /plugin marketplace add tettuan/climpt");
  // deno-lint-ignore no-console
  console.log("  /plugin install climpt-agent");
}
