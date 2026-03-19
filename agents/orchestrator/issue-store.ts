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
 */

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

  constructor(storePath: string) {
    this.#storePath = storePath;
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

  /** Get issue directory path. */
  getIssuePath(issueNumber: number): string {
    return `${this.#storePath}/${issueNumber}`;
  }
}
