/**
 * Sandbox Configuration - Default settings and utilities for SDK sandbox
 *
 * Responsibility: Sandbox configuration defaults, merging, and SDK format conversion
 * Side effects: None (environment variable reads only)
 *
 * @module
 */

import type { SandboxConfig } from "../src_common/types.ts";

// ============================================================================
// Default Trusted Domains
// ============================================================================

/**
 * Default trusted domains for network access
 * These are commonly needed for development workflows
 */
export const DEFAULT_TRUSTED_DOMAINS: readonly string[] = [
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

// ============================================================================
// Default Filesystem Paths
// ============================================================================

/**
 * Get default allowed filesystem paths for write access
 * These are required by Claude Agent SDK for session management
 *
 * @returns Array of default filesystem paths, empty if HOME not set
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

// ============================================================================
// Default Configuration
// ============================================================================

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
    trustedDomains: [...DEFAULT_TRUSTED_DOMAINS],
  },
  filesystem: {
    allowedPaths: getDefaultFilesystemPaths(),
  },
};

// ============================================================================
// SDK Format Conversion
// ============================================================================

/**
 * SDK SandboxSettings format for the Claude Agent SDK
 */
export interface SdkSandboxSettings {
  /** Whether sandbox is enabled */
  enabled?: boolean;
  /** Network restrictions */
  network?: {
    /** Allowed domains for network access */
    allowedDomains?: string[];
  };
  /** Violations to ignore */
  ignoreViolations?: {
    /** Filesystem paths where write violations are ignored */
    write?: string[];
  };
}

/**
 * Convert internal SandboxConfig to SDK SandboxSettings format
 *
 * The SDK uses a different structure:
 * - `network.trustedDomains` -> `network.allowedDomains`
 * - `filesystem.allowedPaths` -> `ignoreViolations.write`
 *
 * @param config - Internal sandbox configuration
 * @returns SDK-compatible sandbox settings
 */
export function toSdkSandboxConfig(config: SandboxConfig): SdkSandboxSettings {
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

// ============================================================================
// Configuration Merging
// ============================================================================

/**
 * Merge agent's sandbox config with defaults
 *
 * Merging rules:
 * - If agent config is undefined, use defaults
 * - If agent explicitly disables sandbox, respect that
 * - Network: agent config takes precedence, falls back to defaults
 * - Filesystem: default paths are combined with agent-specific paths
 *
 * @param agentConfig - Agent-specific sandbox configuration
 * @returns Merged configuration with defaults applied
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
