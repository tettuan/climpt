/**
 * @fileoverview Common test utilities and helpers
 * @module tests/test-utils
 *
 * This module provides shared test utilities to avoid duplication across test files.
 */

import type { Command } from "../src/mcp/types.ts";

// =============================================================================
// Temporary Directory Utilities
// =============================================================================

/**
 * Create a temporary directory for testing
 * @param prefix - Optional prefix for the temp directory name
 * @returns Path to the created temporary directory
 */
export async function createTempDir(
  prefix = "climpt_test_",
): Promise<string> {
  return await Deno.makeTempDir({ prefix });
}

/**
 * Clean up temporary directory
 * @param dir - Path to the directory to remove
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Sample Test Data
// =============================================================================

/**
 * Sample commands for testing search and similarity functions
 * These commands represent typical C3L v0.5 command structures
 */
export const sampleCommands: Command[] = [
  {
    c1: "git",
    c2: "group-commit",
    c3: "unstaged-changes",
    description:
      "Group file changes by semantic proximity and execute multiple commits sequentially",
    usage: "climpt-git group-commit unstaged-changes",
    options: {
      edition: ["default"],
      adaptation: ["default", "detailed"],
      file: true,
      stdin: false,
      destination: true,
    },
  },
  {
    c1: "git",
    c2: "decide-branch",
    c3: "working-branch",
    description:
      "Decide whether to create a new branch or continue on the current branch",
    usage: "climpt-git decide-branch working-branch",
    options: {
      edition: ["default"],
      adaptation: ["default"],
      file: false,
      stdin: true,
      destination: false,
    },
  },
  {
    c1: "meta",
    c2: "build",
    c3: "frontmatter",
    description:
      "Generate C3L v0.5 compliant frontmatter for instruction files",
    usage: "climpt-meta build frontmatter",
    options: {
      edition: ["default"],
      adaptation: ["default", "detailed"],
      file: false,
      stdin: true,
      destination: true,
    },
  },
  {
    c1: "meta",
    c2: "create",
    c3: "instruction",
    description: "Create a new Climpt instruction file from stdin input",
    usage: "climpt-meta create instruction",
    options: {
      edition: ["default"],
      adaptation: ["default", "detailed"],
      file: false,
      stdin: true,
      destination: true,
    },
  },
];

/**
 * Sample commands for testing BM25 algorithm behavior
 * These commands are designed to test IDF weighting and term frequency
 */
export const bm25TestCommands: Command[] = [
  {
    c1: "meta",
    c2: "create",
    c3: "instruction",
    description: "Create a new Climpt instruction file from stdin input",
    usage: "climpt-meta create instruction",
  },
  {
    c1: "workflows",
    c2: "create",
    c3: "verification-issue",
    description: "Create verification issue for workflow validation",
    usage: "climpt-workflows create verification-issue",
  },
  {
    c1: "requirements",
    c2: "draft",
    c3: "entry",
    description: "Draft a new requirements specification document",
    usage: "climpt-requirements draft entry",
  },
  {
    c1: "spec",
    c2: "analyze",
    c3: "coverage",
    description: "Analyze specification coverage and gaps",
    usage: "climpt-spec analyze coverage",
  },
];
