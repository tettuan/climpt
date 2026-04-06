/**
 * External State Verdict Adapter Tests
 *
 * Integration tests for the verdict propagation chain:
 *   AI structured output -> onBoundaryHook() -> getLastVerdict()
 *
 * Covers:
 * - Group 1: Verdict extraction from structured output
 * - Group 2: Structured output labels merging with config labels
 * - Group 3: Closure action routing
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  type ExternalStateAdapterConfig,
  ExternalStateVerdictAdapter,
} from "./external-state-adapter.ts";
import { IssueVerdictHandler } from "./issue.ts";
import { MockStateChecker } from "./external-state-checker.ts";

// =============================================================================
// Deno.Command stub infrastructure
// =============================================================================

const OriginalCommand = Deno.Command;

/** Captured arguments from each Deno.Command instantiation + output() call. */
interface CapturedCommand {
  program: string;
  args: string[];
}

let capturedCommands: CapturedCommand[] = [];

/**
 * Stub Deno.Command to capture all invocations without executing real commands.
 * Each call to `new Deno.Command(program, opts).output()` records the args
 * and resolves with a successful (empty) result.
 */
function stubDenoCommand(): void {
  capturedCommands = [];
  // @ts-expect-error: stubbing Deno.Command for testing
  Deno.Command = class FakeCommand {
    #program: string;
    #args: string[];
    constructor(
      program: string,
      opts: { args: string[]; stdout?: string; stderr?: string },
    ) {
      this.#program = program;
      this.#args = opts.args;
    }
    output() {
      capturedCommands.push({
        program: this.#program,
        args: [...this.#args],
      });
      return Promise.resolve({
        success: true,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };
}

function restoreDenoCommand(): void {
  Deno.Command = OriginalCommand;
}

// =============================================================================
// Test helpers
// =============================================================================

/**
 * Create a minimal IssueVerdictHandler backed by MockStateChecker.
 * The handler is only needed to satisfy the adapter constructor;
 * onBoundaryHook does not delegate to the handler.
 */
function createMockHandler(): IssueVerdictHandler {
  const checker = new MockStateChecker();
  checker.setIssueState(42, false);
  return new IssueVerdictHandler(
    { issueNumber: 42, repo: "owner/repo" },
    checker,
  );
}

// =============================================================================
// Group 1: Verdict extraction from structured output
// =============================================================================

Deno.test("ExternalStateVerdictAdapter - verdict extraction", async (t) => {
  await t.step(
    "onBoundaryHook extracts verdict from structured output",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: { defaultClosureAction: "label-only" },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            verdict: "approved",
            closure_action: "label-only",
          },
        });

        assertEquals(adapter.getLastVerdict(), "approved");
      } finally {
        restoreDenoCommand();
      }
    },
  );

  await t.step("onBoundaryHook ignores missing verdict", async () => {
    stubDenoCommand();
    try {
      const handler = createMockHandler();
      const config: ExternalStateAdapterConfig = {
        issueNumber: 42,
        repo: "owner/repo",
        github: { defaultClosureAction: "label-only" },
      };
      const adapter = new ExternalStateVerdictAdapter(handler, config);

      await adapter.onBoundaryHook({
        stepId: "closure.issue",
        stepKind: "closure",
        structuredOutput: { closure_action: "label-only" },
      });

      assertEquals(adapter.getLastVerdict(), undefined);
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("onBoundaryHook ignores non-string verdict", async () => {
    stubDenoCommand();
    try {
      const handler = createMockHandler();
      const config: ExternalStateAdapterConfig = {
        issueNumber: 42,
        repo: "owner/repo",
        github: { defaultClosureAction: "label-only" },
      };
      const adapter = new ExternalStateVerdictAdapter(handler, config);

      await adapter.onBoundaryHook({
        stepId: "closure.issue",
        stepKind: "closure",
        structuredOutput: {
          verdict: 123,
          closure_action: "label-only",
        },
      });

      assertEquals(adapter.getLastVerdict(), undefined);
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("onBoundaryHook ignores empty string verdict", async () => {
    stubDenoCommand();
    try {
      const handler = createMockHandler();
      const config: ExternalStateAdapterConfig = {
        issueNumber: 42,
        repo: "owner/repo",
        github: { defaultClosureAction: "label-only" },
      };
      const adapter = new ExternalStateVerdictAdapter(handler, config);

      await adapter.onBoundaryHook({
        stepId: "closure.issue",
        stepKind: "closure",
        structuredOutput: {
          verdict: "",
          closure_action: "label-only",
        },
      });

      assertEquals(adapter.getLastVerdict(), undefined);
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("getLastVerdict returns latest verdict", async () => {
    stubDenoCommand();
    try {
      const handler = createMockHandler();
      const config: ExternalStateAdapterConfig = {
        issueNumber: 42,
        repo: "owner/repo",
        github: { defaultClosureAction: "label-only" },
      };
      const adapter = new ExternalStateVerdictAdapter(handler, config);

      await adapter.onBoundaryHook({
        stepId: "closure.issue",
        stepKind: "closure",
        structuredOutput: {
          verdict: "approved",
          closure_action: "label-only",
        },
      });

      await adapter.onBoundaryHook({
        stepId: "closure.issue",
        stepKind: "closure",
        structuredOutput: {
          verdict: "rejected",
          closure_action: "label-only",
        },
      });

      assertEquals(adapter.getLastVerdict(), "rejected");
    } finally {
      restoreDenoCommand();
    }
  });
});

// =============================================================================
// Group 2: Structured output labels merging
// =============================================================================

Deno.test("ExternalStateVerdictAdapter - label merging", async (t) => {
  await t.step(
    "onBoundaryHook merges structured output labels with config",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: {
            labels: {
              completion: {
                add: ["done"],
                remove: ["in-progress"],
              },
            },
            defaultClosureAction: "label-only",
          },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            closure_action: "label-only",
            issue: {
              labels: {
                add: ["reviewed"],
                remove: ["needs-review"],
              },
            },
          },
        });

        // closure_action: "label-only" => updateLabels runs, closeIssue skipped
        assertEquals(capturedCommands.length, 1);

        const cmd = capturedCommands[0];
        assertEquals(cmd.program, "gh");

        // Verify both config AND structured output labels are present
        const addIdx = cmd.args.indexOf("--add-label");
        assertEquals(addIdx !== -1, true, "--add-label flag must be present");
        const addValue = cmd.args[addIdx + 1];
        // Merged from config ["done"] + SO ["reviewed"], deduplicated via Set
        assertStringIncludes(addValue, "done");
        assertStringIncludes(addValue, "reviewed");

        const removeIdx = cmd.args.indexOf("--remove-label");
        assertEquals(
          removeIdx !== -1,
          true,
          "--remove-label flag must be present",
        );
        const removeValue = cmd.args[removeIdx + 1];
        // Merged from config ["in-progress"] + SO ["needs-review"]
        assertStringIncludes(removeValue, "in-progress");
        assertStringIncludes(removeValue, "needs-review");

        // Verify repo flag
        const repoIdx = cmd.args.indexOf("--repo");
        assertEquals(repoIdx !== -1, true, "--repo flag must be present");
        assertEquals(cmd.args[repoIdx + 1], "owner/repo");
      } finally {
        restoreDenoCommand();
      }
    },
  );

  await t.step(
    "onBoundaryHook uses only config labels when structured output has no labels",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: {
            labels: {
              completion: {
                add: ["done"],
                remove: ["in-progress"],
              },
            },
            defaultClosureAction: "label-only",
          },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            closure_action: "label-only",
            // no issue.labels in structured output
          },
        });

        assertEquals(capturedCommands.length, 1);

        const cmd = capturedCommands[0];
        assertEquals(cmd.program, "gh");

        const addIdx = cmd.args.indexOf("--add-label");
        assertEquals(addIdx !== -1, true);
        assertEquals(cmd.args[addIdx + 1], "done");

        const removeIdx = cmd.args.indexOf("--remove-label");
        assertEquals(removeIdx !== -1, true);
        assertEquals(cmd.args[removeIdx + 1], "in-progress");
      } finally {
        restoreDenoCommand();
      }
    },
  );

  await t.step(
    "onBoundaryHook uses only structured output labels when config has no labels",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: {
            // no labels.completion in config
            defaultClosureAction: "label-only",
          },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            closure_action: "label-only",
            issue: {
              labels: {
                add: ["reviewed"],
                remove: ["needs-review"],
              },
            },
          },
        });

        assertEquals(capturedCommands.length, 1);

        const cmd = capturedCommands[0];
        assertEquals(cmd.program, "gh");

        const addIdx = cmd.args.indexOf("--add-label");
        assertEquals(addIdx !== -1, true);
        assertEquals(cmd.args[addIdx + 1], "reviewed");

        const removeIdx = cmd.args.indexOf("--remove-label");
        assertEquals(removeIdx !== -1, true);
        assertEquals(cmd.args[removeIdx + 1], "needs-review");
      } finally {
        restoreDenoCommand();
      }
    },
  );

  await t.step(
    "label deduplication: same label in config and SO appears once",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: {
            labels: {
              completion: {
                add: ["done"],
              },
            },
            defaultClosureAction: "label-only",
          },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            closure_action: "label-only",
            issue: {
              labels: {
                add: ["done", "reviewed"],
              },
            },
          },
        });

        assertEquals(capturedCommands.length, 1);

        const cmd = capturedCommands[0];
        assertEquals(cmd.program, "gh");

        const addIdx = cmd.args.indexOf("--add-label");
        assertEquals(addIdx !== -1, true, "--add-label flag must be present");
        const addValue = cmd.args[addIdx + 1];
        const addLabels = addValue.split(",");
        // "done" appears in both config and SO but should only appear once
        assertEquals(
          addLabels.filter((l: string) => l === "done").length,
          1,
          "done must appear exactly once (deduplicated)",
        );
        assertEquals(addLabels.includes("reviewed"), true);
        assertEquals(addLabels.length, 2, "should have exactly 2 labels");
      } finally {
        restoreDenoCommand();
      }
    },
  );
});

