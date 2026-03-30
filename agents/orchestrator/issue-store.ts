/**
 * Issue Store
 *
 * Filesystem-backed store for GitHub issue data.
 * Stores issue metadata, body, and comments in a structured
 * directory layout under the configured store path.
 *
 * Directory structure:
 *   {storePath}/{number}/meta.json
 *   {storePath}/{number}/body.md
 *   {storePath}/{number}/comments/{id}.md
 *   {storePath}/{number}/outbox/
 *   {storePath}/{number}/workflow-state.{workflowId}.json
 */

import type { IssueWorkflowState } from "./workflow-types.ts";

/**
 * Check if a process is still running.
 *
 * Uses `ps -p` instead of `kill -0` because kill(2) returns EPERM when
 * the caller's UID differs from the target's, making it indistinguishable
 * from "process not found" on macOS. `ps -p` reads the process table
 * regardless of UID.
 */
async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    const cmd = new Deno.Command("ps", {
      args: ["-p", String(pid)],
      stdout: "null",
      stderr: "null",
    });
    const output = await cmd.output();
    return output.code === 0;
  } catch {
    return false;
  }
}

/** Issue metadata stored in meta.json */
export interface IssueMeta {
  number: number;
  title: string;
  labels: string[];
  state: string;
  assignees: string[];
  milestone: string | null;
}

/** Comment stored in comments/{id}.md */
export interface IssueComment {
  id: string;
  body: string;
}

/** Full issue data for sync */
export interface IssueData {
  meta: IssueMeta;
  body: string;
  comments: IssueComment[];
}

export class IssueStore {
  #storePath: string;
  #dirEnsured = false;

  constructor(storePath: string) {
    this.#storePath = storePath;
  }

