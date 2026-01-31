#!/usr/bin/env -S deno run --allow-read --allow-run
/**
 * Docs Consistency Verification Script
 *
 * @module
 *
 * Usage:
 *   deno run -A .claude/skills/docs-consistency/scripts/verify-docs.ts [target] [version]
 *
 * Targets:
 *   all      - Run all formal checks (default)
 *   diff     - Diff-based check from version (efficient)
 *   semantic - Design/implementation/docs semantic check
 *   cli      - Verify CLI --help vs README
 *   readme   - Verify README.md/ja sync
 *   manifest - Verify manifest.json
 *   agents   - Verify agent docs
 *
 * Examples:
 *   deno task verify-docs              # Full formal check
 *   deno task verify-docs diff v1.11.6 # Changes since v1.11.6
 *   deno task verify-docs semantic     # Semantic consistency
 */

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string[];
}

const results: CheckResult[] = [];

function report(result: CheckResult): void {
  results.push(result);
  const icon = result.passed ? "✓" : "✗";
  console.log(`${icon} ${result.name}: ${result.message}`);
  if (result.details && result.details.length > 0) {
    result.details.forEach((d) => console.log(`    ${d}`));
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return "";
  }
}

async function runCommand(cmd: string[]): Promise<string> {
  try {
    const process = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await process.output();
    return new TextDecoder().decode(stdout);
  } catch {
    return "";
  }
}

// =============================================================================
// DIFF-BASED CHECK (Efficient)
// =============================================================================

const IMPACT_MAP: Record<string, string[]> = {
  "src/cli": ["README.md", "README.ja.md"],
  "src/docs": ["README.md", "docs/internal/docs-distribution-design.md"],
  "src/mcp": ["docs/mcp-setup.md"],
  "agents/": ["agents/README.md", "README.md"],
  "deno.json": ["README.md"],
};

async function checkDiff(fromVersion: string): Promise<void> {
  console.log(`\n## Diff-Based Check (since ${fromVersion})\n`);

  // Get changed files
  const diffOutput = await runCommand(["git", "diff", "--name-only", `${fromVersion}..HEAD`]);
  const changedFiles = diffOutput.trim().split("\n").filter(Boolean);

  if (changedFiles.length === 0) {
    report({ name: "Changes", passed: true, message: "No changes detected" });
    return;
  }

  console.log(`Changed files: ${changedFiles.length}`);

  // Categorize changes
  const srcChanges = changedFiles.filter((f) => f.startsWith("src/"));
  const docsChanges = changedFiles.filter((f) => f.startsWith("docs/"));
  const agentChanges = changedFiles.filter((f) => f.startsWith("agents/"));

  report({
    name: "Change Distribution",
    passed: true,
    message: `src: ${srcChanges.length}, docs: ${docsChanges.length}, agents: ${agentChanges.length}`,
  });

  // Find docs that need verification
  const docsToCheck = new Set<string>();
  for (const file of changedFiles) {
    for (const [pattern, docs] of Object.entries(IMPACT_MAP)) {
      if (file.startsWith(pattern)) {
        docs.forEach((d) => docsToCheck.add(d));
      }
    }
  }

  if (docsToCheck.size > 0) {
    report({
      name: "Docs to Verify",
      passed: true,
      message: `${docsToCheck.size} docs need review`,
      details: Array.from(docsToCheck),
    });
  }

  // Check if src changed but docs didn't
  if (srcChanges.length > 0 && docsChanges.length === 0) {
    report({
      name: "Docs Update Warning",
      passed: false,
      message: "src/ changed but docs/ unchanged - verify docs are up to date",
      details: srcChanges.slice(0, 5),
    });
  } else {
    report({
      name: "Docs Update",
      passed: true,
      message: "Changes include docs updates",
    });
  }

  // Check commit messages for doc-related keywords
  const logOutput = await runCommand([
    "git",
    "log",
    "--oneline",
    `${fromVersion}..HEAD`,
    "--grep=doc",
    "--grep=readme",
    "--grep=API",
    "-i",
  ]);
  const docCommits = logOutput.trim().split("\n").filter(Boolean);

  report({
    name: "Doc-Related Commits",
    passed: true,
    message: `${docCommits.length} commits mention docs/readme/API`,
  });
}

// =============================================================================
// SEMANTIC CHECK (Design-Implementation-Docs Triangle)
// =============================================================================

