/**
 * @fileoverview Unit tests for docs installer main module
 * @module tests/docs/mod_test
 *
 * Tests for the install and list functions from src/docs/mod.ts
 */

import { assert, assertEquals } from "@std/assert";
import { install, list } from "../../src/docs/mod.ts";
import {
  cleanupTempDir,
  createTempDir,
  createTestLogger,
} from "../test-utils.ts";

const logger = createTestLogger("docs-install");

// Check if required permissions and connectivity are available
const hasWritePermission =
  (await Deno.permissions.query({ name: "write" })).state === "granted";

// Check both permission and actual connectivity (sandbox may block jsr.io)
let hasNetAccess = false;
if (
  (await Deno.permissions.query({ name: "net", host: "jsr.io" })).state ===
    "granted"
) {
  try {
    const res = await fetch("https://jsr.io/@aidevtool/climpt/meta.json");
    hasNetAccess = res.ok;
    await res.body?.cancel();
  } catch {
    hasNetAccess = false;
  }
}

// ============================================================================
// list() Tests (require network access to jsr.io)
// ============================================================================

Deno.test({
  name: "list: returns version and entries",
  ignore: !hasNetAccess,
  fn: async () => {
    const result = await list();
    logger.debug("list result", {
      version: result.version,
      entryCount: result.entries.length,
    });

    assert(typeof result.version === "string", "Should return version");
    assert(Array.isArray(result.entries), "Should return entries array");
    assert(result.version.length > 0, "Version should not be empty");
  },
});

Deno.test({
  name: "list: filters by category",
  ignore: !hasNetAccess,
  fn: async () => {
    const result = await list(undefined, "guides");

    assert(Array.isArray(result.entries), "Should return entries array");
    if (result.entries.length > 0) {
      assertEquals(
        result.entries.every((e) => e.category === "guides"),
        true,
        "All entries should be guides",
      );
    }
  },
});

Deno.test({
  name: "list: filters by lang",
  ignore: !hasNetAccess,
  fn: async () => {
    const result = await list(undefined, undefined, "ja");

    assert(Array.isArray(result.entries), "Should return entries array");
    if (result.entries.length > 0) {
      // All entries should either have lang=ja or no lang field
      assertEquals(
        result.entries.every((e) => !e.lang || e.lang === "ja"),
        true,
        "All entries should be ja or no-lang",
      );
    }
  },
});

Deno.test({
  name: "list: filters by both category and lang",
  ignore: !hasNetAccess,
  fn: async () => {
    const result = await list(undefined, "guides", "ja");

    assert(Array.isArray(result.entries), "Should return entries array");
    if (result.entries.length > 0) {
      assertEquals(
        result.entries.every(
          (e) => e.category === "guides" && (!e.lang || e.lang === "ja"),
        ),
        true,
        "All entries should be guides and ja/no-lang",
      );
    }
  },
});

Deno.test({
  name: "list: uses latest version when not specified",
  ignore: !hasNetAccess,
  fn: async () => {
    const result = await list();
    assert(
      /^\d+\.\d+\.\d+/.test(result.version),
      "Should return semver version",
    );
  },
});

// ============================================================================
// install() Tests - preserve mode
// ============================================================================

Deno.test({
  name: "install: preserve mode creates files in original paths",
  ignore: !hasWritePermission || !hasNetAccess,
  fn: async () => {
    const tempDir = await createTempDir();
    try {
      const result = await install({
        output: tempDir,
        mode: "preserve",
        category: "guides",
      });
      logger.debug("install preserve result", {
        output: tempDir,
        installedCount: result.installed.length,
        failedCount: result.failed.length,
      });

      assert(typeof result.version === "string", "Result should have version");
      assert(
        Array.isArray(result.installed),
        "Result should have installed array",
      );
      assert(Array.isArray(result.failed), "Result should have failed array");

      // Check at least one file was installed
      if (result.installed.length > 0) {
        // Verify file exists
        const firstFile = result.installed[0];
        const stat = await Deno.stat(firstFile);
        logger.debug("install file check", {
          path: firstFile,
          isFile: stat.isFile,
        });
        assert(stat.isFile, "Installed path should be a file");

        // Verify content is not empty
        const content = await Deno.readTextFile(firstFile);
        assert(content.length > 0, "File content should not be empty");
      }
    } finally {
      await cleanupTempDir(tempDir);
    }
  },
});

// ============================================================================
// install() Tests - flatten mode
// ============================================================================