  /**
   * Ensure the store directory exists.
   *
   * Call this before any read operations so that a subsequent
   * Deno.errors.NotFound is truly unexpected rather than an
   * ambiguous "first run vs IO error" signal.
   * Idempotent — only hits the filesystem once per instance.
   */
  async ensureDir(): Promise<void> {
    if (this.#dirEnsured) return;
    await Deno.mkdir(this.#storePath, { recursive: true });
    this.#dirEnsured = true;
  }

  /** Write full issue data to store (meta.json + body.md + comments/). */
  async writeIssue(issue: IssueData): Promise<void> {
    const dir = this.getIssuePath(issue.meta.number);
    const commentsDir = `${dir}/comments`;
    const outboxDir = this.getOutboxPath(issue.meta.number);

    await Deno.mkdir(commentsDir, { recursive: true });
    await Deno.mkdir(outboxDir, { recursive: true });

    await Deno.writeTextFile(
      `${dir}/meta.json`,
      JSON.stringify(issue.meta, null, 2) + "\n",
    );
    await Deno.writeTextFile(`${dir}/body.md`, issue.body);

    for (const comment of issue.comments) {
      // deno-lint-ignore no-await-in-loop
      await Deno.writeTextFile(
        `${commentsDir}/${comment.id}.md`,
        comment.body,
      );
    }
  }

  /** Read meta.json for an issue. */
  async readMeta(issueNumber: number): Promise<IssueMeta> {
    const path = `${this.getIssuePath(issueNumber)}/meta.json`;
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as IssueMeta;
  }

  /** Read body.md for an issue. */
  async readBody(issueNumber: number): Promise<string> {
    const path = `${this.getIssuePath(issueNumber)}/body.md`;
    return await Deno.readTextFile(path);
  }

  /** Read all comments for an issue. */
  async readComments(issueNumber: number): Promise<IssueComment[]> {
    const commentsDir = `${this.getIssuePath(issueNumber)}/comments`;
    const comments: IssueComment[] = [];

    for await (const entry of Deno.readDir(commentsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const id = entry.name.replace(/\.md$/, "");
      const body = await Deno.readTextFile(`${commentsDir}/${entry.name}`);
      comments.push({ id, body });
    }

    comments.sort((a, b) => a.id.localeCompare(b.id));
    return comments;
  }

  /** List all issue numbers in store. */
  async listIssues(): Promise<number[]> {
    await this.ensureDir();
    const numbers: number[] = [];

    try {
      for await (const entry of Deno.readDir(this.#storePath)) {
        if (!entry.isDirectory) continue;
        const num = Number(entry.name);
        if (Number.isInteger(num) && num > 0) {
          numbers.push(num);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Directory was ensured above but disappeared — race condition
        // or external deletion. Return empty rather than crash, but log
        // so the situation is traceable.
        // deno-lint-ignore no-console
        console.debug(
          `[IssueStore] NotFound after ensureDir for "${this.#storePath}"`,
        );
        return [];
      }
      throw error;
    }

    numbers.sort((a, b) => a - b);
    return numbers;
  }

  /** Partial update of meta.json. */
  async updateMeta(
    issueNumber: number,
    updates: Partial<IssueMeta>,
  ): Promise<void> {
    const existing = await this.readMeta(issueNumber);
    const merged = { ...existing, ...updates };
    const path = `${this.getIssuePath(issueNumber)}/meta.json`;
    await Deno.writeTextFile(
      path,
      JSON.stringify(merged, null, 2) + "\n",
    );
  }

  /** Get outbox directory path for an issue. */
  getOutboxPath(issueNumber: number): string {
    return `${this.#storePath}/${issueNumber}/outbox`;
  }

  /** Get the root store path. */
  get storePath(): string {
    return this.#storePath;
  }

  /** Clear all files in outbox directory. */
  async clearOutbox(issueNumber: number): Promise<void> {
    const outboxDir = this.getOutboxPath(issueNumber);
    for await (const entry of Deno.readDir(outboxDir)) {
      await Deno.remove(`${outboxDir}/${entry.name}`, { recursive: true });
    }
  }

  /** Write workflow state to {storePath}/{issueNumber}/workflow-state.{workflowId}.json. */
  async writeWorkflowState(
    issueNumber: number,
    state: IssueWorkflowState,
    workflowId: string,
  ): Promise<void> {
    const dir = this.getIssuePath(issueNumber);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/workflow-state.${workflowId}.json`,
      JSON.stringify(state, null, 2) + "\n",
    );
  }

  /** Read workflow state from {storePath}/{issueNumber}/workflow-state.{workflowId}.json. Returns null if not found. */
  async readWorkflowState(
    issueNumber: number,
    workflowId: string,
  ): Promise<IssueWorkflowState | null> {
    const path = `${
      this.getIssuePath(issueNumber)
    }/workflow-state.${workflowId}.json`;
    try {
      const text = await Deno.readTextFile(path);
      return JSON.parse(text) as IssueWorkflowState;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Try to acquire an advisory workflow-level lock.
   *
   * Uses `Deno.open({ createNew: true })` for atomic lock creation.
   * Lock file is at `{storePath}/.lock.{workflowId}` -- scoped per workflow,
   * not per issue. This prevents concurrent batch runs from breaking
   * priority ordering.
   *
   * Returns a release function on success, or `null` if already locked.
   * Stale locks are detected by checking if the owning PID is still alive.
   * Falls back to a 30-minute timeout to guard against PID recycling.
   */
  async acquireLock(
    workflowId: string,
  ): Promise<{ release: () => Promise<void> } | null> {
    await Deno.mkdir(this.#storePath, { recursive: true });
    const lockPath = `${this.#storePath}/.lock.${workflowId}`;

    // Check for stale lock
    await this.#cleanStaleLock(lockPath);

    let file: Deno.FsFile;
    try {
      file = await Deno.open(lockPath, { createNew: true, write: true });
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) {
        return null;
      }
      throw error;
    }

    // Write PID and timestamp for stale detection
    const info = JSON.stringify({
      pid: Deno.pid,
      acquiredAt: new Date().toISOString(),
    });
    await file.write(new TextEncoder().encode(info));
    file.close();

    return {
      release: async () => {
        try {
          await Deno.remove(lockPath);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      },
    };
  }

  /**
   * Remove a lock file if the owning process is no longer alive,
   * or if the lock is older than 30 minutes (PID recycling guard).
   */
  async #cleanStaleLock(lockPath: string): Promise<void> {
    let text: string;
    try {
      text = await Deno.readTextFile(lockPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }

    let stale = false;
    try {
      const info = JSON.parse(text) as { pid: number; acquiredAt: string };
      if (!(await isProcessAlive(info.pid))) {
        stale = true;
      } else {
        // PID alive — fall back to time-based check for PID recycling
        const ageMs = Date.now() - new Date(info.acquiredAt).getTime();
        if (ageMs > 30 * 60 * 1000) {
          stale = true;
        }
      }
    } catch {
      // Corrupt lock file — treat as stale
      stale = true;
    }

    if (stale) {
      try {
        await Deno.remove(lockPath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }

  /** Get issue directory path. */
  getIssuePath(issueNumber: number): string {
    return `${this.#storePath}/${issueNumber}`;
  }
}
