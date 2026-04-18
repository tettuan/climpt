/**
 * File-based GitHub Client
 *
 * Implements GitHubClient using SubjectStore as the backend.
 * Reads/writes issue data to the local filesystem instead of
 * calling the GitHub API. Used for local E2E testing without
 * network access.
 */

import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  LabelDetail,
} from "./github-client.ts";
import type { SubjectStore } from "./subject-store.ts";

export class FileGitHubClient implements GitHubClient {
  #store: SubjectStore;

  constructor(store: SubjectStore) {
    this.#store = store;
  }

  async getIssueLabels(subjectId: string | number): Promise<string[]> {
    const meta = await this.#store.readMeta(subjectId);
    return meta.labels;
  }

  async updateIssueLabels(
    subjectId: string | number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    if (labelsToRemove.length === 0 && labelsToAdd.length === 0) return;
    const meta = await this.#store.readMeta(subjectId);
    const removeSet = new Set(labelsToRemove);
    const updated = meta.labels.filter((l) => !removeSet.has(l));
    for (const label of labelsToAdd) {
      if (!updated.includes(label)) {
        updated.push(label);
      }
    }
    await this.#store.updateMeta(subjectId, { labels: updated });
  }

  async addIssueComment(
    subjectId: string | number,
    comment: string,
  ): Promise<void> {
    const dir = this.#store.getIssuePath(subjectId);
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

  async closeIssue(subjectId: string | number): Promise<void> {
    await this.#store.updateMeta(subjectId, { state: "closed" });
  }

  async reopenIssue(subjectId: string | number): Promise<void> {
    await this.#store.updateMeta(subjectId, { state: "open" });
  }

  async getRecentComments(
    subjectId: string | number,
    limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    if (limit <= 0) return [];
    let comments: { id: string; body: string }[] = [];
    try {
      comments = await this.#store.readComments(subjectId);
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
      if (Array.isArray(parsed)) {
        // Legacy flat format: array of strings.
        return parsed.filter((x): x is string => typeof x === "string");
      }
      if (parsed && typeof parsed === "object") {
        // Detailed format: object keyed by name → {color, description}.
        return Object.keys(parsed);
      }
      throw new Error(
        `labels.json must be a JSON array or object, got ${typeof parsed}`,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
  }

  async listLabelsDetailed(): Promise<LabelDetail[]> {
    const path = `${this.#store.storePath}/labels.json`;
    try {
      const text = await Deno.readTextFile(path);
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        // Legacy flat format: array of strings has no color/description.
        return parsed
          .filter((x): x is string => typeof x === "string")
          .map((name) => ({ name, color: "", description: "" }));
      }
      if (parsed && typeof parsed === "object") {
        const result: LabelDetail[] = [];
        for (const [name, raw] of Object.entries(parsed)) {
          const spec = raw as { color?: string; description?: string };
          result.push({
            name,
            color: (spec.color ?? "").replace(/^#/, "").toLowerCase(),
            description: spec.description ?? "",
          });
        }
        return result;
      }
      throw new Error(
        `labels.json must be a JSON array or object, got ${typeof parsed}`,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
  }

  async createLabel(
    name: string,
    color: string,
    description: string,
  ): Promise<void> {
    const existing = await this.#readLabelMap();
    if (Object.prototype.hasOwnProperty.call(existing, name)) {
      throw new Error(`Label "${name}" already exists`);
    }
    existing[name] = {
      color: color.toLowerCase(),
      description,
    };
    await this.#writeLabelMap(existing);
  }

  async updateLabel(
    name: string,
    color: string,
    description: string,
  ): Promise<void> {
    const existing = await this.#readLabelMap();
    if (!Object.prototype.hasOwnProperty.call(existing, name)) {
      throw new Error(`Label "${name}" does not exist`);
    }
    existing[name] = {
      color: color.toLowerCase(),
      description,
    };
    await this.#writeLabelMap(existing);
  }

  async #readLabelMap(): Promise<
    Record<string, { color: string; description: string }>
  > {
    const path = `${this.#store.storePath}/labels.json`;
    try {
      const text = await Deno.readTextFile(path);
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        // Upgrade legacy flat format in-memory; writer will persist detailed.
        const map: Record<string, { color: string; description: string }> = {};
        for (const name of parsed) {
          if (typeof name === "string") {
            map[name] = { color: "", description: "" };
          }
        }
        return map;
      }
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, { color: string; description: string }>;
      }
      throw new Error(
        `labels.json must be a JSON array or object, got ${typeof parsed}`,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return {};
      throw error;
    }
  }

  async #writeLabelMap(
    map: Record<string, { color: string; description: string }>,
  ): Promise<void> {
    const path = `${this.#store.storePath}/labels.json`;
    await Deno.mkdir(this.#store.storePath, { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(map, null, 2));
  }

  async getIssueDetail(subjectId: string | number): Promise<IssueDetail> {
    const meta = await this.#store.readMeta(subjectId);
    const body = await this.#store.readBody(subjectId);
    let comments: { id: string; body: string }[] = [];
    try {
      comments = await this.#store.readComments(subjectId);
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