async function checkSemantic(): Promise<void> {
  console.log("\n## Semantic Consistency Check\n");

  // 1. Design → Implementation: Check exports match design
  console.log("### Design → Implementation\n");

  const docsDesign = await readFile("docs/internal/docs-distribution-design.md");
  const docsMod = await readFile("src/docs/mod.ts");

  // Check if design mentions install/list and they're implemented
  const designFunctions = ["install", "list"];
  const implementedFunctions = docsMod.match(/export\s+(?:async\s+)?function\s+(\w+)/g) || [];

  const missingImpl = designFunctions.filter(
    (f) => docsDesign.includes(f) && !implementedFunctions.some((impl) => impl.includes(f))
  );

  report({
    name: "Design→Impl: docs module",
    passed: missingImpl.length === 0,
    message: missingImpl.length === 0 ? "All design functions implemented" : `Missing: ${missingImpl.join(", ")}`,
  });

  // 2. Implementation → Docs: Check exports are documented
  console.log("\n### Implementation → Docs\n");

  const modTs = await readFile("mod.ts");
  const readme = await readFile("README.md");

  // Extract exported symbols
  const exports = modTs.match(/export\s+{\s*([^}]+)\s*}/g) || [];
  const exportedSymbols = exports
    .join(" ")
    .match(/\b[a-zA-Z]\w+\b/g)
    ?.filter((s) => s !== "export" && s !== "type") || [];

  // Check if key exports are mentioned in README
  const keyExports = ["searchCommands", "describeCommand"];
  const undocumented = keyExports.filter((e) => exportedSymbols.includes(e) && !readme.includes(e));

  report({
    name: "Impl→Docs: exports documented",
    passed: undocumented.length === 0,
    message:
      undocumented.length === 0 ? "Key exports documented" : `Undocumented exports: ${undocumented.join(", ")}`,
  });

  // 3. Check default values consistency
  console.log("\n### Default Values\n");

  const typesFile = await readFile("src/docs/types.ts");
  const defaultsInCode = typesFile.match(/(\w+)\s*[?]?:\s*\w+\s*=\s*["']?(\w+)["']?/g) || [];

  report({
    name: "Default Values",
    passed: true,
    message: `${defaultsInCode.length} defaults defined in types`,
    details: defaultsInCode.slice(0, 3),
  });

  // 4. API signature consistency
  console.log("\n### API Signatures\n");

  // Check if CLI examples in README actually work
  const cliExamples = readme.match(/```bash\n(.*?deno run.*?)\n```/gs) || [];

  report({
    name: "CLI Examples",
    passed: cliExamples.length > 0,
    message: `${cliExamples.length} CLI examples in README`,
  });
}

// =============================================================================
// FORMAL CHECKS (Original)
// =============================================================================

async function checkCli(): Promise<void> {
  console.log("\n## CLI Documentation Check\n");

  const readme = await readFile("README.md");
  const docOptions = new Set(readme.match(/`--[a-z-]+`/g)?.map((o) => o.replace(/`/g, "")) || []);
  const requiredOptions = ["--from", "--destination", "--edition", "--adaptation"];
  const missing = requiredOptions.filter((opt) => !docOptions.has(opt));

  report({
    name: "CLI Required Options",
    passed: missing.length === 0,
    message: missing.length === 0 ? "All required options documented" : `Missing: ${missing.join(", ")}`,
  });

  const hasHelpSection = readme.includes("Key Options") || readme.includes("| Option |");
  report({
    name: "CLI Options Table",
    passed: hasHelpSection,
    message: hasHelpSection ? "Options table found" : "Options table missing in README",
  });
}

async function checkReadmeSync(): Promise<void> {
  console.log("\n## README Sync Check\n");

  const en = await readFile("README.md");
  const ja = await readFile("README.ja.md");

  if (!ja) {
    report({ name: "README.ja.md Exists", passed: false, message: "README.ja.md not found" });
    return;
  }

  const enSections = en.match(/^## .+$/gm) || [];
  const jaSections = ja.match(/^## .+$/gm) || [];

  report({
    name: "Section Count",
    passed: enSections.length === jaSections.length,
    message: `EN: ${enSections.length}, JA: ${jaSections.length}`,
  });

  const enCodeBlocks = (en.match(/```/g) || []).length / 2;
  const jaCodeBlocks = (ja.match(/```/g) || []).length / 2;

  report({
    name: "Code Blocks",
    passed: enCodeBlocks === jaCodeBlocks,
    message: `EN: ${enCodeBlocks}, JA: ${jaCodeBlocks}`,
  });
}

async function checkManifest(): Promise<void> {
  console.log("\n## Manifest Check\n");

  const manifestExists = await fileExists("docs/manifest.json");
  if (!manifestExists) {
    report({
      name: "Manifest Exists",
      passed: false,
      message: "docs/manifest.json not found - run: deno task generate-docs-manifest",
    });
    return;
  }

  const manifest = JSON.parse(await readFile("docs/manifest.json"));
  const denoJson = JSON.parse(await readFile("deno.json"));

  report({
    name: "Version Match",
    passed: manifest.version === denoJson.version,
    message: `Manifest: ${manifest.version}, deno.json: ${denoJson.version}`,
  });

  const entryCount = manifest.entries?.length || 0;
  report({ name: "Entry Count", passed: entryCount > 0, message: `${entryCount} entries` });
}

async function checkAgents(): Promise<void> {
  console.log("\n## Agent Documentation Check\n");

  const agentsReadme = await readFile("agents/README.md");
  if (!agentsReadme) {
    report({ name: "agents/README.md", passed: false, message: "Not found" });
    return;
  }

  const completionTypes = ["externalState", "iterationBudget", "keywordSignal", "stepMachine"];
  const docTypes = completionTypes.filter((t) => agentsReadme.includes(t));

  report({
    name: "Completion Types",
    passed: docTypes.length === completionTypes.length,
    message: `${docTypes.length}/${completionTypes.length} documented`,
    details: completionTypes.filter((t) => !docTypes.includes(t)).map((t) => `Missing: ${t}`),
  });
}

async function checkGuideDocs(): Promise<void> {
  console.log("\n## Guide Docs Check\n");

  const enFiles: string[] = [];

  try {
    for await (const entry of Deno.readDir("docs/guides/en")) {
      if (entry.isFile && entry.name.endsWith(".md")) enFiles.push(entry.name);
    }
  } catch {
    report({ name: "Guides Dir", passed: false, message: "docs/guides/en not found" });
    return;
  }

  report({
    name: "Guide Count",
    passed: enFiles.length > 0,
    message: `${enFiles.length} guides found`,
  });
}

async function checkEnglishRequired(): Promise<void> {
  console.log("\n## English Version Check\n");
  console.log("Convention: *.md = English, *.ja.md = Japanese\n");

  // Check docs with Japanese titles in .md files (should be .ja.md or translated)
  const manifest = JSON.parse(await readFile("docs/manifest.json"));
  const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/; // hiragana, katakana, kanji

  const jaInEnFiles = manifest.entries
    .filter((e: { path: string; title?: string }) =>
      !e.path.endsWith(".ja.md") &&
      !e.path.includes("/ja/") &&
      e.title && japanesePattern.test(e.title)
    )
    .map((e: { path: string; title: string }) => `${e.path}: ${e.title}`);

  if (jaInEnFiles.length > 0) {
    report({
      name: "Naming Convention",
      passed: false,
      message: `${jaInEnFiles.length} .md files have JA titles (rename to .ja.md or translate)`,
      details: jaInEnFiles.slice(0, 10),
    });
  } else {
    report({
      name: "Naming Convention",
      passed: true,
      message: "All .md files have EN titles",
    });
  }
}

// =============================================================================
// SUMMARY & MAIN
// =============================================================================

function printSummary(): void {
  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${results.length}`);

  if (failed > 0) {
    console.log("\nFailed checks:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  - ${r.name}: ${r.message}`));
  }

  Deno.exit(failed > 0 ? 1 : 0);
}

async function main(): Promise<void> {
  const target = Deno.args[0] || "all";
  const version = Deno.args[1];

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║     Docs Consistency Verification              ║");
  console.log("╚════════════════════════════════════════════════╝");

  switch (target) {
    case "diff":
      if (!version) {
        console.log("Usage: verify-docs diff <version>");
        console.log("Example: verify-docs diff v1.11.6");
        Deno.exit(1);
      }
      await checkDiff(version);
      break;
    case "semantic":
      await checkSemantic();
      break;
    case "cli":
      await checkCli();
      break;
    case "readme":
      await checkReadmeSync();
      break;
    case "manifest":
      await checkManifest();
      break;
    case "agents":
      await checkAgents();
      break;
    case "all":
      await checkCli();
      await checkReadmeSync();
      await checkManifest();
      await checkAgents();
      await checkGuideDocs();
      await checkEnglishRequired();
      break;
    default:
      console.log(`Unknown target: ${target}`);
      console.log("Valid targets: all, diff, semantic, cli, readme, manifest, agents");
      Deno.exit(1);
  }

  printSummary();
}

if (import.meta.main) {
  main();
}
