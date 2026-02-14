/**
 * LogWriter Strategy Interface
 *
 * Defines the contract for log writing strategies.
 * Implementations handle how/where log entries are persisted.
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";

/**
 * Log entry for the unified logging system.
 * Superset of fields needed by all three logger implementations.
 */
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: string;
  /** Human-readable message */
  message: string;
  /** Optional step counter */
  step?: number;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Strategy interface for log writing.
 *
 * - JsonlWriter: appends JSONL lines to a single file
 * - TextWriter: appends text lines to a single file
 * - FilePerEntryWriter: writes each entry as a separate file + index
 */
export interface LogWriter {
  /** Write a single log entry */
  write(entry: LogEntry): Promise<void>;
  /** Close any open handles */
  close(): Promise<void>;
  /** Get the path to the log output (file or directory) */
  getLogPath(): string;
}

/**
 * JSONL append writer - writes one JSON line per entry to a single file.
 *
 * Used by both src_common/logger.ts and common/logger.ts.
 */
export class JsonlWriter implements LogWriter {
  private file: Deno.FsFile | null = null;
  private logPath: string;
  private encoder = new TextEncoder();

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  async initialize(): Promise<void> {
    const dir = this.logPath.substring(0, this.logPath.lastIndexOf("/"));
    if (dir) {
      await ensureDir(dir);
    }
    this.file = await Deno.open(this.logPath, {
      write: true,
      create: true,
      append: true,
    });
  }

  async write(entry: LogEntry): Promise<void> {
    if (!this.file) return;
    const line = JSON.stringify(entry) + "\n";
    await this.file.write(this.encoder.encode(line));
  }

