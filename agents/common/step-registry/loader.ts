/**
 * Step Registry Loader
 *
 * Functions for loading step registries from files.
 */

import { join } from "@std/path";
import type { RegistryLoaderOptions, StepRegistry } from "./types.ts";
import {
  validateEntryStepMapping,
  validateIntentSchemaEnums,
  validateIntentSchemaRef,
  validateRegistryShape,
  validateStepKindIntents,
  validateStepRegistry,
} from "./validator.ts";
import { createEmptyRegistry } from "./utils.ts";
import { PATHS } from "../../shared/paths.ts";
import {
  ConfigError,
  srLoadAgentIdMismatch,
  srLoadNotFound,
} from "../../shared/errors/config-errors.ts";

/**
 * Load a step registry from JSON file
 *
 * Default location: agents/{agentId}/registry.json
 *
 * @param agentId - Agent identifier
 * @param agentsDir - Base directory for agents (default: "agents")
 * @param options - Loader options
 * @returns Loaded step registry
 */
export async function loadStepRegistry(
  agentId: string,
  agentsDir: string,
  options: RegistryLoaderOptions,
): Promise<StepRegistry> {
  const registryPath = options.registryPath ??
    join(agentsDir, agentId, PATHS.REGISTRY_JSON);

  try {
    const content = await Deno.readTextFile(registryPath);
    // Parse as `unknown` — the strict shape validator below proves the
    // payload conforms to the new ADT shape (design 14 §B/§C) before any
    // typed access.
    const parsed: unknown = JSON.parse(content);

    // Strict raw-shape validation. Throws ConfigError(SR-VALID-005) if any
    // top-level required field (agentId / version / c1 / steps) is missing,
    // or if any step uses the legacy disk shape (`stepKind` + flat C3L
    // siblings) or is missing `kind` / `address`. After this returns,
    // `parsed` is known to match the new-shape contract.
    //
    // T35 single-source partition (critique-6 N#2): top-level presence
    // used to be re-checked here and again inside `validateStepRegistry`
    // (SR-VALID-004). Both copies were removed; `validateRegistryShape`
    // is the sole owner.
    validateRegistryShape(parsed);

    // Top-level fields are now proven present. Read agentId for mismatch
    // detection (the next concern, owned here at the loader because it
    // depends on the caller-supplied `agentId` argument).
    const raw = parsed as { agentId: string };

    // Ensure agentId matches the caller's expectation.
    if (raw.agentId !== agentId) {
      throw srLoadAgentIdMismatch(agentId, raw.agentId);
    }

    // The strict validator has proven the shape is the typed StepRegistry.
    // No field renaming, no aggregation, no inference — direct cast.
    const registry: StepRegistry = parsed as StepRegistry;

    // Always validate stepKind/allowedIntents consistency (fail fast)
    validateStepKindIntents(registry);

    // Validate entryStepMapping references (fail fast)
    validateEntryStepMapping(registry);

    // Validate intentSchemaRef presence and format (fail fast per design doc Section 4)
    validateIntentSchemaRef(registry);

    // Validate intent schema enum matches allowedIntents.
    //
    // Strict-by-default (T18/B3, hardened in T29/critique-5 B#2): the option
    // shape is a discriminated union, so the silent-skip cell
    // `(validateIntentEnums:true, schemasDir:absent)` is unrepresentable at
    // the type level. When the caller selects the opt-out variant
    // (`validateIntentEnums:false`) they commit to running
    // `validateIntentSchemaEnums` themselves with a caller-resolved
    // schemasDir (closure-manager is the only legitimate site).
    if (options.validateIntentEnums !== false) {
      // Strict variant — the union narrows so `schemasDir` is `string`.
      await validateIntentSchemaEnums(registry, options.schemasDir);
    }

    // Always validate the full ADT shape (T23 / critique-3 #12). The
    // `validateRegistryShape` raw-shape validator above only proves the
    // legacy disk shape is rejected and the new-shape discriminator
    // (`kind` + `address.{c1,c2,c3,edition}`) is present. Field-level
    // typing (`name` non-empty string, `uvVariables` array, `usesStdin`
    // boolean, `structuredGate` shape, `permissionMode` enum, etc.) is
    // covered only by `validateStepRegistry`. Skipping this validator
    // would leave the `parsed as StepRegistry` cast broader than what
    // has been verified, type-detricting downstream consumers. No
    // production caller has ever opted in via the previous
    // `options.validateSchema` flag, so the gating option was removed.
    validateStepRegistry(registry);

    return registry;
  } catch (error) {
    // T38 / critique-6 N#5: SR-LOAD-003 swallow is centralized here.
    // The loader is the single owner of the "registry file absent on
    // disk" policy; callers express their intent declaratively via
    // `options.allowMissing` (default `false` = loud throw).
    //
    // Two raise sites map onto SR-LOAD-003:
    //   1. `Deno.errors.NotFound` from `Deno.readTextFile`.
    //   2. ConfigError(SR-LOAD-003) re-thrown from a deeper helper (today
    //      no other site raises it, but the check is symmetric so
    //      future indirection through helpers stays correct).
    //
    // All other ConfigError codes (SR-VALID-*, SR-LOAD-002,
    // SR-INTENT-*) and any non-ConfigError exception MUST propagate
    // unchanged — they signal a malformed registry, not an absent one.
    const isNotFound = error instanceof Deno.errors.NotFound ||
      (error instanceof ConfigError && error.code === "SR-LOAD-003");
    if (isNotFound) {
      // `allowMissing` exists only on the strict variant (T42); structural
      // narrowing keeps opt-out callers' undefined field from coercing to
      // true without an extra discriminator branch.
      const allowMissing = "allowMissing" in options &&
        options.allowMissing === true;
      if (allowMissing) {
        // Caller opted in: fabricate an empty registry whose `agentId`
        // matches the caller's expectation. `c1` defaults to "steps"
        // (createEmptyRegistry default) so downstream PromptResolver and
        // bundle assemblers keep operating without further branching.
        return createEmptyRegistry(agentId);
      }
      // Default loud throw — replace `Deno.errors.NotFound` with the
      // typed ConfigError so callers always see a stable code.
      if (error instanceof Deno.errors.NotFound) {
        throw srLoadNotFound(registryPath);
      }
    }
    throw error;
  }
}
