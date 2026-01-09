/**
 * Default sandbox configuration for all agents
 *
 * Agents can override these defaults via sandboxConfig in agent.json
 */

import type { SandboxConfig } from "../src_common/types.ts";

/**
 * Default trusted domains for network access
 * These are commonly needed for development workflows
 */
export const DEFAULT_TRUSTED_DOMAINS = [
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
 * Default sandbox configuration
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  network: {
    mode: "custom",
    trustedDomains: DEFAULT_TRUSTED_DOMAINS,
  },
};

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

  // Merge network config
  const mergedNetwork = agentConfig.network
    ? {
      mode: agentConfig.network.mode ?? DEFAULT_SANDBOX_CONFIG.network!.mode,
      trustedDomains: agentConfig.network.trustedDomains ??
        DEFAULT_SANDBOX_CONFIG.network!.trustedDomains,
    }
    : DEFAULT_SANDBOX_CONFIG.network;

  return {
    enabled: agentConfig.enabled ?? DEFAULT_SANDBOX_CONFIG.enabled,
    network: mergedNetwork,
    filesystem: agentConfig.filesystem,
  };
}