  // deno-lint-ignore require-await -- interface conformance
  async close(): Promise<void> {
    if (this.file) {
      this.file.close();
      this.file = null;
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}

/**
 * Text append writer - writes formatted text lines to a single file.
 *
 * Used by src_common/logger.ts when format is "text".
 */
export class TextWriter implements LogWriter {
  private file: Deno.FsFile | null = null;
  private logPath: string;
  private encoder = new TextEncoder();

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  async initialize(): Promise<void> {
    const dir = this.logPath.substring(0, this.logPath.lastIndexOf("/"));
    if (dir) {
      await ensureDir(dir);
    }
    this.file = await Deno.open(this.logPath, {
      write: true,
      create: true,
      append: true,
    });
  }

  async write(entry: LogEntry): Promise<void> {
    if (!this.file) return;
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
    const line = entry.metadata
      ? `${prefix} ${entry.message} ${JSON.stringify(entry.metadata)}\n`
      : `${prefix} ${entry.message}\n`;
    await this.file.write(this.encoder.encode(line));
  }

  // deno-lint-ignore require-await -- interface conformance
  async close(): Promise<void> {
    if (this.file) {
      this.file.close();
      this.file = null;
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}

/**
 * Sync JSONL writer - uses writeSync for src_common/logger.ts compatibility.
 *
 * The src_common Logger has sync log methods (debug/info/warn/error)
 * that call writeSync internally. This writer supports both sync and async.
 * Async methods conform to LogWriter interface despite sync internals.
 */
export class SyncJsonlWriter implements LogWriter {
  private file: Deno.FsFile | null = null;
  private logPath: string;
  private encoder = new TextEncoder();

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  async initialize(): Promise<void> {
    const dir = this.logPath.substring(0, this.logPath.lastIndexOf("/"));
    if (dir) {
      await ensureDir(dir);
    }
    this.file = await Deno.open(this.logPath, {
      write: true,
      create: true,
      append: true,
    });
  }

  /** Sync write for compatibility with src_common Logger */
  writeSync(entry: LogEntry): void {
    if (!this.file) return;
    const line = JSON.stringify(entry) + "\n";
    this.file.writeSync(this.encoder.encode(line));
  }

  // deno-lint-ignore require-await -- LogWriter interface conformance
  async write(entry: LogEntry): Promise<void> {
    this.writeSync(entry);
  }

  // deno-lint-ignore require-await -- LogWriter interface conformance
  async close(): Promise<void> {
    if (this.file) {
      this.file.close();
      this.file = undefined as unknown as null;
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}

/**
 * Sync text writer - uses writeSync for src_common/logger.ts text format.
 */
export class SyncTextWriter implements LogWriter {
  private file: Deno.FsFile | null = null;
  private logPath: string;
  private encoder = new TextEncoder();

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  async initialize(): Promise<void> {
    const dir = this.logPath.substring(0, this.logPath.lastIndexOf("/"));
    if (dir) {
      await ensureDir(dir);
    }
    this.file = await Deno.open(this.logPath, {
      write: true,
      create: true,
      append: true,
    });
  }

  writeSync(entry: LogEntry): void {
    if (!this.file) return;
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
    const line = entry.metadata
      ? `${prefix} ${entry.message} ${JSON.stringify(entry.metadata)}\n`
      : `${prefix} ${entry.message}\n`;
    this.file.writeSync(this.encoder.encode(line));
  }

  // deno-lint-ignore require-await -- LogWriter interface conformance
  async write(entry: LogEntry): Promise<void> {
    this.writeSync(entry);
  }

  // deno-lint-ignore require-await -- LogWriter interface conformance
  async close(): Promise<void> {
    if (this.file) {
      this.file.close();
      this.file = undefined as unknown as null;
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}

/**
 * File-per-entry writer - writes each entry as a separate file with an index.
 *
 * Used by verbose-logger.ts for detailed SDK I/O capture.
 * Each entry becomes its own JSON/MD file, with a JSONL index for metadata.
 */
export class FilePerEntryWriter implements LogWriter {
  private logDir: string;
  private indexFile: Deno.FsFile | null = null;
  private seq = 0;
  private encoder = new TextEncoder();

  constructor(logDir: string) {
    this.logDir = logDir;
  }

  async initialize(): Promise<void> {
    await ensureDir(this.logDir);
    const indexPath = join(this.logDir, "index.jsonl");
    this.indexFile = await Deno.open(indexPath, {
      write: true,
      create: true,
      truncate: true,
    });
  }

  /**
   * Write an entry as a separate file + index line.
   *
   * The entry.metadata may contain:
   * - `_entryType`: verbose entry type for filename
   * - `_subSeq`: sub-sequence number for filename
   * - `_isMarkdown`: whether to save as .md
   * - `_data`: the raw data to write to the file
   * - `_summary`: summary for the index
   * - `_iteration`: current iteration number
   * - `_stepId`: current step ID
   */
  async write(entry: LogEntry): Promise<void> {
    this.seq++;

    const meta = entry.metadata ?? {};
    const entryType = (meta._entryType as string) ?? "log";
    const subSeq = meta._subSeq as number | undefined;
    const isMarkdown = (meta._isMarkdown as boolean) ?? false;
    const data = meta._data ?? entry;
    const summary = (meta._summary as string) ?? undefined;
    const iteration = meta._iteration as number | undefined;
    const stepId = meta._stepId as string | undefined;

    // Generate filename
    const seqStr = String(this.seq).padStart(3, "0");
    const subSeqStr = subSeq !== undefined
      ? `_${String(subSeq).padStart(3, "0")}`
      : "";
    const ext = isMarkdown ? "md" : "json";
    const filename = `${seqStr}_${entryType}${subSeqStr}.${ext}`;

    // Write content file
    const filePath = join(this.logDir, filename);
    let content: string;
    if (isMarkdown) {
      content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    } else {
      content = JSON.stringify(data, null, 2);
    }
    await Deno.writeTextFile(filePath, content);

    // Write index entry
    if (this.indexFile) {
      const indexEntry = {
        seq: this.seq,
        timestamp: entry.timestamp,
        type: entryType,
        filename,
        ...(iteration !== undefined && iteration > 0 && { iteration }),
        ...(stepId && { stepId }),
        ...(summary && { summary }),
      };
      const line = JSON.stringify(indexEntry) + "\n";
      await this.indexFile.write(this.encoder.encode(line));
    }
  }

  // deno-lint-ignore require-await -- interface conformance
  async close(): Promise<void> {
    if (this.indexFile) {
      this.indexFile.close();
      this.indexFile = null;
    }
  }

  getLogPath(): string {
    return this.logDir;
  }

  /** Get the current sequence number */
  getSeq(): number {
    return this.seq;
  }
}
