/**
 * Public surface of the Boot module — design 10 §B / 20 §B (Layer 4
 * frozen at process start).
 *
 * Exports:
 *  - {@link BootKernel}      — load + validate + freeze entry point
 *  - {@link BootArtifacts}   — aggregate of the 5 Layer-4 inputs
 *  - {@link AgentRegistry}   — frozen lookup-by-id for AgentBundle
 *  - {@link Policy}          — environment / transport policy ADT
 *  - {@link TransportPolicy} — read / close transport polarity
 *  - {@link deepFreeze}      — recursive freeze helper
 *
 * Design refs:
 *  - `agents/docs/design/realistic/10-system-overview.md` §B
 *  - `agents/docs/design/realistic/20-state-hierarchy.md`  §B / §E
 *  - `tmp/realistic-migration/phased-plan.md` §P2
 *
 * @module
 */

export { BootKernel } from "./kernel.ts";
export type { BootOpts } from "./kernel.ts";

export type { AgentRegistry, BootArtifacts } from "./types.ts";

export { createAgentRegistry } from "./registry.ts";

export { loadPolicy } from "./policy.ts";
export type { LoadPolicyOpts, Policy, TransportPolicy } from "./policy.ts";

export { deepFreeze } from "./freeze.ts";

export {
  collectBootWarnings,
  REJECT_RULE_CODES,
  RULE_CODES,
  RULE_COUNT,
  validateBootArtifacts,
  WARN_RULE_CODES,
} from "./validate.ts";
