/**
 * AgentRegistry — concrete implementation backed by a `Map<AgentId,
 * AgentBundle>` (design 13 §B + 10 §B input 2).
 *
 * Construction-time invariants:
 *  - Boot rule A1 (id uniqueness across the workflow's agent map) is
 *    enforced by {@link createAgentRegistry}. Duplicate ids surface as
 *    a {@link ../shared/validation/mod.ts} `Reject(ValidationError)`
 *    rather than a thrown exception so `BootKernel.boot` can collect
 *    every Boot failure into one Decision (combine-then-throw at the
 *    boundary).
 *  - The `all` array preserves the order in which bundles were
 *    supplied; this matches the order of `workflow.agents` map keys at
 *    Boot.
 *
 * Post-construction:
 *  - The registry instance itself and the `all` array are frozen by
 *    Boot's deepFreeze pass. `lookup` is a read-only operation.
 *
 * @module
 */

import type { AgentBundle } from "../src_common/types/agent-bundle.ts";
import {
  accept,
  type Decision,
  reject,
  validationError,
} from "../shared/validation/mod.ts";
import type { AgentRegistry } from "./types.ts";

/**
 * Concrete `AgentRegistry` backed by a `Map` for O(1) lookup.
 *
 * The class is internal — call sites construct via
 * {@link createAgentRegistry} so duplicate-id detection runs uniformly.
 */
class MapAgentRegistry implements AgentRegistry {
  readonly all: ReadonlyArray<AgentBundle>;
  readonly #byId: ReadonlyMap<string, AgentBundle>;

  constructor(bundles: readonly AgentBundle[]) {
    this.all = bundles;
    const map = new Map<string, AgentBundle>();
    for (const bundle of bundles) {
      map.set(bundle.id, bundle);
    }
    this.#byId = map;
  }

  lookup(agentId: string): AgentBundle | undefined {
    return this.#byId.get(agentId);
  }
}

/**
 * Construct an {@link AgentRegistry} from a list of `AgentBundle`s.
 *
 * Detects duplicate `id`s and emits a single
 * {@link ValidationError} with code `A1` for each duplicate group, so a
 * `--validate` run surfaces every clash at once.
 *
 * @param bundles Bundles to register, in workflow order.
 * @returns `Accept(registry)` when ids are unique, `Reject(errors)`
 *          when any id appears more than once.
 */
export function createAgentRegistry(
  bundles: readonly AgentBundle[],
): Decision<AgentRegistry> {
  // Detect duplicates by counting occurrences of each id.
  const counts = new Map<string, number>();
  for (const bundle of bundles) {
    counts.set(bundle.id, (counts.get(bundle.id) ?? 0) + 1);
  }

  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  if (duplicates.length > 0) {
    const errors = duplicates.map((id) =>
      validationError(
        "A1",
        `Duplicate AgentBundle id: "${id}" (rule A1 — id must be unique across workflow.agents).`,
        { source: ".agent/workflow.json", context: { agentId: id } },
      )
    );
    return reject(errors);
  }

  return accept(new MapAgentRegistry(bundles) as AgentRegistry);
}
