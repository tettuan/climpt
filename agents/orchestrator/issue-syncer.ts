/**
 * Issue Syncer
 *
 * Fetches issues from GitHub matching given criteria and
 * syncs their full details into the local SubjectStore.
 * Also supports pushing label changes back to GitHub.
 */

import type { GitHubClient, IssueCriteria } from "./github-client.ts";
import type { SubjectStore } from "./subject-store.ts";

export class IssueSyncer {
  #github: GitHubClient;
  #store: SubjectStore;

  constructor(github: GitHubClient, store: SubjectStore) {
    this.#github = github;
    this.#store = store;
  }

  /** Fetch issues matching criteria, sync full details to local store. */
  async sync(criteria: IssueCriteria): Promise<number[]> {
    const items = await this.#github.listIssues(criteria);

    // Project scoping (three forms):
    //   criteria.project set        → keep only members of that project
    //   criteria.allProjects = true → keep everything (escape hatch)
    //   neither (default)           → keep only issues with NO project membership
    let filtered: typeof items;
    if (criteria.project !== undefined) {
      const projectItems = await this.#github.listProjectItems(
        criteria.project,
      );
      const memberNumbers = new Set(
        projectItems.map((pi) => pi.issueNumber),
      );
      filtered = items.filter((item) => memberNumbers.has(item.number));
    } else if (criteria.allProjects) {
      filtered = items;
    } else {
      const kept: typeof items = [];
      for (const item of items) {
        // deno-lint-ignore no-await-in-loop
        const projects = await this.#github.getIssueProjects(item.number);
        if (projects.length === 0) kept.push(item);
      }
      filtered = kept;
    }

    const numbers: number[] = [];

    for (const item of filtered) {
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
}
