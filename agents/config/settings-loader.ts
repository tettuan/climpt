/**
 * Claude Agent SDK Settings Loader
 *
 * Responsibility: Load per-agent (or shared fallback) Claude Code settings JSON
 * and produce an SDK-typed {@link Settings} object suitable for
 * `queryOptions.settings`.
 *
 * Lookup order:
 *   1. `.agent/climpt/config/claude.settings.climpt.agents.{agentName}.json`
 *   2. `.agent/climpt/config/claude.settings.climpt.agents.json` (shared fallback)
 *   3. throw `acLoadNotFound(sharedPath)`
 *
 * Validation: `permissions` must be an object; `permissions.allow` (if present)
 * must be `string[]`; `permissions.defaultMode` (if present) must be one of the
 * SDK-declared modes.
 *
 * @see agents/docs/design/ — Plan Z settings-source shift
 * @see tmp/config-refactor-agents-settings/impl-plan.md Section A
 */
import { join } from "@std/path";
import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import {
  acLoadInvalid,
  acLoadNotFound,
  acLoadParseFailed,
} from "../shared/errors/config-errors.ts";

/**
 * Directory holding Claude Code settings JSON files for Climpt agents.
 * Relative to the repo root (i.e. `cwd` passed to the loader).
 */
export const SETTINGS_CONFIG_DIR = ".agent/climpt/config";

/**
 * Filename prefix shared by all Climpt agent settings files.
 * Combined with either `{agentName}.json` or `.json` for the shared fallback.
 */
const SETTINGS_FILENAME_PREFIX = "claude.settings.climpt.agents";

/**
 * SDK-declared permission modes — single source of truth for validation.
 * Must be kept in sync with `Settings.permissions.defaultMode` in
 * `@anthropic-ai/claude-agent-sdk`.
 */
const VALID_DEFAULT_MODES = [
  "acceptEdits",
  "bypassPermissions",
  "default",
  "dontAsk",
  "plan",
] as const;

/**
 * Result of a successful settings load.
 *
 * `sourcePath` identifies which file the settings came from (per-agent or
 * shared); `settings` is the parsed, validated SDK-typed object.
 */
export interface LoadedAgentSettings {
  readonly sourcePath: string;
  readonly settings: Settings;
}

/**
 * Resolve the absolute per-agent and shared-fallback settings paths for an
 * agent, without reading the filesystem.
 *
 * @param agentName - Agent name (e.g. `"iterator"`)
 * @param cwd - Base directory (typically the repo root)
 */
export function resolveSettingsPaths(
  agentName: string,
  cwd: string,
): { perAgent: string; shared: string } {
  const base = join(cwd, SETTINGS_CONFIG_DIR);
  return {
    perAgent: join(base, `${SETTINGS_FILENAME_PREFIX}.${agentName}.json`),
    shared: join(base, `${SETTINGS_FILENAME_PREFIX}.json`),
  };
}

/**
 * Load the SDK `Settings` object for an agent.
 *
 * Resolution order: per-agent file → shared fallback → throw.
 *
 * @throws ConfigError AC-LOAD-001 if neither file exists
 * @throws ConfigError AC-LOAD-002 if the chosen file is not valid JSON
 * @throws ConfigError AC-LOAD-003 if the chosen file fails schema validation
 */
export async function loadAgentSettings(
  agentName: string,
  cwd: string,
): Promise<LoadedAgentSettings> {
  const { perAgent, shared } = resolveSettingsPaths(agentName, cwd);

  const chosenPath = (await fileExists(perAgent))
    ? perAgent
    : (await fileExists(shared))
    ? shared
    : null;

  if (chosenPath === null) {
    // Report the shared path: if the per-agent file were required we would
    // never fall through; hitting this branch means the shared fallback is
    // the last missing artifact the caller should provide.
    throw acLoadNotFound(shared);
  }

  let raw: string;
  try {
    raw = await Deno.readTextFile(chosenPath);
  } catch (error) {
    // File existed during stat but failed to read: surface as parse failure
    // with the underlying cause so callers can locate the issue.
    throw acLoadParseFailed(
      chosenPath,
      error instanceof Error ? error.message : String(error),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw acLoadParseFailed(
      chosenPath,
      error instanceof Error ? error.message : String(error),
    );
  }

  const validated = validateSettings(parsed, chosenPath);
  return { sourcePath: chosenPath, settings: validated };
}

/**
 * Validate the parsed JSON object against the subset of `Settings` that
 * Plan Z depends on: `permissions` (object) with optional `allow` (string[])
 * and optional `defaultMode` (enum).
 *
 * Returns the parsed object cast to `Settings` on success.
 */
function validateSettings(parsed: unknown, path: string): Settings {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw acLoadInvalid(
      `${path}: top-level value must be a JSON object.`,
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (!("permissions" in obj)) {
    throw acLoadInvalid(
      `${path}: missing required "permissions" object. ` +
        `Plan Z requires permissions.allow / permissions.defaultMode to be declared here.`,
    );
  }

  const permissions = obj.permissions;
  if (
    typeof permissions !== "object" ||
    permissions === null ||
    Array.isArray(permissions)
  ) {
    throw acLoadInvalid(
      `${path}: "permissions" must be an object (got ${
        describeType(permissions)
      }).`,
    );
  }

  const perm = permissions as Record<string, unknown>;

  if ("allow" in perm && perm.allow !== undefined) {
    if (
      !Array.isArray(perm.allow) ||
      perm.allow.some((v) => typeof v !== "string")
    ) {
      throw acLoadInvalid(
        `${path}: "permissions.allow" must be an array of strings.`,
      );
    }
  }

  if ("defaultMode" in perm && perm.defaultMode !== undefined) {
    const mode = perm.defaultMode;
    if (
      typeof mode !== "string" ||
      !(VALID_DEFAULT_MODES as readonly string[]).includes(mode)
    ) {
      throw acLoadInvalid(
        `${path}: "permissions.defaultMode" must be one of ` +
          `[${VALID_DEFAULT_MODES.join(", ")}] (got ${JSON.stringify(mode)}).`,
      );
    }
  }

  return obj as Settings;
}

/**
 * Describe the runtime type of a value for error messages.
 * Distinguishes `null` and arrays from generic objects.
 */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Best-effort existence check using `Deno.stat`.
 * Returns `false` for any stat error (missing, permission denied, etc.) —
 * downstream read will surface a specific error if the file is unreadable.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await Deno.stat(path);
    return info.isFile;
  } catch {
    return false;
  }
}
