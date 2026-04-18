/**
 * GitHub Client - Abstract GitHub operations for testability
 *
 * Provides an interface for label management, issue listing,
 * issue detail retrieval, and comments, with a concrete
 * implementation using the `gh` CLI.
 */

import type { IssueCriteria } from "./workflow-types.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";

export type { IssueCriteria };

/** GitHub Project v2 metadata. */
export interface Project {
  id: string;
  number: number;
  owner: string;
  title: string;
  readme: string;
  shortDescription: string | null;
  closed: boolean;
}

/** An issue item within a Project v2. */
export interface ProjectItem {
  id: string;
  issueNumber: number;
  fieldValues: Record<string, unknown>;
}

/** A field definition within a Project v2. */
export interface ProjectField {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "single_select" | "iteration";
  options?: { id: string; name: string }[];
}

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

/** Detailed label record returned by listLabelsDetailed. */
export interface LabelDetail {
  name: string;
  /** 6-char hex color without leading '#' */
  color: string;
  description: string;
}

/** Abstract interface for GitHub issue operations. */
export interface GitHubClient {
  getIssueLabels(subjectId: string | number): Promise<string[]>;
  updateIssueLabels(
    subjectId: string | number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void>;
  addIssueComment(subjectId: string | number, comment: string): Promise<void>;
  createIssue(title: string, labels: string[], body: string): Promise<number>;
  closeIssue(subjectId: string | number): Promise<void>;
  reopenIssue(subjectId: string | number): Promise<void>;
  listIssues(criteria: IssueCriteria): Promise<IssueListItem[]>;
  getIssueDetail(subjectId: string | number): Promise<IssueDetail>;
  getRecentComments(
    subjectId: string | number,
    limit: number,
  ): Promise<{ body: string; createdAt: string }[]>;
  listLabels(): Promise<string[]>;

  /**
   * Label lifecycle operations used by the pre-dispatch label-sync
   * preflight. Implementations must be idempotent at the transport
   * layer: createLabel on an existing name, or updateLabel to the
   * current state, should raise a distinguishable error rather than
   * silently mutating unrelated labels. Sync callers wrap these with
   * try/catch and emit per-label status records.
   */
  listLabelsDetailed(): Promise<LabelDetail[]>;
  createLabel(
    name: string,
    color: string,
    description: string,
  ): Promise<void>;
  updateLabel(
    name: string,
    color: string,
    description: string,
  ): Promise<void>;

  /**
   * Project v2 operations — additive extensions for v1.14.x project
   * orchestration. See `agents/docs/design/13_project_orchestration.md` §2.2.
   */
  addIssueToProject(
    project: ProjectRef,
    issueNumber: number,
  ): Promise<string>;
  updateProjectItemField(
    project: ProjectRef,
    itemId: string,
    fieldId: string,
    value: ProjectFieldValue,
  ): Promise<void>;
  closeProject(project: ProjectRef): Promise<void>;

  /**
   * Resolve an issue number to its project item ID within a project.
   * Returns null if the issue is not a member of the project.
   * Required for Status field updates via updateProjectItemField.
   */
  getProjectItemIdForIssue(
    project: ProjectRef,
    issueNumber: number,
  ): Promise<string | null>;

  /**
   * List all issue items in a project.
   * Returns issue numbers and their project item IDs.
   * Used by IssueSyncer for per-project batch filtering.
   */
  listProjectItems(
    project: ProjectRef,
  ): Promise<{ id: string; issueNumber: number }[]>;

  /**
   * List the projects (v2) that an issue belongs to.
   * Returns an array of ProjectRef-compatible objects (owner + number).
   * Used by the post-close completion check to find which projects
   * a closed issue affects.
   */
  getIssueProjects(
    issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>>;

  /**
   * Create a new option for a single-select project field.
   * Used to bootstrap Status options (e.g. "Blocked") that do not
   * yet exist in the project field definition.
   */
  createProjectFieldOption(
    project: ProjectRef,
    fieldId: string,
    name: string,
    color?: string,
  ): Promise<{ id: string; name: string }>;

  /**
   * List all projects (v2) for a given owner.
   * Returns project metadata including readme and closed state.
   */
  listUserProjects(owner: string): Promise<Project[]>;

  /**
   * Get full project metadata by reference.
   * Returns a single Project with id, title, readme, etc.
   */
  getProject(project: ProjectRef): Promise<Project>;

  /**
   * List field definitions for a project.
   * Returns field metadata including options for single_select fields.
   */
  getProjectFields(project: ProjectRef): Promise<ProjectField[]>;

  /**
   * Remove an item from a project by its project item ID.
   * The item is deleted from the project but the underlying issue remains.
   */
  removeProjectItem(project: ProjectRef, itemId: string): Promise<void>;
}

/** Concrete implementation using `gh` CLI via Deno.Command. */
export class GhCliClient implements GitHubClient {
  #cwd: string;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  async getIssueLabels(subjectId: string | number): Promise<string[]> {
    const cmd = new Deno.Command("gh", {
      args: [
        "issue",
        "view",
        String(subjectId),
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
        `Failed to get labels for subject #${subjectId}: ${stderr}`,
      );
    }

    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];
    return stdout.split("\n").filter((l) => l.length > 0);
  }

  async updateIssueLabels(
    subjectId: string | number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    const args = ["issue", "edit", String(subjectId)];

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
        `Failed to update labels for subject #${subjectId}: ${stderr}`,
      );
    }
  }

  async addIssueComment(
    subjectId: string | number,
    comment: string,
  ): Promise<void> {
    const cmd = new Deno.Command("gh", {
      args: [
        "issue",
        "comment",
        String(subjectId),
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
        `Failed to add comment to subject #${subjectId}: ${stderr}`,
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

  async closeIssue(subjectId: string | number): Promise<void> {
    const cmd = new Deno.Command("gh", {
      args: ["issue", "close", String(subjectId)],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to close subject #${subjectId}: ${stderr}`,
      );
    }
  }

  async reopenIssue(subjectId: string | number): Promise<void> {
    const cmd = new Deno.Command("gh", {
      args: ["issue", "reopen", String(subjectId)],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to reopen subject #${subjectId}: ${stderr}`,
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

  async getIssueDetail(subjectId: string | number): Promise<IssueDetail> {
    const cmd = new Deno.Command("gh", {
      args: [
        "issue",
        "view",
        String(subjectId),
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
        `Failed to get detail for subject #${subjectId}: ${stderr}`,
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

  async getRecentComments(
    subjectId: string | number,
    limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    if (limit <= 0) return [];

    const cmd = new Deno.Command("gh", {
      args: [
        "issue",
        "view",
        String(subjectId),
        "--json",
        "comments",
        "--jq",
        `.comments | sort_by(.createdAt) | reverse | .[0:${limit}] | map({body, createdAt})`,
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to get recent comments for subject #${subjectId}: ${stderr}`,
      );
    }

    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];

    return JSON.parse(stdout) as { body: string; createdAt: string }[];
  }

  async listLabels(): Promise<string[]> {
    const cmd = new Deno.Command("gh", {
      args: ["label", "list", "--json", "name", "--limit", "1000"],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Failed to list labels: ${stderr}`);
    }

    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];

    const raw = JSON.parse(stdout) as { name: string }[];
    return raw.map((l) => l.name);
  }

  async listLabelsDetailed(): Promise<LabelDetail[]> {
    const cmd = new Deno.Command("gh", {
      args: [
        "label",
        "list",
        "--json",
        "name,color,description",
        "--limit",
        "1000",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Failed to list labels: ${stderr}`);
    }

    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];

    const raw = JSON.parse(stdout) as {
      name: string;
      color: string;
      description?: string;
    }[];
    return raw.map((l) => ({
      name: l.name,
      // gh returns color without leading '#'; normalize for safety.
      color: (l.color ?? "").replace(/^#/, "").toLowerCase(),
      description: l.description ?? "",
    }));
  }

  async createLabel(
    name: string,
    color: string,
    description: string,
  ): Promise<void> {
    const cmd = new Deno.Command("gh", {
      args: [
        "label",
        "create",
        name,
        "--color",
        color,
        "--description",
        description,
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Failed to create label "${name}": ${stderr}`);
    }
  }

  async updateLabel(
    name: string,
    color: string,
    description: string,
  ): Promise<void> {
    const cmd = new Deno.Command("gh", {
      args: [
        "label",
        "edit",
        name,
        "--color",
        color,
        "--description",
        description,
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Failed to update label "${name}": ${stderr}`);
    }
  }

  /** Resolve a ProjectRef to owner and number for gh CLI commands. */
  #resolveProjectRef(
    ref: ProjectRef,
  ): { owner: string; number: number } {
    if ("owner" in ref && "number" in ref) {
      return { owner: ref.owner, number: ref.number };
    }
    // Node ID refs require GraphQL to resolve owner/number; for now
    // only owner+number refs are supported by the CLI client.
    throw new Error(
      `GhCliClient does not support ProjectRef by id — use {owner, number}`,
    );
  }

  async addIssueToProject(
    project: ProjectRef,
    issueNumber: number,
  ): Promise<string> {
    const { owner, number: projectNumber } = this.#resolveProjectRef(project);
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "item-add",
        String(projectNumber),
        "--owner",
        owner,
        "--url",
        `https://github.com/${owner}/${this.#repoName()}/issues/${issueNumber}`,
        "--format",
        "json",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to add issue #${issueNumber} to project ${owner}/${projectNumber}: ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    try {
      const data = JSON.parse(stdout) as { id: string };
      return data.id;
    } catch {
      // Fallback: return raw output when JSON parsing fails
      return stdout;
    }
  }

  async updateProjectItemField(
    project: ProjectRef,
    itemId: string,
    fieldId: string,
    value: ProjectFieldValue,
  ): Promise<void> {
    const { owner, number: projectNumber } = this.#resolveProjectRef(project);
    const args = [
      "project",
      "item-edit",
      "--id",
      itemId,
      "--project-id",
      String(projectNumber),
      "--field-id",
      fieldId,
    ];
    // Value serialization depends on type
    if (typeof value === "string") {
      args.push("--text", value);
    } else if (typeof value === "number") {
      args.push("--number", String(value));
    } else if ("optionId" in value) {
      args.push("--single-select-option-id", value.optionId);
    } else if ("date" in value) {
      args.push("--date", value.date);
    }
    // gh project item-edit requires --owner
    args.push("--owner", owner);

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
        `Failed to update project item field: ${stderr}`,
      );
    }
  }

  async closeProject(project: ProjectRef): Promise<void> {
    const { owner, number: projectNumber } = this.#resolveProjectRef(project);
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "close",
        String(projectNumber),
        "--owner",
        owner,
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to close project ${owner}/${projectNumber}: ${stderr}`,
      );
    }
  }

  async getProjectItemIdForIssue(
    project: ProjectRef,
    issueNumber: number,
  ): Promise<string | null> {
    const { owner, number: projectNumber } = this.#resolveProjectRef(project);
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "item-list",
        String(projectNumber),
        "--owner",
        owner,
        "--format",
        "json",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to list project items for ${owner}/${projectNumber}: ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const data = JSON.parse(stdout) as {
      items: {
        id: string;
        content: { number: number; type: string };
      }[];
    };
    const match = data.items.find(
      (item) =>
        item.content?.type === "Issue" &&
        item.content?.number === issueNumber,
    );
    return match?.id ?? null;
  }

  async listProjectItems(
    project: ProjectRef,
  ): Promise<{ id: string; issueNumber: number }[]> {
    const { owner, number: projectNumber } = this.#resolveProjectRef(project);
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "item-list",
        String(projectNumber),
        "--owner",
        owner,
        "--format",
        "json",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to list project items for ${owner}/${projectNumber}: ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const data = JSON.parse(stdout) as {
      items: {
        id: string;
        content: { number: number; type: string };
      }[];
    };
    return data.items
      .filter((item) => item.content?.type === "Issue")
      .map((item) => ({
        id: item.id,
        issueNumber: item.content.number,
      }));
  }

  async getIssueProjects(
    issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>> {
    // Use gh issue view with GraphQL-backed projectsV2 field.
    const cmd = new Deno.Command("gh", {
      args: [
        "issue",
        "view",
        String(issueNumber),
        "--json",
        "projectItems",
        "--jq",
        ".projectItems[].project | {owner: .owner.login, number: .number}",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to get projects for issue #${issueNumber}: ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];
    // Each line is a JSON object; parse each one.
    const results: Array<{ owner: string; number: number }> = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      results.push(JSON.parse(trimmed) as { owner: string; number: number });
    }
    return results;
  }

  async createProjectFieldOption(
    project: ProjectRef,
    fieldId: string,
    name: string,
    color?: string,
  ): Promise<{ id: string; name: string }> {
    // GraphQL mutation required — gh CLI does not expose field option creation.
    // Resolve project to node ID via gh project view if owner+number form.
    const projectId = await this.#resolveProjectNodeId(project);
    const ghColor = color?.toUpperCase() ?? "GRAY";
    const query = `
      mutation($projectId: ID!, $fieldId: ID!, $name: String!, $color: ProjectV2SingleSelectFieldOptionColor!) {
        createProjectV2FieldOption(input: {
          projectId: $projectId
          fieldId: $fieldId
          name: $name
          color: $color
        }) {
          projectV2SingleSelectFieldOption {
            id
            name
          }
        }
      }
    `;
    const cmd = new Deno.Command("gh", {
      args: [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-f",
        `projectId=${projectId}`,
        "-f",
        `fieldId=${fieldId}`,
        "-f",
        `name=${name}`,
        "-f",
        `color=${ghColor}`,
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to create project field option "${name}": ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const data = JSON.parse(stdout) as {
      data: {
        createProjectV2FieldOption: {
          projectV2SingleSelectFieldOption: { id: string; name: string };
        };
      };
    };
    return data.data.createProjectV2FieldOption
      .projectV2SingleSelectFieldOption;
  }

  async listUserProjects(owner: string): Promise<Project[]> {
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "list",
        "--owner",
        owner,
        "--format",
        "json",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to list projects for ${owner}: ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];
    const data = JSON.parse(stdout) as {
      projects: {
        id: string;
        number: number;
        title: string;
        shortDescription: string | null;
        readme: string;
        closed: boolean;
      }[];
    };
    return (data.projects ?? []).map((p) => ({
      id: p.id,
      number: p.number,
      owner,
      title: p.title,
      readme: p.readme ?? "",
      shortDescription: p.shortDescription ?? null,
      closed: p.closed ?? false,
    }));
  }

  async getProject(project: ProjectRef): Promise<Project> {
    const { owner, number: projectNumber } = this.#resolveProjectRef(project);
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "view",
        String(projectNumber),
        "--owner",
        owner,
        "--format",
        "json",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to get project ${owner}/${projectNumber}: ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const data = JSON.parse(stdout) as {
      id: string;
      number: number;
      title: string;
      shortDescription: string | null;
      readme: string;
      closed: boolean;
    };
    return {
      id: data.id,
      number: data.number,
      owner,
      title: data.title,
      readme: data.readme ?? "",
      shortDescription: data.shortDescription ?? null,
      closed: data.closed ?? false,
    };
  }

  async getProjectFields(project: ProjectRef): Promise<ProjectField[]> {
    const { owner, number: projectNumber } = this.#resolveProjectRef(project);
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "field-list",
        String(projectNumber),
        "--owner",
        owner,
        "--format",
        "json",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to list fields for project ${owner}/${projectNumber}: ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    if (stdout === "") return [];
    const data = JSON.parse(stdout) as {
      fields: {
        id: string;
        name: string;
        type: string;
        options?: { id: string; name: string }[];
      }[];
    };
    return (data.fields ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type as ProjectField["type"],
      ...(f.options ? { options: f.options } : {}),
    }));
  }

  async removeProjectItem(
    project: ProjectRef,
    itemId: string,
  ): Promise<void> {
    const { owner, number: projectNumber } = this.#resolveProjectRef(project);
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "item-delete",
        String(projectNumber),
        "--owner",
        owner,
        "--id",
        itemId,
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to remove item ${itemId} from project ${owner}/${projectNumber}: ${stderr}`,
      );
    }
  }

  /**
   * Resolve a ProjectRef to a GraphQL node ID.
   * owner+number form requires a lookup via `gh project view`.
   */
  async #resolveProjectNodeId(ref: ProjectRef): Promise<string> {
    if ("id" in ref) return ref.id;
    const { owner, number: projectNumber } = ref;
    const cmd = new Deno.Command("gh", {
      args: [
        "project",
        "view",
        String(projectNumber),
        "--owner",
        owner,
        "--format",
        "json",
      ],
      cwd: this.#cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(
        `Failed to resolve project node ID for ${owner}/${projectNumber}: ${stderr}`,
      );
    }
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const data = JSON.parse(stdout) as { id: string };
    return data.id;
  }

  /** Extract repo name from cwd for URL construction. */
  #repoName(): string {
    // Best-effort: use the last path component of cwd
    const parts = this.#cwd.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "unknown";
  }
}
