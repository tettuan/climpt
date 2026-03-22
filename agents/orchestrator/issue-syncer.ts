/**
 * Issue Syncer
 *
 * Fetches issues from GitHub matching given criteria and
 * syncs their full details into the local IssueStore.
 * Also supports pushing label changes back to GitHub.
 */

import type { GitHubClient, IssueCriteria } from "./github-client.ts";
import type { IssueStore } from "./issue-store.ts";

export class IssueSyncer {
  #github: GitHubClient;
  #store: IssueStore;

  constructor(github: GitHubClient, store: IssueStore) {
    this.#github = github;
    this.#store = store;
  }

  /** Fetch issues matching criteria, sync full details to local store. */
  async sync(criteria: IssueCriteria): Promise<number[]> {
    const items = await this.#github.listIssues(criteria);
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

  /** Push label changes to GitHub and update local store. */
  async pushLabels(
    issueNumber: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    await this.#github.updateIssueLabels(
      issueNumber,
      labelsToRemove,
      labelsToAdd,
    );

    const meta = await this.#store.readMeta(issueNumber);
    const updated = meta.labels
      .filter((l) => !labelsToRemove.includes(l))
      .concat(labelsToAdd.filter((l) => !meta.labels.includes(l)));
    await this.#store.updateMeta(issueNumber, { labels: updated });
  }
}