Deno.test({
  name: "install: flatten mode creates files with id.md names",
  ignore: !hasWritePermission || !hasNetAccess,
  fn: async () => {
    const tempDir = await createTempDir();
    try {
      const result = await install({
        output: tempDir,
        mode: "flatten",
        category: "guides",
      });

      assert(result.installed.length > 0, "Should install at least one file");

      // All installed files should be in output directory directly (no subdirs)
      for (const path of result.installed) {
        assert(path.startsWith(tempDir), "File should be in temp dir");
        assert(path.endsWith(".md"), "File should have .md extension");

        // Count slashes to verify no subdirectories
        const relativePath = path.substring(tempDir.length + 1);
        const slashCount = (relativePath.match(/\//g) || []).length;
        assertEquals(slashCount, 0, "File should be directly in output dir");

        // Verify file exists and has content
        const content = await Deno.readTextFile(path);
        assert(content.length > 0, "File should have content");
      }
    } finally {
      await cleanupTempDir(tempDir);
    }
  },
});

// ============================================================================
// install() Tests - single mode
// ============================================================================

Deno.test({
  name: "install: single mode creates one combined file",
  ignore: !hasWritePermission || !hasNetAccess,
  fn: async () => {
    const tempDir = await createTempDir();
    try {
      const result = await install({
        output: tempDir,
        mode: "single",
        category: "guides",
      });
      logger.debug("install single result", {
        output: tempDir,
        installed: result.installed,
      });

      assertEquals(
        result.installed.length,
        1,
        "Should install exactly one file",
      );
      assertEquals(
        result.installed[0],
        `${tempDir}/climpt-docs.md`,
        "File should be climpt-docs.md",
      );

      // Verify combined file exists and has content
      const content = await Deno.readTextFile(result.installed[0]);
      assert(content.length > 0, "Combined file should have content");
      assert(content.includes("---"), "Combined file should have separators");
    } finally {
      await cleanupTempDir(tempDir);
    }
  },
});

// ============================================================================
// install() Tests - filtering
// ============================================================================

Deno.test({
  name: "install: filters by category",
  ignore: !hasWritePermission || !hasNetAccess,
  fn: async () => {
    const tempDir = await createTempDir();
    try {
      const result = await install({
        output: tempDir,
        mode: "preserve",
        category: "guides",
      });

      assert(result.installed.length > 0, "Should install at least one file");

      // Verify every installed path belongs to the "guides" category
      // by cross-referencing with list() entries for the same version
      const listing = await list(result.version, "guides");
      const guidePaths = listing.entries.map((e) => e.path);

      for (const installedPath of result.installed) {
        const matchesGuide = guidePaths.some((gp) =>
          installedPath.includes(gp)
        ) || installedPath.includes("guides");
        assert(
          matchesGuide,
          `Installed path should belong to guides category: ${installedPath}`,
        );
      }
    } finally {
      await cleanupTempDir(tempDir);
    }
  },
});

Deno.test({
  name: "install: filters by lang",
  ignore: !hasWritePermission || !hasNetAccess,
  fn: async () => {
    const tempDir = await createTempDir();
    try {
      const result = await install({
        output: tempDir,
        mode: "preserve",
        lang: "ja",
      });

      // Cross-reference with list() to get the expected ja entries
      const listing = await list(result.version, undefined, "ja");
      const jaEntryPaths = listing.entries.map((e) => e.path);

      if (result.installed.length > 0) {
        // Every installed path must correspond to a ja (or no-lang) entry
        for (const installedPath of result.installed) {
          const matchesJa = jaEntryPaths.some((jp) =>
            installedPath.includes(jp)
          ) || installedPath.includes("/ja/");
          assert(
            matchesJa,
            `Installed path should be a ja entry: ${installedPath}`,
          );
        }
      }

      // Verify no non-ja entries leaked through:
      // installed count should not exceed the ja-filtered entry count
      assert(
        result.installed.length <= jaEntryPaths.length,
        `Installed count (${result.installed.length}) should not exceed ja entries (${jaEntryPaths.length})`,
      );
    } finally {
      await cleanupTempDir(tempDir);
    }
  },
});

// ============================================================================
// install() Tests - error handling
// ============================================================================

Deno.test({
  name: "install: handles partial failures gracefully",
  ignore: !hasWritePermission || !hasNetAccess,
  fn: async () => {
    const tempDir = await createTempDir();
    try {
      const result = await install({
        output: tempDir,
        mode: "preserve",
        category: "guides",
      });

      // Result should have both installed and failed arrays
      assert(Array.isArray(result.installed), "Should have installed array");
      assert(Array.isArray(result.failed), "Should have failed array");
      assert(typeof result.version === "string", "Should have version");
    } finally {
      await cleanupTempDir(tempDir);
    }
  },
});

// ============================================================================
// install() Tests - default behavior
// ============================================================================

Deno.test({
  name: "install: uses preserve mode by default",
  ignore: !hasWritePermission || !hasNetAccess,
  fn: async () => {
    const tempDir = await createTempDir();
    try {
      const result = await install({
        output: tempDir,
        category: "guides",
      });

      assert(
        result.installed.length > 0,
        "Should install at least one file (no files installed; cannot verify preserve mode)",
      );

      // In preserve mode (the default), at least one file should have a subdirectory
      const hasSubdir = result.installed.some((path) => {
        const relativePath = path.substring(tempDir.length + 1);
        return relativePath.includes("/");
      });

      assert(
        hasSubdir,
        "Default mode should be preserve: at least one installed path must contain a subdirectory",
      );
    } finally {
      await cleanupTempDir(tempDir);
    }
  },
});

Deno.test({
  name: "install: uses latest version when not specified",
  ignore: !hasWritePermission || !hasNetAccess,
  fn: async () => {
    const tempDir = await createTempDir();
    try {
      const result = await install({
        output: tempDir,
        mode: "single",
        category: "guides",
      });

      assert(
        /^\d+\.\d+\.\d+/.test(result.version),
        "Should use semver version",
      );
    } finally {
      await cleanupTempDir(tempDir);
    }
  },
});
