/**
 * Runtime origin detection for the orchestrator.
 *
 * Distinguishes whether the currently executing climpt module was
 * loaded from JSR (`https://jsr.io/...`) or from a local checkout
 * (`file://...`). Used to stamp session logs so a run's provenance
 * (version + source) is visible without grepping the command line.
 */

import { CLIMPT_VERSION } from "../../src/version.ts";

export interface RuntimeOrigin {
  readonly version: string;
  readonly source: "jsr" | "local";
  readonly moduleUrl: string;
}

export function detectRuntimeOrigin(moduleUrl: string): RuntimeOrigin {
  const isJsr = moduleUrl.startsWith("https://jsr.io/");
  return {
    version: CLIMPT_VERSION,
    source: isJsr ? "jsr" : "local",
    moduleUrl,
  };
}
