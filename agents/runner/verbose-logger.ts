/**
 * Verbose Logger for Agent SDK I/O
 *
 * Re-exports the shared VerboseLogger implementation.
 * This file exists for backward compatibility with existing imports.
 *
 * @module
 */

export {
  createVerboseLogger,
  type IndexEntry,
  type VerboseEntryType,
  VerboseLogger,
} from "../shared/logging/verbose-logger.ts";
