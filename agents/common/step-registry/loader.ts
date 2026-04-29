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
import { PATHS } from "../../shared/paths.ts";
import {
  srLoadAgentIdMismatch,
  srLoadInvalidFormat,
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
  agentsDir = "agents",
  options: RegistryLoaderOptions = {},
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
    // step uses the legacy disk shape (`stepKind` + flat C3L siblings) or
    // is missing `kind` / `address`. After this returns, `parsed` is known
    // to match the new-shape contract.
    validateRegistryShape(parsed);

    // Validate top-level required fields. The shape validator only checks
    // per-step structure; agentId/version/steps presence belongs here.
    const raw = parsed as {
      agentId?: string;
      version?: string;
      c1?: string;
      steps?: Record<string, unknown>;
      [k: string]: unknown;
    };
    if (!raw.agentId || !raw.version || !raw.c1 || !raw.steps) {
      throw srLoadInvalidFormat();
    }

    // Ensure agentId matches
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

    // Validate intent schema enum matches allowedIntents by default.
    // Strict by default (T18 / B3): the option exists only so callers that
    // perform their own enum validation later (with a non-default schemasDir)
    // can opt out by passing `validateIntentEnums: false`. Default is `true`.
    // Enum validation also requires schemasDir; when omitted the validator
    // is skipped and the caller must run validateIntentSchemaEnums directly.
    const wantEnumValidation = options.validateIntentEnums !== false;
    if (wantEnumValidation && options.schemasDir) {
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
    if (error instanceof Deno.errors.NotFound) {
      throw srLoadNotFound(registryPath);
    }
    throw error;
  }
}