// =============================================================================
// Group 3: Closure action routing
// =============================================================================

Deno.test("ExternalStateVerdictAdapter - closure action routing", async (t) => {
  await t.step(
    "closure_action 'close' runs closeIssue only, skips labels",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: {
            labels: {
              completion: {
                add: ["done"],
                remove: ["in-progress"],
              },
            },
          },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            closure_action: "close",
          },
        });

        assertEquals(capturedCommands.length, 1, "exactly 1 command");
        const cmd = capturedCommands[0];
        assertEquals(cmd.program, "gh");
        assertEquals(
          cmd.args.slice(0, 3),
          ["issue", "close", "42"],
          "must be gh issue close 42",
        );
        // Must NOT contain "edit" (no label update)
        assertEquals(
          cmd.args.includes("edit"),
          false,
          "must not contain edit subcommand",
        );
      } finally {
        restoreDenoCommand();
      }
    },
  );

  await t.step(
    "closure_action 'label-and-close' runs both updateLabels and closeIssue",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: {
            labels: {
              completion: {
                add: ["done"],
                remove: ["in-progress"],
              },
            },
          },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            closure_action: "label-and-close",
          },
        });

        assertEquals(capturedCommands.length, 2, "exactly 2 commands");

        // First command: gh issue edit (labels)
        const editCmd = capturedCommands[0];
        assertEquals(editCmd.program, "gh");
        assertEquals(
          editCmd.args.slice(0, 3),
          ["issue", "edit", "42"],
          "first must be gh issue edit 42",
        );

        // Second command: gh issue close
        const closeCmd = capturedCommands[1];
        assertEquals(closeCmd.program, "gh");
        assertEquals(
          closeCmd.args.slice(0, 3),
          ["issue", "close", "42"],
          "second must be gh issue close 42",
        );
      } finally {
        restoreDenoCommand();
      }
    },
  );

  await t.step(
    "default closure action is 'close' when neither SO nor config specifies",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: {
            // no defaultClosureAction
          },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            // no closure_action
          },
        });

        assertEquals(capturedCommands.length, 1, "exactly 1 command");
        const cmd = capturedCommands[0];
        assertEquals(cmd.program, "gh");
        assertEquals(
          cmd.args.slice(0, 3),
          ["issue", "close", "42"],
          "default must be gh issue close 42",
        );
      } finally {
        restoreDenoCommand();
      }
    },
  );

  await t.step(
    "SO closure_action overrides config defaultClosureAction",
    async () => {
      stubDenoCommand();
      try {
        const handler = createMockHandler();
        const config: ExternalStateAdapterConfig = {
          issueNumber: 42,
          repo: "owner/repo",
          github: {
            labels: {
              completion: {
                add: ["done"],
              },
            },
            defaultClosureAction: "close",
          },
        };
        const adapter = new ExternalStateVerdictAdapter(handler, config);

        await adapter.onBoundaryHook({
          stepId: "closure.issue",
          stepKind: "closure",
          structuredOutput: {
            closure_action: "label-only",
          },
        });

        assertEquals(capturedCommands.length, 1, "exactly 1 command");
        const cmd = capturedCommands[0];
        assertEquals(cmd.program, "gh");
        assertEquals(
          cmd.args.slice(0, 3),
          ["issue", "edit", "42"],
          "SO label-only overrides config close, must be gh issue edit 42",
        );
        // Must NOT contain "close" subcommand
        assertEquals(
          cmd.args.includes("close"),
          false,
          "must not contain close subcommand",
        );
      } finally {
        restoreDenoCommand();
      }
    },
  );
});
