/**
 * Shared Logging Module
 *
 * Unified logging infrastructure with Strategy pattern.
 *
 * Architecture:
 *   LogWriter (interface)
 *     |-- JsonlWriter        (async JSONL append)
 *     |-- TextWriter          (async text append)
 *     |-- SyncJsonlWriter     (sync JSONL append - src_common compat)
 *     |-- SyncTextWriter      (sync text append - src_common compat)
 *     +-- FilePerEntryWriter  (1 file per entry + index)
 *
 *   AgentLogger              (unified API, delegates to LogWriter)
 *   VerboseLogger            (AgentLogger + FilePerEntryWriter)
 *   rotateLogFiles           (log file rotation utility)
 */

export type { LogEntry, LogWriter } from "./log-writer.ts";
export {
  FilePerEntryWriter,
  JsonlWriter,
  SyncJsonlWriter,
  SyncTextWriter,
  TextWriter,
} from "./log-writer.ts";

export { AgentLogger } from "./agent-logger.ts";

export type { IndexEntry, VerboseEntryType } from "./verbose-logger.ts";
export { createVerboseLogger, VerboseLogger } from "./verbose-logger.ts";

export { rotateLogFiles } from "./log-rotation.ts";
