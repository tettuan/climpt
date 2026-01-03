/**
 * Plugin Resolver - Dynamic plugin path resolution for Claude Agent SDK
 *
 * @module review-agent/scripts/plugin-resolver
 *
 * Resolves plugin paths from .claude/settings.json configuration,
 * enabling dynamic plugin loading at SDK runtime.
 *
 * @example
 * ```typescript
 * const plugins = await resolvePluginPaths(".claude/settings.json");
 * query({ prompt: "...", options: { plugins } });
 * ```
 */

import { join } from "jsr:@std/path@^1";

/**
 * SDK plugin configuration format
 */
export interface SdkPluginConfig {
  type: "local";
  path: string;
}

/**
 * Marketplace source configuration (directory type)
 *
 * Supports Claude Code settings schema:
 * - source.source: "directory" (discriminator)
 * - source.path: local directory path
 */
interface DirectorySource {
  source: "directory";
  path: string;
}

/**
 * Marketplace source configuration (file type)
 */
interface FileSource {
  source: "file";
  path: string;
}

/**
 * Generic source type for other formats (github, git, npm, url)
 * These are not supported for dynamic SDK plugin loading
 */
interface OtherSource {
  source: "github" | "git" | "npm" | "url";
  [key: string]: unknown;
}

/**
 * Marketplace configuration in settings
 */
interface MarketplaceConfig {
  source: DirectorySource | FileSource | OtherSource;
}

/**
 * Settings.json structure (relevant portions)
 */
interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, MarketplaceConfig>;
}

/**
 * Marketplaces to skip (self-reference)
 */
const SKIP_MARKETPLACES = ["climpt-marketplace"];

/**
 * Resolve plugin paths from settings.json
 *
 * Parses enabledPlugins (format: "plugin-name@marketplace-name")
 * and resolves actual paths using extraKnownMarketplaces.
 *
 * @param settingsPath - Path to .claude/settings.json (relative to cwd)
 * @param cwd - Current working directory for path resolution
 * @returns Array of SDK plugin configurations
 */
export async function resolvePluginPaths(
  settingsPath: string,
  cwd?: string,
): Promise<SdkPluginConfig[]> {
  const workDir = cwd || Deno.cwd();
  const fullSettingsPath = join(workDir, settingsPath);

  let settings: ClaudeSettings;
  try {
    const content = await Deno.readTextFile(fullSettingsPath);
    settings = JSON.parse(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // No settings file - return empty array (no dynamic plugins)
      return [];
    }
    throw error;
  }

  const plugins: SdkPluginConfig[] = [];

  if (!settings.enabledPlugins || !settings.extraKnownMarketplaces) {
    return plugins;
  }

  for (const [pluginId, enabled] of Object.entries(settings.enabledPlugins)) {
    if (!enabled) continue;

    // Parse "plugin-name@marketplace-name" format
    const atIndex = pluginId.lastIndexOf("@");
    if (atIndex === -1) continue; // Invalid format, skip

    const pluginName = pluginId.substring(0, atIndex);
    const marketplaceName = pluginId.substring(atIndex + 1);

    // Skip self-reference marketplaces
    if (SKIP_MARKETPLACES.includes(marketplaceName)) continue;

    // Resolve path from extraKnownMarketplaces
    const marketplace = settings.extraKnownMarketplaces[marketplaceName];
    if (!marketplace?.source) continue;

    // Only support directory and file sources for local SDK plugin loading
    const source = marketplace.source;
    if (source.source !== "directory" && source.source !== "file") {
      continue; // Skip remote sources (github, git, npm, url)
    }

    const pluginPath = join(source.path, pluginName);
    plugins.push({ type: "local", path: pluginPath });
  }

  return plugins;
}

/**
 * Resolve plugin paths with error handling and logging
 *
 * Wrapper that catches errors and returns empty array on failure,
 * with optional logging callback.
 *
 * @param settingsPath - Path to .claude/settings.json
 * @param cwd - Current working directory
 * @param onError - Optional error callback
 * @returns Array of SDK plugin configurations (empty on error)
 */
export async function resolvePluginPathsSafe(
  settingsPath: string,
  cwd?: string,
  onError?: (error: Error, message: string) => void | Promise<void>,
): Promise<SdkPluginConfig[]> {
  try {
    return await resolvePluginPaths(settingsPath, cwd);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (onError) {
      await onError(err, `Failed to resolve plugins from ${settingsPath}`);
    }
    return [];
  }
}
