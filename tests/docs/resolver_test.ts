/**
 * @fileoverview Unit tests for docs resolver module
 * @module tests/docs/resolver_test
 *
 * Tests for the filterEntries function from src/docs/resolver.ts
 */

import { assertEquals } from "@std/assert";
import { filterEntries } from "../../src/docs/resolver.ts";
import type { Entry } from "../../src/docs/types.ts";
import { createTestLogger } from "../test-utils.ts";

const logger = createTestLogger("docs-resolver");

// ============================================================================
// Test Data
// ============================================================================

const sampleEntries: Entry[] = [
  {
    id: "git-basics",
    path: "guides/git-basics.md",
    category: "guides",
    lang: "en",
    title: "Git Basics",
  },
  {
    id: "git-basics-ja",
    path: "guides/ja/git-basics.md",
    category: "guides",
    lang: "ja",
    title: "Git 基礎",
  },
  {
    id: "api-reference",
    path: "reference/api.md",
    category: "reference",
    lang: "en",
    title: "API Reference",
  },
  {
    id: "api-reference-ja",
    path: "reference/ja/api.md",
    category: "reference",
    lang: "ja",
    title: "API リファレンス",
  },
  {
    id: "internal-design",
    path: "internal/design.md",
    category: "internal",
    title: "Internal Design",
  },
  {
    id: "quick-start",
    path: "guides/quick-start.md",
    category: "guides",
    title: "Quick Start",
  },
];

// ============================================================================
// filterEntries() Tests
// ============================================================================

Deno.test("filterEntries: returns all entries when no filters", () => {
  const result = filterEntries(sampleEntries);
  logger.debug("filterEntries result", {
    inputCount: sampleEntries.length,
    resultCount: result.length,
  });
  assertEquals(result.length, 6);
});

Deno.test("filterEntries: filters by category guides", () => {
  const result = filterEntries(sampleEntries, "guides");
  assertEquals(result.length, 3);
  assertEquals(result.every((e) => e.category === "guides"), true);
});

Deno.test("filterEntries: filters by category reference", () => {
  const result = filterEntries(sampleEntries, "reference");
  assertEquals(result.length, 2);
  assertEquals(result.every((e) => e.category === "reference"), true);
});

Deno.test("filterEntries: filters by category internal", () => {
  const result = filterEntries(sampleEntries, "internal");
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "internal-design");
});

Deno.test("filterEntries: filters by lang ja", () => {
  const result = filterEntries(sampleEntries, undefined, "ja");
  // Should include lang=ja entries AND entries with no lang
  // 2 ja entries + 2 no-lang entries (internal-design, quick-start)
  assertEquals(result.length, 4);
  assertEquals(result.every((e) => !e.lang || e.lang === "ja"), true);
});

Deno.test("filterEntries: filters by lang en", () => {
  const result = filterEntries(sampleEntries, undefined, "en");
  // Should include lang=en entries AND entries with no lang
  // 2 en entries + 2 no-lang entries (internal-design, quick-start)
  assertEquals(result.length, 4);
  assertEquals(result.every((e) => !e.lang || e.lang === "en"), true);
});

Deno.test("filterEntries: includes entries with no lang when filtering by lang", () => {
  const result = filterEntries(sampleEntries, undefined, "en");
  // Should include "api-reference" (lang=en), "git-basics" (lang=en),
  // "internal-design" (no lang), and "quick-start" (no lang)
  assertEquals(result.length, 4);
  const hasNoLangEntry = result.some((e) => !e.lang);
  assertEquals(hasNoLangEntry, true);
});

Deno.test("filterEntries: filters by both category and lang", () => {
  const result = filterEntries(sampleEntries, "guides", "ja");
  logger.debug("filterEntries input", { category: "guides", lang: "ja" });
  logger.debug("filterEntries result", { resultIds: result.map((e) => e.id) });
  // Should include: git-basics-ja (guides+ja) and quick-start (guides+no-lang)
  assertEquals(result.length, 2);
  assertEquals(result.some((e) => e.id === "git-basics-ja"), true);
  assertEquals(result.some((e) => e.id === "quick-start"), true);
});

Deno.test("filterEntries: returns empty when no matches category", () => {
  const result = filterEntries(sampleEntries, "nonexistent");
  assertEquals(result.length, 0);
});

Deno.test("filterEntries: handles empty entries array", () => {
  const result = filterEntries([]);
  assertEquals(result.length, 0);
});

Deno.test("filterEntries: category filter with undefined lang", () => {
  const result = filterEntries(sampleEntries, "internal", undefined);
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "internal-design");
});

Deno.test("filterEntries: includes no-lang entries when filtering", () => {
  // "internal-design" has no lang field
  const result = filterEntries(sampleEntries, "internal");
  assertEquals(result.length, 1);
  assertEquals(result[0].lang, undefined);
});

Deno.test("filterEntries: lang filter matches only specified lang or no-lang", () => {
  const entries: Entry[] = [
    { id: "a", path: "a.md", category: "guides", lang: "en" },
    { id: "b", path: "b.md", category: "guides", lang: "ja" },
    { id: "c", path: "c.md", category: "guides" }, // no lang
  ];
  const result = filterEntries(entries, undefined, "ja");
  logger.debug("filterEntries lang-only result", {
    lang: "ja",
    matchedIds: result.map((e) => e.id),
  });
  assertEquals(result.length, 2);
  assertEquals(result.some((e) => e.id === "b"), true); // ja match
  assertEquals(result.some((e) => e.id === "c"), true); // no lang
});
