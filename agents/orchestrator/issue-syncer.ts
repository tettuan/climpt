/**
 * Issue Syncer
 *
 * Fetches issues from GitHub matching a declared {@link IssueSource}
 * variant and syncs their full details into the local SubjectStore.
 * Also supports pushing label changes back to GitHub.
 *
 * The variant discriminator (`source.kind`) drives an exhaustive switch
 * — see `agents/docs/design/realistic/12-workflow-config.md` §C for the
 * three-variant ADT (`ghProject` / `ghRepoIssues` / `explicit`). The
 * legacy field-presence pattern (`criteria.project` ⇒ project scope,
 * `criteria.allProjects` ⇒ escape hatch, neither ⇒ unbound-only filter)
 * is mapped onto the ADT in `run-workflow.ts` so the runtime sequence is
 * preserved.
 */

import type { GitHubClient, IssueListItem } from "./github-client.ts";
import type { IssueCriteria, IssueSource } from "./workflow-types.ts";
import type { SubjectStore } from "./subject-store.ts";

/** Compile-time exhaustiveness check for {@link IssueSource} variants. */
function assertNever(value: never): never {
  throw new Error(
    `Unreachable: unhandled IssueSource variant ${JSON.stringify(value)}`,
  );
}

export class IssueSyncer {
  #github: GitHubClient;
  #store: SubjectStore;

  constructor(github: GitHubClient, store: SubjectStore) {
    this.#github = github;
    this.#store = store;
  }

  /**
   * Fetch issues described by `source`, sync full details to the local
   * store, and return the synced issue numbers in ascending order.
   *
   * Variants (see {@link IssueSource}):
   *   - `ghProject`: list via gh, intersect with project members.
   *   - `ghRepoIssues`: list via gh, optionally restrict to issues with no
   *     Project v2 membership (`projectMembership` defaults to `"unbound"`).
   *   - `explicit`: skip listing entirely; sync the declared issue ids.
   */
  async sync(source: IssueSource): Promise<number[]> {
    switch (source.kind) {
      case "ghProject":
        return await this.#syncFromProject(source);
      case "ghRepoIssues":
        return await this.#syncFromRepo(source);
      case "explicit":
        return await this.#syncExplicit(source);
      default:
        return assertNever(source);
    }
  }

  /** Push label changes to GitHub and update local store. */
  async pushLabels(
    subjectId: string | number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    await this.#github.updateIssueLabels(
      subjectId,
      labelsToRemove,
      labelsToAdd,
    );

    const meta = await this.#store.readMeta(subjectId);
    const updated = meta.labels
      .filter((l) => !labelsToRemove.includes(l))
      .concat(labelsToAdd.filter((l) => !meta.labels.includes(l)));
    await this.#store.updateMeta(subjectId, { labels: updated });
  }

  // === Per-variant handlers =================================================

  /**
   * `ghProject`: list issues via gh, intersect with the project's members.
   * Mirrors the legacy `criteria.project !== undefined` branch.
   */
  async #syncFromProject(
    source: Extract<IssueSource, { kind: "ghProject" }>,
  ): Promise<number[]> {
    const items = await this.#github.listIssues(toCriteria(source));
    const projectItems = await this.#github.listProjectItems(source.project);
    const memberNumbers = new Set(projectItems.map((pi) => pi.issueNumber));
    const filtered = items.filter((item) => memberNumbers.has(item.number));
    return await this.#materialize(filtered);
  }

  /**
   * `ghRepoIssues`: list issues via gh; optionally intersect with the
   * complement of any Project v2 membership when
   * `projectMembership === "unbound"` (default — preserves the legacy
   * "global queue" semantic). `"any"` mirrors the legacy
   * `criteria.allProjects = true` escape hatch.
   */
  async #syncFromRepo(
    source: Extract<IssueSource, { kind: "ghRepoIssues" }>,
  ): Promise<number[]> {
    const items = await this.#github.listIssues(toCriteria(source));
    const membership = source.projectMembership ?? "unbound";

    let filtered: IssueListItem[];
    if (membership === "any") {
      filtered = items;
    } else {
      const kept: IssueListItem[] = [];
      for (const item of items) {
        // deno-lint-ignore no-await-in-loop
        const projects = await this.#github.getIssueProjects(item.number);
        if (projects.length === 0) kept.push(item);
      }
      filtered = kept;
    }

    return await this.#materialize(filtered);
  }

  /**
   * `explicit`: skip listing entirely. The declared issue ids are
   * resolved one-by-one via `getIssueDetail`. Issue ids are coerced to
   * numeric form for the SubjectStore key contract (legacy parity).
   */
  async #syncExplicit(
    source: Extract<IssueSource, { kind: "explicit" }>,
  ): Promise<number[]> {
    const numbers: number[] = [];
    for (const ref of source.issueIds) {
      // deno-lint-ignore no-await-in-loop
      const detail = await this.#github.getIssueDetail(ref);
      // deno-lint-ignore no-await-in-loop
      await this.#store.writeIssue({
        meta: {
          number: detail.number,
          title: detail.title,
          labels: detail.labels,
          state: detail.state,
          assignees: detail.assignees,
          milestone: detail.milestone,
        },
        body: detail.body,
        comments: detail.comments,
      });
      numbers.push(detail.number);
    }
    numbers.sort((a, b) => a - b);
    return numbers;
  }

  /**
   * Resolve every list item's full detail and persist it to the store.
   * Returns the synced numbers ascending. Shared tail of the gh-listing
   * variants (`ghProject` and `ghRepoIssues`).
   */
  async #materialize(items: IssueListItem[]): Promise<number[]> {
    const numbers: number[] = [];
    for (const item of items) {
      // deno-lint-ignore no-await-in-loop
      const detail = await this.#github.getIssueDetail(item.number);
      // deno-lint-ignore no-await-in-loop
      await this.#store.writeIssue({
        meta: {
          number: detail.number,
          title: detail.title,
          labels: detail.labels,
          state: detail.state,
          assignees: detail.assignees,
          milestone: detail.milestone,
        },
        body: detail.body,
        comments: detail.comments,
      });
      numbers.push(detail.number);
    }
    numbers.sort((a, b) => a - b);
    return numbers;
  }
}

/**
 * Project the listing-flavored `IssueSource` variants down to the
 * transport-level {@link IssueCriteria} shape consumed by
 * {@link GitHubClient.listIssues}. The variant-specific fields (`project`
 * / `projectMembership`) are filtered out by construction.
 */
function toCriteria(
  source:
    | Extract<IssueSource, { kind: "ghProject" }>
    | Extract<IssueSource, { kind: "ghRepoIssues" }>,
): IssueCriteria {
  const criteria: IssueCriteria = {};
  if (source.labels !== undefined) criteria.labels = source.labels;
  if (source.state !== undefined) criteria.state = source.state;
  if (source.limit !== undefined) criteria.limit = source.limit;
  if (source.kind === "ghRepoIssues" && source.repo !== undefined) {
    criteria.repo = source.repo;
  }
  return criteria;
}
