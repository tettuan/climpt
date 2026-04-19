/**
 * Subject Store
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

import type { IssueWorkflowState, SubjectPayload } from "./workflow-types.ts";

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

export class SubjectStore {
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
  async readMeta(subjectId: string | number): Promise<IssueMeta> {
    const path = `${this.getIssuePath(subjectId)}/meta.json`;
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as IssueMeta;
  }

  /** Read body.md for an issue. */
  async readBody(subjectId: string | number): Promise<string> {
    const path = `${this.getIssuePath(subjectId)}/body.md`;
    return await Deno.readTextFile(path);
  }

  /** Read all comments for an issue. */
  async readComments(subjectId: string | number): Promise<IssueComment[]> {
    const commentsDir = `${this.getIssuePath(subjectId)}/comments`;
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
          `[SubjectStore] NotFound after ensureDir for "${this.#storePath}"`,
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
    subjectId: string | number,
    updates: Partial<IssueMeta>,
  ): Promise<void> {
    const existing = await this.readMeta(subjectId);
    const merged = { ...existing, ...updates };
    const path = `${this.getIssuePath(subjectId)}/meta.json`;
    await Deno.writeTextFile(
      path,
      JSON.stringify(merged, null, 2) + "\n",
    );
  }

  /** Get outbox directory path for an issue. */
  getOutboxPath(subjectId: string | number): string {
    return `${this.#storePath}/${subjectId}/outbox`;
  }

  /** Get the root store path. */
  get storePath(): string {
    return this.#storePath;
  }

  /** Clear all files in outbox directory. */
  async clearOutbox(subjectId: string | number): Promise<void> {
    const outboxDir = this.getOutboxPath(subjectId);
    for await (const entry of Deno.readDir(outboxDir)) {
      await Deno.remove(`${outboxDir}/${entry.name}`, { recursive: true });
    }
  }

  /** Write workflow state to {storePath}/{subjectId}/workflow-state.{workflowId}.json. */
  async writeWorkflowState(
    subjectId: string | number,
    state: IssueWorkflowState,
    workflowId: string,
  ): Promise<void> {
    const dir = this.getIssuePath(subjectId);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/workflow-state.${workflowId}.json`,
      JSON.stringify(state, null, 2) + "\n",
    );
  }

  /** Read workflow state from {storePath}/{subjectId}/workflow-state.{workflowId}.json. Returns null if not found. */
  async readWorkflowState(
    subjectId: string | number,
    workflowId: string,
  ): Promise<IssueWorkflowState | null> {
    const path = `${
      this.getIssuePath(subjectId)
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
   * Write an opaque workflow payload to
   * `{storePath}/{subjectId}/workflow-payload.{workflowId}.json`.
   *
   * Payload shape is workflow-specific and opaque to the store; callers
   * are responsible for schema validation before calling this method.
   */
  async writeWorkflowPayload(
    subjectId: string | number,
    workflowId: string,
    payload: SubjectPayload,
  ): Promise<void> {
    const dir = this.getIssuePath(subjectId);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/workflow-payload.${workflowId}.json`,
      JSON.stringify(payload, null, 2) + "\n",
    );
  }

  /**
   * Read a previously persisted workflow payload.
   *
   * Returns `undefined` when no payload has been written for this
   * `(subjectId, workflowId)` pair. Any other IO or JSON parse error
   * is propagated; this distinguishes "not present yet" from "corrupt
   * state" in a way callers can branch on.
   */
  async readWorkflowPayload(
    subjectId: string | number,
    workflowId: string,
  ): Promise<SubjectPayload | undefined> {
    const path = `${
      this.getIssuePath(subjectId)
    }/workflow-payload.${workflowId}.json`;
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return undefined;
      }
      throw error;
    }
    return JSON.parse(text) as SubjectPayload;
  }

  /**
   * Try to acquire an advisory workflow-level lock.
   *
   * Two-step hybrid:
   *  1. `createNew: true` — atomic file creation for instant try semantics.
   *     If the file already exists, fall through to step 2.
   *  2. Open the existing file and `flock(LOCK_EX)` with a short timeout.
   *     If the flock succeeds, the previous holder died (kernel released
   *     the flock but left the file). If it times out, an active process
   *     still holds the lock.
   *
   * On normal release: unlock → close → remove file.
   * On SIGKILL: kernel closes the fd (releasing flock), file stays on
   * disk, and the next caller recovers it via step 2.
   *
   * Lock file is at `{storePath}/.lock.{workflowId}` -- scoped per workflow,
   * not per issue. This prevents concurrent batch runs from breaking
   * priority ordering.
   *
   * Returns a release function on success, or `null` if already locked.
   */
  async acquireLock(
    workflowId: string,
  ): Promise<{ release: () => void } | null> {
    await Deno.mkdir(this.#storePath, { recursive: true });
    const lockPath = `${this.#storePath}/.lock.${workflowId}`;

    // Step 1: try atomic creation (instant success/fail)
    try {
      const file = await Deno.open(lockPath, {
        createNew: true,
        write: true,
      });
      // We just created the file — flock is instant (no contention)
      const exclusive = true;
      file.lockSync(exclusive);
      return this.#makeLockHandle(file, lockPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        return null;
      }
      // File exists — fall through to recovery
    }

    // Step 2: file exists — try to flock it (succeeds if previous holder died)
    let file: Deno.FsFile;
    try {
      file = await Deno.open(lockPath, { write: true });
    } catch {
      return null;
    }

    const LOCK_TIMEOUT_MS = 50;
    const exclusive = true;
    let timerId: number | undefined;
    const lockPromise = file.lock(exclusive).then(() => "acquired" as const);
    const timeout = Symbol("timeout");
    const result = await Promise.race([
      lockPromise,
      new Promise<typeof timeout>((resolve) => {
        timerId = setTimeout(() => resolve(timeout), LOCK_TIMEOUT_MS);
      }),
    ]);

    clearTimeout(timerId);

    if (result === timeout) {
      // Active lock held by another process
      lockPromise.catch(() => {});
      file.close();
      return null;
    }

    return this.#makeLockHandle(file, lockPath);
  }

  #makeLockHandle(
    file: Deno.FsFile,
    lockPath: string,
  ): { release: () => void } {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        try {
          file.unlockSync();
        } catch { /* already unlocked */ }
        try {
          file.close();
        } catch { /* already closed */ }
        try {
          Deno.removeSync(lockPath);
        } catch { /* already removed */ }
      },
    };
  }

  /**
   * Try to acquire a per-issue lock.
   *
   * Delegates to `acquireLock` with a composite key so that
   * individual issues can be processed concurrently while still
   * preventing duplicate processing of the same issue.
   */
  async acquireIssueLock(
    workflowId: string,
    subjectId: string | number,
  ): Promise<{ release: () => void } | null> {
    return await this.acquireLock(`${workflowId}.${subjectId}`);
  }

  /**
   * Read persisted idempotency keys for deferred-item emission.
   *
   * Returns `[]` when no keys have been recorded yet (file absent).
   * Any IO or JSON parse error other than NotFound is propagated.
   */
  async readEmittedKeys(subjectId: string | number): Promise<string[]> {
    const path = this.getEmittedKeysPath(subjectId);
    try {
      const text = await Deno.readTextFile(path);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed as string[];
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Persist idempotency keys for deferred-item emission.
   *
   * Overwrites the existing file. Callers are responsible for merging
   * with previous keys before calling.
   */
  async writeEmittedKeys(
    subjectId: string | number,
    keys: string[],
  ): Promise<void> {
    const dir = this.getIssuePath(subjectId);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      this.getEmittedKeysPath(subjectId),
      JSON.stringify(keys, null, 2) + "\n",
    );
  }

  /** Get path to the deferred-emitted-keys file. */
  getEmittedKeysPath(subjectId: string | number): string {
    return `${this.getIssuePath(subjectId)}/deferred-emitted-keys.json`;
  }

  /** Get issue directory path. */
  getIssuePath(subjectId: string | number): string {
    return `${this.#storePath}/${subjectId}`;
  }
}
