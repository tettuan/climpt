/**
 * Default sandbox configuration for all agents
 *
 * Agents can override these defaults via sandboxConfig in agent.json
 *
 * @deprecated Use `agents/bridge/sandbox-config.ts` instead.
 * This file will be removed in a future version.
 * Migration: Import from `../bridge/mod.ts` or `../bridge/sandbox-config.ts`
 */

import type { SandboxConfig } from "../src_common/types.ts";

/**
 * Default trusted domains for network access
 * These are commonly needed for development workflows
 */
export const DEFAULT_TRUSTED_DOMAINS = [
  // Anthropic API and services (required for Claude Agent SDK)
  "api.anthropic.com",
  "statsig.anthropic.com",
  "sentry.anthropic.com",
  "*.anthropic.com",
  "*.*.anthropic.com",

  // GitHub
  "api.github.com",
  "github.com",
  "*.githubusercontent.com",
  "uploads.github.com",

  // Deno ecosystem
  "jsr.io",
  "*.jsr.io",
  "deno.land",
  "*.deno.land",

  // npm ecosystem
  "registry.npmjs.org",
];

/**
 * Default allowed filesystem paths for write access
 * These are required by Claude Agent SDK for session management
 */
export function getDefaultFilesystemPaths(): string[] {
  const home = Deno.env.get("HOME") ?? "";
  if (!home) {
    return [];
  }
  return [
    // Claude Agent SDK requirements
    `${home}/.claude/projects/`,
    `${home}/.claude/statsig/`,
    `${home}/.claude/telemetry/`,
  ];
}

/**
 * Default sandbox configuration
 *
 * Note: SDK uses `allowedDomains` format, but we also maintain
 * `trustedDomains` for internal consistency. The runner converts
 * to SDK format when passing to query().
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  network: {
    mode: "custom",
    trustedDomains: DEFAULT_TRUSTED_DOMAINS,
  },
  filesystem: {
    allowedPaths: getDefaultFilesystemPaths(),
  },
};

/**
 * Convert internal SandboxConfig to SDK SandboxSettings format
 */
export function toSdkSandboxConfig(
  config: SandboxConfig,
): Record<string, unknown> {
  return {
    enabled: config.enabled,
    network: config.network?.trustedDomains
      ? { allowedDomains: config.network.trustedDomains }
      : undefined,
    // SDK uses ignoreViolations for filesystem paths
    ignoreViolations: config.filesystem?.allowedPaths
      ? { write: config.filesystem.allowedPaths }
      : undefined,
  };
}

/**
 * Merge agent's sandbox config with defaults
 * Agent config takes precedence over defaults
 */
export function mergeSandboxConfig(
  agentConfig?: SandboxConfig,
): SandboxConfig {
  if (!agentConfig) {
    return DEFAULT_SANDBOX_CONFIG;
  }

  // If agent explicitly disables sandbox, respect that
  if (agentConfig.enabled === false) {
    return agentConfig;
  }

  // Merge network config - DEFAULT_SANDBOX_CONFIG.network is always defined
  const defaultNetwork = DEFAULT_SANDBOX_CONFIG.network;
  const mergedNetwork = agentConfig.network
    ? {
      mode: agentConfig.network.mode ?? defaultNetwork?.mode,
      trustedDomains: agentConfig.network.trustedDomains ??
        defaultNetwork?.trustedDomains,
    }
    : defaultNetwork;

  // Merge filesystem config - combine default paths with agent-specific paths
  const defaultFilesystem = DEFAULT_SANDBOX_CONFIG.filesystem;
  const mergedFilesystem = {
    allowedPaths: [
      ...(defaultFilesystem?.allowedPaths ?? []),
      ...(agentConfig.filesystem?.allowedPaths ?? []),
    ],
  };

  return {
    enabled: agentConfig.enabled ?? DEFAULT_SANDBOX_CONFIG.enabled,
    network: mergedNetwork,
    filesystem: mergedFilesystem,
  };
}
