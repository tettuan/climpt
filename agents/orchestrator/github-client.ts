/**
 * GitHub Client - Abstract GitHub operations for testability
 *
 * Provides an interface for label management, issue listing,
 * issue detail retrieval, and comments, with a concrete
 * implementation using the `gh` CLI.
 */

import type { IssueCriteria } from "./workflow-types.ts";

export type { IssueCriteria };

/** Summary item returned by listIssues. */
export interface IssueListItem {
  number: number;
  title: string;
  labels: string[];
  state: string;
}

/** Full detail returned by getIssueDetail. */
export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  assignees: string[];
  milestone: string | null;
  comments: { id: string; body: string }[];
}

/** Abstract interface for GitHub issue operations. */
export interface GitHubClient {
  getIssueLabels(issueNumber: number): Promise<string[]>;
  updateIssueLabels(
    issueNumber: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void>;
  addIssueComment(issueNumber: number, comment: string): Promise<void>;
  createIssue(title: string, labels: string[], body: string): Promise<number>;
  closeIssue(issueNumber: number): Promise<void>;
  listIssues(criteria: IssueCriteria): Promise<IssueListItem[]>;
  getIssueDetail(issueNumber: number): Promise<IssueDetail>;
}

/** Concrete implementation using `gh` CLI via Deno.Command. */
export class GhCliClient implements GitHubClient {
  #cwd: string;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  async getIssueLabels(issueNumber: number): Promise<string[]> {
    const cmd = new Deno.Command("gh", {
      args: [
        "issue",
        "view",
        String(issueNumber),
        "--json",
        "labels",
        "--jq",
        ".labels[].name",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to get labels for issue #${issueNumber}: ${stderr}`,
      );
    }

    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];
    return stdout.split("\n").filter((l) => l.length > 0);
  }

  async updateIssueLabels(
    issueNumber: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    const args = ["issue", "edit", String(issueNumber)];

    for (const label of labelsToRemove) {
      args.push("--remove-label", label);
    }
    for (const label of labelsToAdd) {
      args.push("--add-label", label);
    }

    if (labelsToRemove.length === 0 && labelsToAdd.length === 0) return;

    const cmd = new Deno.Command("gh", {
      args,
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to update labels for issue #${issueNumber}: ${stderr}`,
      );
    }
  }

  async addIssueComment(
    issueNumber: number,
    comment: string,
  ): Promise<void> {
    const cmd = new Deno.Command("gh", {
      args: [
        "issue",
        "comment",
        String(issueNumber),
        "--body",
        comment,
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to add comment to issue #${issueNumber}: ${stderr}`,
      );
    }
  }

  async createIssue(
    title: string,
    labels: string[],
    body: string,
  ): Promise<number> {
    const args = ["issue", "create", "--title", title, "--body", body];

    for (const label of labels) {
      args.push("--label", label);
    }

    const cmd = new Deno.Command("gh", {
      args,
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Failed to create issue: ${stderr}`);
    }

    // gh issue create outputs the URL of the new issue
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const match = stdout.match(/\/(\d+)\s*$/);
    if (match === null) {
      throw new Error(`Could not parse issue number from output: ${stdout}`);
    }
    return Number(match[1]);
  }

  async closeIssue(issueNumber: number): Promise<void> {
    const cmd = new Deno.Command("gh", {
      args: ["issue", "close", String(issueNumber)],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to close issue #${issueNumber}: ${stderr}`,
      );
    }
  }

  async listIssues(criteria: IssueCriteria): Promise<IssueListItem[]> {
    const args = [
      "issue",
      "list",
      "--json",
      "number,title,labels,state",
    ];

    if (criteria.state !== undefined) {
      args.push("--state", criteria.state);
    }
    if (criteria.limit !== undefined) {
      args.push("--limit", String(criteria.limit));
    }
    if (criteria.labels !== undefined) {
      for (const label of criteria.labels) {
        args.push("--label", label);
      }
    }
    if (criteria.repo !== undefined) {
      args.push("--repo", criteria.repo);
    }

    const cmd = new Deno.Command("gh", {
      args,
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Failed to list issues: ${stderr}`);
    }

    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];

    const raw = JSON.parse(stdout) as {
      number: number;
      title: string;
      labels: { name: string }[];
      state: string;
    }[];

    return raw.map((item) => ({
      number: item.number,
      title: item.title,
      labels: item.labels.map((l) => l.name),
      state: item.state,
    }));
  }

  async getIssueDetail(issueNumber: number): Promise<IssueDetail> {
    const cmd = new Deno.Command("gh", {
      args: [
        "issue",
        "view",
        String(issueNumber),
        "--json",
        "number,title,body,labels,state,assignees,milestone,comments",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to get detail for issue #${issueNumber}: ${stderr}`,
      );
    }

    const raw = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      number: number;
      title: string;
      body: string;
      labels: { name: string }[];
      state: string;
      assignees: { login: string }[];
      milestone: { title: string } | null;
      comments: { id: string; body: string }[];
    };

    return {
      number: raw.number,
      title: raw.title,
      body: raw.body,
      labels: raw.labels.map((l) => l.name),
      state: raw.state,
      assignees: raw.assignees.map((a) => a.login),
      milestone: raw.milestone?.title ?? null,
      comments: raw.comments.map((c) => ({ id: c.id, body: c.body })),
    };
  }
}
