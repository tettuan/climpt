/**
 * Git Status Extractors Tests
 */

import { assertEquals } from "@std/assert";
import {
  parseChangedFiles,
  parseStagedFiles,
  parseUnstagedFiles,
  parseUntrackedFiles,
} from "./git-status.ts";

// parseChangedFiles tests
Deno.test("parseChangedFiles - parses modified files", () => {
  const stdout = " M file1.ts\n M file2.ts\n";
  const result = parseChangedFiles(stdout);
  assertEquals(result, ["file1.ts", "file2.ts"]);
});

Deno.test("parseChangedFiles - parses added files", () => {
  const stdout = "A  file1.ts\n";
  const result = parseChangedFiles(stdout);
  assertEquals(result, ["file1.ts"]);
});

Deno.test("parseChangedFiles - excludes untracked files", () => {
  const stdout = " M file1.ts\n?? file2.ts\n";
  const result = parseChangedFiles(stdout);
  assertEquals(result, ["file1.ts"]);
});

Deno.test("parseChangedFiles - handles empty output", () => {
  const stdout = "";
  const result = parseChangedFiles(stdout);
  assertEquals(result, []);
});

// parseUntrackedFiles tests
Deno.test("parseUntrackedFiles - parses untracked files", () => {
  const stdout = "?? file1.ts\n?? file2.ts\n";
  const result = parseUntrackedFiles(stdout);
  assertEquals(result, ["file1.ts", "file2.ts"]);
});

Deno.test("parseUntrackedFiles - excludes modified files", () => {
  const stdout = " M file1.ts\n?? file2.ts\n";
  const result = parseUntrackedFiles(stdout);
  assertEquals(result, ["file2.ts"]);
});

Deno.test("parseUntrackedFiles - handles empty output", () => {
  const stdout = "";
  const result = parseUntrackedFiles(stdout);
  assertEquals(result, []);
});

// parseStagedFiles tests
Deno.test("parseStagedFiles - parses staged files", () => {
  const stdout = "M  file1.ts\nA  file2.ts\n";
  const result = parseStagedFiles(stdout);
  assertEquals(result, ["file1.ts", "file2.ts"]);
});

Deno.test("parseStagedFiles - excludes unstaged only files", () => {
  const stdout = " M file1.ts\nM  file2.ts\n";
  const result = parseStagedFiles(stdout);
  assertEquals(result, ["file2.ts"]);
});

// parseUnstagedFiles tests
Deno.test("parseUnstagedFiles - parses unstaged files", () => {
  const stdout = " M file1.ts\n M file2.ts\n";
  const result = parseUnstagedFiles(stdout);
  assertEquals(result, ["file1.ts", "file2.ts"]);
});

Deno.test("parseUnstagedFiles - excludes staged only files", () => {
  const stdout = "M  file1.ts\n M file2.ts\n";
  const result = parseUnstagedFiles(stdout);
  assertEquals(result, ["file2.ts"]);
});
