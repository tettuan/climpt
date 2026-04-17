/**
 * File-based GitHub Client
 *
 * Implements GitHubClient using IssueStore as the backend.
 * Reads/writes issue data to the local filesystem instead of
 * calling the GitHub API. Used for local E2E testing without
 * network access.
 */

import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";
import type { IssueStore } from "./issue-store.ts";

export class FileGitHubClient implements GitHubClient {
  #store: IssueStore;

  constructor(store: IssueStore) {
    this.#store = store;
  }

  async getIssueLabels(issueNumber: number): Promise<string[]> {
    const meta = await this.#store.readMeta(issueNumber);
    return meta.labels;
  }

  async updateIssueLabels(
    issueNumber: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    if (labelsToRemove.length === 0 && labelsToAdd.length === 0) return;
    const meta = await this.#store.readMeta(issueNumber);
    const removeSet = new Set(labelsToRemove);
    const updated = meta.labels.filter((l) => !removeSet.has(l));
    for (const label of labelsToAdd) {
      if (!updated.includes(label)) {
        updated.push(label);
      }
    }
    await this.#store.updateMeta(issueNumber, { labels: updated });
  }

  async addIssueComment(
    issueNumber: number,
    comment: string,
  ): Promise<void> {
    const dir = this.#store.getIssuePath(issueNumber);
    const commentsDir = `${dir}/comments`;
    await Deno.mkdir(commentsDir, { recursive: true });
    const id = String(Date.now());
    await Deno.writeTextFile(`${commentsDir}/${id}.md`, comment);
  }

  async createIssue(
    title: string,
    labels: string[],
    body: string,
  ): Promise<number> {
    const existing = await this.#store.listIssues();
    const nextNumber = existing.length > 0 ? Math.max(...existing) + 1 : 1;
    await this.#store.writeIssue({
      meta: {
        number: nextNumber,
        title,
        labels,
        state: "open",
        assignees: [],
        milestone: null,
      },
      body,
      comments: [],
    });
    return nextNumber;
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.#store.updateMeta(issueNumber, { state: "closed" });
  }

  async reopenIssue(issueNumber: number): Promise<void> {
    await this.#store.updateMeta(issueNumber, { state: "open" });
  }

  async getRecentComments(
    issueNumber: number,
    limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    if (limit <= 0) return [];
    let comments: { id: string; body: string }[] = [];
    try {
      comments = await this.#store.readComments(issueNumber);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      return [];
    }
    // Comment id is a millisecond epoch (see addIssueComment); use it as createdAt.
    const withTimestamp = comments.map((c) => {
      const ms = Number(c.id);
      const createdAt = Number.isFinite(ms) ? new Date(ms).toISOString() : c.id;
      return { body: c.body, createdAt };
    });
    withTimestamp.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return withTimestamp.slice(0, limit);
  }

  async listIssues(criteria: IssueCriteria): Promise<IssueListItem[]> {
    const numbers = await this.#store.listIssues();
    const items: IssueListItem[] = [];
    for (const num of numbers) {
      // deno-lint-ignore no-await-in-loop
      const meta = await this.#store.readMeta(num);
      items.push({
        number: meta.number,
        title: meta.title,
        labels: meta.labels,
        state: meta.state,
      });
    }
    return this.#filterByCriteria(items, criteria);
  }

  async listLabels(): Promise<string[]> {
    // Repository-level label set is kept at `{storePath}/labels.json` as a
    // JSON array of strings — independent of any single issue. When absent,
    // the repository is treated as having no labels (empty set).
    const path = `${this.#store.storePath}/labels.json`;
    try {
      const text = await Deno.readTextFile(path);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error(
          `labels.json must contain a JSON array of strings, got ${typeof parsed}`,
        );
      }
      return parsed.filter((x): x is string => typeof x === "string");
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
  }

  async getIssueDetail(issueNumber: number): Promise<IssueDetail> {
    const meta = await this.#store.readMeta(issueNumber);
    const body = await this.#store.readBody(issueNumber);
    let comments: { id: string; body: string }[] = [];
    try {
      comments = await this.#store.readComments(issueNumber);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return {
      number: meta.number,
      title: meta.title,
      body,
      labels: meta.labels,
      state: meta.state,
      assignees: meta.assignees,
      milestone: meta.milestone,
      comments,
    };
  }

  #filterByCriteria(
    items: IssueListItem[],
    criteria: IssueCriteria,
  ): IssueListItem[] {
    let filtered = items;

    // State filter (default: "open" to match gh CLI behavior)
    const stateFilter = criteria.state ?? "open";
    if (stateFilter !== "all") {
      filtered = filtered.filter(
        (i) => i.state.toLowerCase() === stateFilter,
      );
    }

    // Labels filter (all specified labels must be present)
    if (criteria.labels !== undefined && criteria.labels.length > 0) {
      const required = criteria.labels;
      filtered = filtered.filter((i) =>
        required.every((l) => i.labels.includes(l))
      );
    }

    // Limit
    if (criteria.limit !== undefined) {
      filtered = filtered.slice(0, criteria.limit);
    }

    // repo is ignored for file-based client
    return filtered;
  }
}
