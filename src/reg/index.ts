/**
 * Registry Generation Module
 *
 * Generates registry.json from prompt frontmatter using @aidevtool/frontmatter-to-schema.
 */

import { transformFiles } from "@aidevtool/frontmatter-to-schema";

/**
 * Options for registry generation
 */
export interface GenerateOptions {
  /** Base directory (defaults to Deno.cwd()) */
  baseDir?: string;
  /** Path to schema file */
  schema?: string;
  /** Glob pattern for input files */
  input?: string;
  /** Output file path */
  output?: string;
  /** Template file path */
  template?: string;
}

/**
 * Default paths relative to baseDir
 */
const DEFAULTS = {
  schema: ".agent/climpt/frontmatter-to-schema/registry.schema.json",
  input: ".agent/climpt/prompts/**/*.md",
  output: ".agent/climpt/registry.json",
  template: ".agent/climpt/frontmatter-to-schema/registry.template.json",
};

/**
 * JSR package paths for fallback (relative to src/reg/index.ts)
 */
const JSR_PATHS = {
  schema: "../../.agent/climpt/frontmatter-to-schema/registry.schema.json",
  template: "../../.agent/climpt/frontmatter-to-schema/registry.template.json",
};

/**
 * Check if a local file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch file from JSR package and save to temp directory
 *
 * Handles both file:// (local) and https:// (JSR) URLs.
 *
 * @param jsrRelativePath - Relative path from this module to the file in JSR package
 * @param filename - Filename for the temp file
 * @returns Path to the temp file
 */
async function fetchFromJsr(
  jsrRelativePath: string,
  filename: string
): Promise<string> {
  const url = import.meta.resolve(jsrRelativePath);

  let content: string;

  if (url.startsWith("file://")) {
    // Local file:// URL - read directly
    const filePath = new URL(url).pathname;
    content = await Deno.readTextFile(filePath);
  } else {
    // Remote URL (JSR) - use fetch
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    content = await response.text();
  }

  const tempDir = await Deno.makeTempDir({ prefix: "climpt_reg_" });
  const tempPath = `${tempDir}/${filename}`;

  await Deno.writeTextFile(tempPath, content);
  return tempPath;
}

/**
 * Resolve file path with JSR fallback
 *
 * @param localPath - Local file path to try first
 * @param jsrPath - JSR relative path for fallback
 * @param filename - Filename for temp file
 * @returns Resolved file path (local or temp)
 */
async function resolveWithFallback(
  localPath: string,
  jsrPath: string,
  filename: string
): Promise<{ path: string; isTemp: boolean }> {
  if (await fileExists(localPath)) {
    return { path: localPath, isTemp: false };
  }

  console.log(`  Local file not found: ${localPath}`);
  console.log(`  Fetching from JSR package...`);

  const tempPath = await fetchFromJsr(jsrPath, filename);
  return { path: tempPath, isTemp: true };
}

/**
 * Clean up temp files
 */
async function cleanupTemp(paths: { path: string; isTemp: boolean }[]) {
  for (const { path, isTemp } of paths) {
    if (isTemp) {
      try {
        const dir = path.substring(0, path.lastIndexOf("/"));
        await Deno.remove(dir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Generate registry.json from prompt frontmatter
 *
 * If schema or template files are not found locally,
 * they will be fetched from the JSR package as fallback.
 *
 * @param options - Generation options
 * @returns Result with processed documents count and output path
 */
export async function generateRegistry(options: GenerateOptions = {}) {
  const baseDir = options.baseDir ?? Deno.cwd();

  const localSchema = options.schema ?? `${baseDir}/${DEFAULTS.schema}`;
  const localTemplate = options.template ?? `${baseDir}/${DEFAULTS.template}`;
  const input = options.input ?? `${baseDir}/${DEFAULTS.input}`;
  const output = options.output ?? `${baseDir}/${DEFAULTS.output}`;

  // Resolve schema and template with JSR fallback
  const tempPaths: { path: string; isTemp: boolean }[] = [];

  let schema: string;
  let template: string;

  try {
    const schemaResolved = await resolveWithFallback(
      localSchema,
      JSR_PATHS.schema,
      "registry.schema.json"
    );
    tempPaths.push(schemaResolved);
    schema = schemaResolved.path;

    const templateResolved = await resolveWithFallback(
      localTemplate,
      JSR_PATHS.template,
      "registry.template.json"
    );
    tempPaths.push(templateResolved);
    template = templateResolved.path;

    const result = await transformFiles({
      schema,
      input,
      output,
      template,
    });

    if (result.isOk()) {
      return result.unwrap();
    } else {
      throw new Error(`Registry generation failed: ${result}`);
    }
  } finally {
    await cleanupTemp(tempPaths);
  }
}

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]): GenerateOptions {
  const options: GenerateOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      Deno.exit(0);
    }

    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      if (value) {
        switch (key) {
          case "base":
            options.baseDir = value;
            break;
          case "schema":
            options.schema = value;
            break;
          case "input":
            options.input = value;
            break;
          case "output":
            options.output = value;
            break;
          case "template":
            options.template = value;
            break;
        }
      }
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Usage: deno run jsr:@aidevtool/climpt/reg [options]

Generate registry.json from prompt frontmatter.

Options:
  --base=<dir>       Base directory (default: current directory)
  --schema=<path>    Schema file path
  --input=<pattern>  Input glob pattern
  --output=<path>    Output file path
  --template=<path>  Template file path
  -h, --help         Show this help

If schema or template files are not found locally, they will be
fetched from the JSR package automatically.

Examples:
  # Use defaults (run from project root)
  deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg

  # Custom output path
  deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg --output=./registry.json
`);
}

/**
 * Main CLI entry point
 */
export async function main(args: string[] = Deno.args) {
  const options = parseArgs(args);

  console.log("Generating registry.json from prompt frontmatter...");

  try {
    const { processedDocuments, outputPath, executionTime } =
      await generateRegistry(options);
    console.log(`\nSuccess! Generated registry.json`);
    console.log(`  Processed: ${processedDocuments} documents`);
    console.log(`  Output: ${outputPath}`);
    console.log(`  Time: ${executionTime}ms`);
  } catch (error) {
    console.error(`\nError:`, error);
    Deno.exit(1);
  }
}
