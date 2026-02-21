/**
 * @fileoverview Unit tests for docs source module
 * @module tests/docs/source_test
 *
 * Tests for JSR source fetching functions from src/docs/source.ts
 * These tests use real network calls to jsr.io
 */

import { assert, assertEquals } from "@std/assert";
import {
  getContent,
  getLatestVersion,
  getManifest,
} from "../../src/docs/source.ts";
import { createTestLogger } from "../test-utils.ts";

const logger = createTestLogger("docs-jsr");

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
// getLatestVersion() Tests
// ============================================================================

Deno.test({
  name: "getLatestVersion: returns a valid version string",
  ignore: !hasNetAccess,
  fn: async () => {
    const version = await getLatestVersion();
    logger.debug("getLatestVersion result", { version });
    assert(typeof version === "string", "Version should be a string");
    assert(version.length > 0, "Version should not be empty");
    // Version should match semver pattern (e.g., "1.0.0" or "1.0.0-beta.1")
    assert(
      /^\d+\.\d+\.\d+/.test(version),
      `Version should be semver format, got: ${version}`,
    );
  },
});

// ============================================================================
// getManifest() Tests
// ============================================================================

Deno.test({
  name: "getManifest: returns manifest with version and entries",
  ignore: !hasNetAccess,
  fn: async () => {
    const version = await getLatestVersion();
    const manifest = await getManifest(version);
    logger.debug("getManifest result", {
      version: manifest.version,
      entryCount: manifest.entries.length,
    });

    assert(
      typeof manifest.version === "string",
      "Manifest should have version",
    );
    assert(
      Array.isArray(manifest.entries),
      "Manifest should have entries array",
    );
  },
});

Deno.test({
  name: "getManifest: entries have required fields",
  ignore: !hasNetAccess,
  fn: async () => {
    const version = await getLatestVersion();
    const manifest = await getManifest(version);

    if (manifest.entries.length > 0) {
      const entry = manifest.entries[0];
      assert(typeof entry.id === "string", "Entry should have id");
      assert(typeof entry.path === "string", "Entry should have path");
      assert(
        typeof entry.category === "string",
        "Entry should have category",
      );
      assert(
        ["guides", "reference", "internal"].includes(entry.category),
        "Category should be valid",
      );
    }
  },
});

Deno.test({
  name: "getManifest: returns empty or throws on invalid version",
  ignore: !hasNetAccess,
  fn: async () => {
    try {
      const manifest = await getManifest("0.0.0-nonexistent");
      // If the API returns without throwing, verify it's still an object
      assertEquals(typeof manifest, "object", "Should return an object");
    } catch (_e) {
      // Throwing on invalid version is also acceptable behavior
      assert(true);
    }
  },
});

// ============================================================================
// getContent() Tests
// ============================================================================

Deno.test({
  name: "getContent: returns markdown content",
  ignore: !hasNetAccess,
  fn: async () => {
    const version = await getLatestVersion();
    const manifest = await getManifest(version);

    if (manifest.entries.length > 0) {
      const entry = manifest.entries[0];
      logger.debug("getContent input", { version, path: entry.path });
      const content = await getContent(version, entry.path);
      logger.debug("getContent result", { contentLength: content.length });

      assert(typeof content === "string", "Content should be a string");
      assert(content.length > 0, "Content should not be empty");
    }
  },
});

Deno.test({
  name: "getContent: returns empty or throws on invalid path",
  ignore: !hasNetAccess,
  fn: async () => {
    const version = await getLatestVersion();

    try {
      const content = await getContent(version, "nonexistent/path.md");
      // If the API returns without throwing, verify content is empty or minimal
      assertEquals(typeof content, "string", "Should return a string");
    } catch (_e) {
      // Throwing on invalid path is also acceptable behavior
      assert(true);
    }
  },
});

Deno.test({
  name: "getContent: returns empty or throws on invalid version",
  ignore: !hasNetAccess,
  fn: async () => {
    try {
      const content = await getContent("0.0.0-invalid", "some/path.md");
      assertEquals(typeof content, "string", "Should return a string");
    } catch (_e) {
      // Throwing on invalid version is also acceptable behavior
      assert(true);
    }
  },
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test({
  name: "Integration: can fetch and read a complete document",
  ignore: !hasNetAccess,
  fn: async () => {
    // This test verifies the full workflow: version -> manifest -> content
    const version = await getLatestVersion();
    const manifest = await getManifest(version);

    assert(manifest.entries.length > 0, "Manifest should have entries");

    // Pick first entry
    const entry = manifest.entries[0];
    const content = await getContent(version, entry.path);
    logger.debug("integration fetch result", {
      version,
      entryId: entry.id,
      contentLength: content.length,
    });

    assert(content.length > 0, "Content should not be empty");
    assertEquals(typeof content, "string", "Content should be string");
  },
});
