/**
 * @fileoverview Unit tests for docs writer module
 * @module tests/docs/writer_test
 *
 * Tests for file writing functions from src/docs/writer.ts
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  getOutputPath,
  writeCombined,
  writeFile,
} from "../../src/docs/writer.ts";
import type { Entry } from "../../src/docs/types.ts";
import {
  cleanupTempDir,
  createTempDir,
  createTestLogger,
} from "../test-utils.ts";

const logger = createTestLogger("docs-writer");

// ============================================================================
// Test Data
// ============================================================================

const sampleEntry: Entry = {
  id: "git-basics",
  path: "guides/git-basics.md",
  category: "guides",
  lang: "en",
  title: "Git Basics",
};

const sampleEntryFlat: Entry = {
  id: "api-reference",
  path: "reference/api.md",
  category: "reference",
  title: "API Reference",
};

// ============================================================================
// getOutputPath() Tests
// ============================================================================

Deno.test("getOutputPath: preserve mode keeps original path", () => {
  const result = getOutputPath(sampleEntry, "/docs", "preserve");
  logger.debug("getOutputPath result", { mode: "preserve", output: result });
  assertEquals(result, "/docs/guides/git-basics.md");
});

Deno.test("getOutputPath: flatten mode uses id.md", () => {
  const result = getOutputPath(sampleEntry, "/docs", "flatten");
  assertEquals(result, "/docs/git-basics.md");
});

Deno.test("getOutputPath: single mode returns climpt-docs.md", () => {
  const result = getOutputPath(sampleEntry, "/docs", "single");
  assertEquals(result, "/docs/climpt-docs.md");
});

Deno.test("getOutputPath: preserve mode with nested path", () => {
  const entry: Entry = {
    id: "deep-file",
    path: "guides/advanced/nested/file.md",
    category: "guides",
  };
  const result = getOutputPath(entry, "/output", "preserve");
  assertEquals(result, "/output/guides/advanced/nested/file.md");
});

Deno.test("getOutputPath: flatten mode ignores directory structure", () => {
  const entry: Entry = {
    id: "nested-doc",
    path: "a/b/c/d.md",
    category: "guides",
  };
  const result = getOutputPath(entry, "/out", "flatten");
  assertEquals(result, "/out/nested-doc.md");
});

Deno.test("getOutputPath: handles empty outputDir", () => {
  const result = getOutputPath(sampleEntry, "", "flatten");
  assertEquals(result, "/git-basics.md");
});

// ============================================================================
// writeFile() Tests
// ============================================================================

Deno.test("writeFile: creates file with content", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/test.md`;
    await writeFile(path, "# Test Content");

    const content = await Deno.readTextFile(path);
    assertEquals(content, "# Test Content");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeFile: creates nested directories automatically", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/a/b/c/nested.md`;
    logger.debug("writeFile input", { path });
    await writeFile(path, "nested content");

    const content = await Deno.readTextFile(path);
    assertEquals(content, "nested content");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeFile: overwrites existing file", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/overwrite.md`;
    await writeFile(path, "original");
    await writeFile(path, "updated");

    const content = await Deno.readTextFile(path);
    assertEquals(content, "updated");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeFile: handles empty content", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/empty.md`;
    await writeFile(path, "");

    const content = await Deno.readTextFile(path);
    assertEquals(content, "");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeFile: handles multiline content", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/multiline.md`;
    const content = "# Title\n\nParagraph 1\n\nParagraph 2";
    await writeFile(path, content);

    const read = await Deno.readTextFile(path);
    assertEquals(read, content);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeFile: rejects when path has no directory part", async () => {
  // Writing to root-level file without directory should still work
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/file.md`;
    await writeFile(path, "content");
    const content = await Deno.readTextFile(path);
    assertEquals(content, "content");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// ============================================================================
// writeCombined() Tests
// ============================================================================

Deno.test("writeCombined: combines multiple entries with separators", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/combined.md`;
    const entries = [
      { entry: sampleEntry, content: "Content for git basics" },
      { entry: sampleEntryFlat, content: "Content for API reference" },
    ];

    await writeCombined(path, entries);

    const content = await Deno.readTextFile(path);
    logger.debug("writeCombined result", {
      path,
      contentLength: content.length,
    });
    assertEquals(
      content,
      "# Git Basics\n\nContent for git basics\n\n---\n\n# API Reference\n\nContent for API reference",
    );
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeCombined: uses id when title is missing", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/combined.md`;
    const entries = [
      {
        entry: {
          id: "no-title",
          path: "doc.md",
          category: "guides" as const,
        },
        content: "Some content",
      },
    ];

    await writeCombined(path, entries);

    const content = await Deno.readTextFile(path);
    assertEquals(content, "# no-title\n\nSome content");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeCombined: handles single entry", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/single.md`;
    const entries = [
      { entry: sampleEntry, content: "Only one entry" },
    ];

    await writeCombined(path, entries);

    const content = await Deno.readTextFile(path);
    assertEquals(content, "# Git Basics\n\nOnly one entry");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeCombined: handles empty entries array", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/empty.md`;
    await writeCombined(path, []);

    const content = await Deno.readTextFile(path);
    assertEquals(content, "");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeCombined: creates parent directories", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/nested/dir/combined.md`;
    const entries = [
      { entry: sampleEntry, content: "Nested content" },
    ];

    await writeCombined(path, entries);

    const content = await Deno.readTextFile(path);
    assertEquals(content, "# Git Basics\n\nNested content");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("writeCombined: preserves content with special characters", async () => {
  const tempDir = await createTempDir();
  try {
    const path = `${tempDir}/special.md`;
    const entries = [
      {
        entry: { id: "special", path: "s.md", category: "guides" as const },
        content: "Content with `code` and **bold** and [links](url)",
      },
    ];

    await writeCombined(path, entries);

    const content = await Deno.readTextFile(path);
    assertEquals(
      content,
      "# special\n\nContent with `code` and **bold** and [links](url)",
    );
  } finally {
    await cleanupTempDir(tempDir);
  }
});
