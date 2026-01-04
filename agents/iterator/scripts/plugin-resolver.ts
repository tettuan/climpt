/**
 * Plugin Resolver - Dynamic plugin path resolution for Claude Agent SDK
 *
 * @module agents/iterator/scripts/plugin-resolver
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

import { join } from "@std/path";

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
 * Get the user's home directory for plugin resolution
 */
function getHomeDirSafe(): string | null {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
  return home || null;
}

/**
 * Extract plugins from a single settings file
 *
 * @param settingsPath - Full path to settings file
 * @returns Array of SDK plugin configurations from this file
 */
async function extractPluginsFromSettings(
  settingsPath: string,
): Promise<SdkPluginConfig[]> {
  let settings: ClaudeSettings;
  try {
    const content = await Deno.readTextFile(settingsPath);
    settings = JSON.parse(content);
  } catch {
    // File not found or parse error
    return [];
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
 * Resolve plugin paths from all Claude Code settings scopes
 *
 * Checks all settings files and merges enabled plugins:
 * - user: ~/.claude/settings.json
 * - project: .claude/settings.json
 * - local: .claude/settings.local.json
 *
 * @param cwd - Current working directory for project-level paths
 * @returns Array of SDK plugin configurations (deduplicated by path)
 */
export async function resolvePluginPaths(
  cwd?: string,
): Promise<SdkPluginConfig[]> {
  const workDir = cwd || Deno.cwd();

  // Collect settings files to check
  const settingsFiles: string[] = [];

  // User scope: ~/.claude/settings.json
  const homeDir = getHomeDirSafe();
  if (homeDir) {
    settingsFiles.push(join(homeDir, ".claude", "settings.json"));
  }

  // Project scope: .claude/settings.json
  settingsFiles.push(join(workDir, ".claude", "settings.json"));

  // Local scope: .claude/settings.local.json
  settingsFiles.push(join(workDir, ".claude", "settings.local.json"));

  // Collect plugins from all settings files
  const allPlugins: SdkPluginConfig[] = [];
  const seenPaths = new Set<string>();

  for (const settingsPath of settingsFiles) {
    const plugins = await extractPluginsFromSettings(settingsPath);
    for (const plugin of plugins) {
      // Deduplicate by path
      if (!seenPaths.has(plugin.path)) {
        seenPaths.add(plugin.path);
        allPlugins.push(plugin);
      }
    }
  }

  return allPlugins;
}

/**
 * Resolve plugin paths with error handling and logging
 *
 * Wrapper that catches errors and returns empty array on failure,
 * with optional logging callback.
 *
 * @param cwd - Current working directory
 * @param onError - Optional error callback
 * @returns Array of SDK plugin configurations (empty on error)
 */
export async function resolvePluginPathsSafe(
  cwd?: string,
  onError?: (error: Error, message: string) => void | Promise<void>,
): Promise<SdkPluginConfig[]> {
  try {
    return await resolvePluginPaths(cwd);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (onError) {
      await onError(err, "Failed to resolve plugins from settings");
    }
    return [];
  }
}

/**
 * Result of plugin availability check
 */
export interface PluginCheckResult {
  /** Whether the plugin is installed and enabled */
  installed: boolean;
  /** Which settings file contains the plugin (if found) */
  foundIn: string | null;
  /** List of settings files that were checked */
  checkedFiles: string[];
}

/**
 * Get the user's home directory
 */
function getHomeDir(): string {
  // Deno.env.get returns undefined if not set
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
  if (!home) {
    throw new Error("Could not determine home directory");
  }
  return home;
}

/**
 * Check a single settings file for climpt-agent plugin
 *
 * @param settingsPath - Full path to settings file
 * @returns true if climpt-agent is enabled in this file
 */
async function checkSettingsFile(settingsPath: string): Promise<boolean> {
  try {
    const content = await Deno.readTextFile(settingsPath);
    const settings = JSON.parse(content) as ClaudeSettings;

    if (!settings.enabledPlugins) {
      return false;
    }

    // Check for climpt-agent in any marketplace
    return Object.entries(settings.enabledPlugins).some(
      ([pluginId, enabled]) => {
        if (!enabled) return false;
        const atIndex = pluginId.lastIndexOf("@");
        if (atIndex === -1) return false;
        const pluginName = pluginId.substring(0, atIndex);
        return pluginName === "climpt-agent";
      },
    );
  } catch {
    // File not found or parse error - not installed in this file
    return false;
  }
}

/**
 * Check if climpt-agent plugin is installed and enabled
 *
 * Checks all Claude Code settings scopes:
 * - user: ~/.claude/settings.json
 * - project: .claude/settings.json
 * - local: .claude/settings.local.json
 *
 * @param cwd - Current working directory for project-level paths
 * @returns Check result with installation status and location
 */
export async function checkClimptAgentPlugin(
  cwd?: string,
): Promise<PluginCheckResult> {
  const workDir = cwd || Deno.cwd();

  // Define settings files to check (in order of precedence)
  const settingsFiles: { scope: string; path: string }[] = [];

  // User scope: ~/.claude/settings.json
  try {
    const homeDir = getHomeDir();
    settingsFiles.push({
      scope: "user",
      path: join(homeDir, ".claude", "settings.json"),
    });
  } catch {
    // Skip user scope if home directory cannot be determined
  }

  // Project scope: .claude/settings.json
  settingsFiles.push({
    scope: "project",
    path: join(workDir, ".claude", "settings.json"),
  });

  // Local scope: .claude/settings.local.json
  settingsFiles.push({
    scope: "local",
    path: join(workDir, ".claude", "settings.local.json"),
  });

  const checkedFiles: string[] = [];

  // Check each settings file
  for (const { scope, path } of settingsFiles) {
    checkedFiles.push(`${scope}: ${path}`);
    const found = await checkSettingsFile(path);
    if (found) {
      return {
        installed: true,
        foundIn: `${scope} (${path})`,
        checkedFiles,
      };
    }
  }

  return {
    installed: false,
    foundIn: null,
    checkedFiles,
  };
}
