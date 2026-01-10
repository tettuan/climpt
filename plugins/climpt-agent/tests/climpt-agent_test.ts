// deno-lint-ignore-file prefer-ascii
/**
 * @fileoverview Tests for climpt-agent plugin
 *
 * These tests protect design invariants that should NOT be changed without careful consideration.
 * They ensure backward compatibility and expected behavior.
 *
 * @module climpt-plugins/tests/climpt-agent_test
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Import modules under test
import { generateSubAgentName } from "../skills/delegate-climpt-agent/scripts/climpt-agent/command.ts";
import {
  parseArgs,
  validateArgs,
} from "../skills/delegate-climpt-agent/scripts/climpt-agent/cli.ts";
import type {
  CliArgs,
  ClimptCommand,
} from "../skills/delegate-climpt-agent/scripts/climpt-agent/types.ts";

// =============================================================================
// Design Invariant: Sub-agent Naming Convention (C3L)
// =============================================================================

Deno.test("Design Invariant: generateSubAgentName follows C3L pattern", () => {
  const cmd: ClimptCommand = {
    agent: "climpt",
    c1: "git",
    c2: "group-commit",
    c3: "unstaged-changes",
  };

  const name = generateSubAgentName(cmd);

  // Format: <agent>-<c1>-<c2>-<c3>
  assertEquals(name, "climpt-git-group-commit-unstaged-changes");
});

Deno.test("Design Invariant: generateSubAgentName works with custom agent", () => {
  const cmd: ClimptCommand = {
    agent: "custom",
    c1: "meta",
    c2: "build",
    c3: "frontmatter",
  };

  const name = generateSubAgentName(cmd);

  assertEquals(name, "custom-meta-build-frontmatter");
});

// =============================================================================
// Design Invariant: CLI Argument Parsing
// =============================================================================

Deno.test("Design Invariant: parseArgs extracts --action and --target", () => {
  const args = parseArgs(["--action=execute test", "--target=specific file"]);

  assertEquals(args.action, "execute test");
  assertEquals(args.target, "specific file");
});

Deno.test("Design Invariant: parseArgs extracts --intent separately", () => {
  const args = parseArgs([
    "--action=commit changes",
    "--target=staged files",
    "--intent=新機能追加のコミットメッセージを作成",
  ]);

  assertEquals(args.action, "commit changes");
  assertEquals(args.target, "staged files");
  assertEquals(args.intent, "新機能追加のコミットメッセージを作成");
});

Deno.test("Design Invariant: parseArgs defaults agent to 'climpt'", () => {
  const args = parseArgs(["--action=test", "--target=file"]);

  assertEquals(args.agent, "climpt");
});

Deno.test("Design Invariant: parseArgs extracts --agent", () => {
  const args = parseArgs([
    "--action=test",
    "--target=file",
    "--agent=custom-agent",
  ]);

  assertEquals(args.agent, "custom-agent");
});

Deno.test("Design Invariant: parseArgs extracts --options as comma-separated", () => {
  const args = parseArgs([
    "--action=test",
    "--target=file",
    "--options=-e=issue,-a=detailed",
  ]);

  assertEquals(args.options, ["-e=issue", "-a=detailed"]);
});

Deno.test("Design Invariant: parseArgs returns empty options array by default", () => {
  const args = parseArgs(["--action=test", "--target=file"]);

  assertEquals(args.options, []);
});

// =============================================================================
// Design Invariant: CLI Validation
// =============================================================================

Deno.test("Design Invariant: validateArgs requires action and target", () => {
  const args: CliArgs = {
    agent: "climpt",
    options: [],
    // action and target are missing
  };

  let exitCalled = false;
  const originalExit = Deno.exit;
  // @ts-ignore - mock Deno.exit for testing
  Deno.exit = () => {
    exitCalled = true;
    throw new Error("exit called");
  };

  try {
    validateArgs(args);
  } catch {
    // Expected
  }

  // @ts-ignore - restore
  Deno.exit = originalExit;

  assertEquals(exitCalled, true);
});
