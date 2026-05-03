/**
 * Discover climpt dev-time agents for integration-style tests.
 *
 * Scans `.agent/<name>/{agent.json,steps_registry.json}` and optionally
 * confirms presence of a corresponding `{name}-steps-user.yml` under
 * `.agent/climpt/config/`.
 *
 * Why discovery (not hardcoding):
 *   `.agent/<name>/*` is user-side config, not climpt core. Tests in
 *   `agents/` MUST NOT hardcode specific agent names — doing so is a
 *   Partial consumer enumeration anti-pattern: any agent added to the
 *   repo silently escapes validation, and any rename rots the test.
 *
 * Callers must assert non-vacuity (`discovered.length > 0`) to avoid
 * Silent pass on empty.
 */

import { join } from "@std/path";

export interface DiscoveredAgent {
  /** Directory name under `.agent/` (e.g. `iterator`). */
  name: string;
  /** Absolute-or-relative path to `.agent/<name>/agent.json`. */
  agentJsonPath: string;
  /** Absolute-or-relative path to `.agent/<name>/steps_registry.json`. */
  registryPath: string;
  /** Path to matching user.yml under configDir, or undefined if absent. */
  userYmlPath?: string;
}

export interface DiscoverAgentsOptions {
  /** Root containing agent directories. Default: `.agent`. */
  agentsRoot?: string;
  /** Directory holding `{name}-steps-user.yml`. Default: `.agent/climpt/config`. */
  configDir?: string;
  /** If true, skip agents without a matching user.yml. Default: false. */
  requireUserYml?: boolean;
}

/**
 * List agents that have both `agent.json` and `steps_registry.json`.
 * Directories missing either file are skipped (not an agent).
 */
export async function discoverAgents(
  options: DiscoverAgentsOptions = {},
): Promise<DiscoveredAgent[]> {
  const agentsRoot = options.agentsRoot ?? ".agent";
  const configDir = options.configDir ?? ".agent/climpt/config";

  const found: DiscoveredAgent[] = [];
  for await (const entry of Deno.readDir(agentsRoot)) {
    if (!entry.isDirectory) continue;
    const name = entry.name;
    const agentJsonPath = join(agentsRoot, name, "agent.json");
    const registryPath = join(agentsRoot, name, "steps_registry.json");

    if (!(await fileExists(agentJsonPath))) continue;
    if (!(await fileExists(registryPath))) continue;

    const candidateUserYml = join(configDir, `${name}-steps-user.yml`);
    const hasUserYml = await fileExists(candidateUserYml);
    if (options.requireUserYml && !hasUserYml) continue;

    found.push({
      name,
      agentJsonPath,
      registryPath,
      userYmlPath: hasUserYml ? candidateUserYml : undefined,
    });
  }

  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}
