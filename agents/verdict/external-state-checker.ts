/**
 * External State Checker - Separation of external state retrieval
 *
 * Responsibility: Retrieve external state (e.g., GitHub Issue status)
 * Side Effect: External command execution
 *
 * By separating from CompletionHandler, judgment logic remains side-effect free.
 */

/**
 * Issue state from external source.
 */
export interface IssueState {
  /** Issue number */
  number: number;
  /** Whether the issue is closed */
  closed: boolean;
  /** Issue title (optional) */
  title?: string;
  /** Issue state string (e.g., "OPEN", "CLOSED") */
  state?: string;
  /** Issue labels */
  labels?: string[];
  /** Timestamp of last check */
  lastChecked: Date;
}

/**
 * Interface for external state checkers.
 *
 * Implementations perform external calls (side effects).
 * Used by completion handlers to refresh cached state.
 */
export interface ExternalStateChecker {
  /**
   * Check the state of a GitHub issue.
   *
   * @param issueNumber - Issue number to check
   * @param repo - Optional repository in "owner/repo" format
   * @returns Issue state
   */
  checkIssueState(issueNumber: number, repo?: string): Promise<IssueState>;
}

/**
 * GitHub CLI based state checker.
 *
 * Uses `gh` command to retrieve issue state.
 * Returns unknown state on error (non-throwing).
 */
export class GitHubStateChecker implements ExternalStateChecker {
  constructor(
    private readonly defaultRepo?: string,
  ) {}

  async checkIssueState(
    issueNumber: number,
    repo?: string,
  ): Promise<IssueState> {
    const targetRepo = repo ?? this.defaultRepo;

    try {
      const args = [
        "issue",
        "view",
        String(issueNumber),
        "--json",
        "number,state,title,labels",
      ];
      if (targetRepo) {
        args.push("--repo", targetRepo);
      }

      const command = new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
      });
      const output = await command.output();

      if (!output.success) {
        const stderr = new TextDecoder().decode(output.stderr);
        throw new Error(`gh command failed: ${stderr}`);
      }

      const json = JSON.parse(new TextDecoder().decode(output.stdout));

      return {
        number: json.number,
        closed: json.state === "CLOSED",
        title: json.title,
        state: json.state,
        labels: json.labels?.map((l: { name: string }) => l.name),
        lastChecked: new Date(),
      };
    } catch (_error) {
      // Return unknown state on error
      return {
        number: issueNumber,
        closed: false,
        lastChecked: new Date(),
      };
    }
  }
}

/**
 * Mock state checker for testing.
 *
 * Allows setting issue states programmatically for unit tests.
 */
export class MockStateChecker implements ExternalStateChecker {
  private states: Map<number, IssueState> = new Map();

  /**
   * Set the state of an issue (for testing).
   *
   * @param issueNumber - Issue number
   * @param closed - Whether the issue is closed
   */
  setIssueState(issueNumber: number, closed: boolean): void {
    this.states.set(issueNumber, {
      number: issueNumber,
      closed,
      lastChecked: new Date(),
    });
  }

  /**
   * Set detailed state of an issue (for testing).
   *
   * @param state - Full issue state
   */
  setIssueStateDetailed(state: IssueState): void {
    this.states.set(state.number, state);
  }

  checkIssueState(issueNumber: number): Promise<IssueState> {
    return Promise.resolve(
      this.states.get(issueNumber) ?? {
        number: issueNumber,
        closed: false,
        lastChecked: new Date(),
      },
    );
  }

  /**
   * Clear all stored states.
   */
  clear(): void {
    this.states.clear();
  }
}
