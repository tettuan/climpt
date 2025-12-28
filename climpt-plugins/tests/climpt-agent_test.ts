/**
 * @fileoverview Tests for climpt-agent plugin
 *
 * These tests protect design invariants that should NOT be changed without careful consideration.
 * They ensure backward compatibility and expected behavior.
 *
 * @module climpt-plugins/tests/climpt-agent_test
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Import modules under test
import { generateSubAgentName } from "../plugins/climpt-agent/skills/delegate-climpt-agent/scripts/climpt-agent/command.ts";
import {
  parseArgs,
  validateArgs,
} from "../plugins/climpt-agent/skills/delegate-climpt-agent/scripts/climpt-agent/cli.ts";
import type {
  CliArgs,
  ClimptCommand,
} from "../plugins/climpt-agent/skills/delegate-climpt-agent/scripts/climpt-agent/types.ts";

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

Deno.test("Design Invariant: parseArgs extracts --query", () => {
  const args = parseArgs(['--query=create commit message']);

  assertEquals(args.query, "create commit message");
});

Deno.test("Design Invariant: parseArgs extracts --intent separately from --query", () => {
  const args = parseArgs([
    '--query=commit message',
    '--intent=新機能追加のコミットメッセージを作成',
  ]);

  assertEquals(args.query, "commit message");
  assertEquals(args.intent, "新機能追加のコミットメッセージを作成");
});

Deno.test("Design Invariant: parseArgs defaults agent to 'climpt'", () => {
  const args = parseArgs(['--query=test']);

  assertEquals(args.agent, "climpt");
});

Deno.test("Design Invariant: parseArgs extracts --agent", () => {
  const args = parseArgs(['--query=test', '--agent=custom-agent']);

  assertEquals(args.agent, "custom-agent");
});

Deno.test("Design Invariant: parseArgs extracts --options as comma-separated", () => {
  const args = parseArgs(['--query=test', '--options=-e=issue,-a=detailed']);

  assertEquals(args.options, ["-e=issue", "-a=detailed"]);
});

Deno.test("Design Invariant: parseArgs returns empty options array by default", () => {
  const args = parseArgs(['--query=test']);

  assertEquals(args.options, []);
});

// =============================================================================
// Design Invariant: CLI Validation
// =============================================================================

Deno.test("Design Invariant: validateArgs requires query", () => {
  const args: CliArgs = {
    agent: "climpt",
    options: [],
    // query is missing
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

// =============================================================================
// Design Invariant: CliArgs Type Structure
// =============================================================================

Deno.test("Design Invariant: CliArgs has required fields", () => {
  const args: CliArgs = {
    query: "test query",
    intent: "detailed intent",
    agent: "climpt",
    options: ["-e=default"],
  };

  // Verify all fields exist
  assertExists(args.query);
  assertExists(args.intent);
  assertExists(args.agent);
  assertExists(args.options);
});

Deno.test("Design Invariant: CliArgs intent is optional", () => {
  const args: CliArgs = {
    agent: "climpt",
    options: [],
  };

  // intent can be undefined
  assertEquals(args.intent, undefined);
});

// =============================================================================
// Design Invariant: ClimptCommand Type Structure
// =============================================================================

Deno.test("Design Invariant: ClimptCommand has C3L fields", () => {
  const cmd: ClimptCommand = {
    agent: "climpt",
    c1: "domain",
    c2: "action",
    c3: "target",
    options: ["-e=default"],
  };

  // C3L required fields
  assertExists(cmd.c1);
  assertExists(cmd.c2);
  assertExists(cmd.c3);
  assertExists(cmd.agent);

  // options is optional but present
  assertEquals(cmd.options, ["-e=default"]);
});

Deno.test("Design Invariant: ClimptCommand options is optional", () => {
  const cmd: ClimptCommand = {
    agent: "climpt",
    c1: "meta",
    c2: "build",
    c3: "frontmatter",
  };

  assertEquals(cmd.options, undefined);
});
