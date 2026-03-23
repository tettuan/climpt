/**
 * Tests for github-read-tool.ts
 *
 * Stubs Deno.Command to verify that createGitHubReadHandler dispatches
 * the correct gh subcommands and handles errors properly.
 */

import { assertEquals } from "@std/assert";
import { createGitHubReadHandler } from "./github-read-tool.ts";

// --- Deno.Command stub infrastructure ---

const OriginalCommand = Deno.Command;

let lastCommandArgs: {
  program: string;
  args: string[];
  cwd?: string;
} | null = null;

function stubDenoCommand(stdout: string, success = true, stderr = "") {
  lastCommandArgs = null;
  // @ts-expect-error: stubbing Deno.Command for testing
  Deno.Command = class FakeCommand {
    constructor(
      program: string,
      opts: { args: string[]; cwd?: string },
    ) {
      lastCommandArgs = { program, args: opts.args, cwd: opts.cwd };
    }
    output() {
      return Promise.resolve({
        success,
        stdout: new TextEncoder().encode(stdout),
        stderr: new TextEncoder().encode(stderr),
      });
    }
  };
}

function restoreDenoCommand() {
  Deno.Command = OriginalCommand;
}

// --- Tests ---

const TEST_CWD = "/test/workspace";

Deno.test("github-read-tool", async (t) => {
  // DC2 / DC7: All 6 operations — success path
  await t.step("issue_view builds correct gh args", async () => {
    stubDenoCommand('{"number":42,"title":"test"}');
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "issue_view", number: 42 });

      assertEquals(result.isError, undefined);
      assertEquals(result.content[0].type, "text");
      assertEquals(lastCommandArgs!.program, "gh");
      assertEquals(lastCommandArgs!.args[0], "issue");
      assertEquals(lastCommandArgs!.args[1], "view");
      assertEquals(lastCommandArgs!.args[2], "42");
      assertEquals(lastCommandArgs!.args[3], "--json");
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("issue_list builds correct gh args", async () => {
    stubDenoCommand('[{"number":1,"title":"a"}]');
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "issue_list" });

      assertEquals(result.isError, undefined);
      assertEquals(lastCommandArgs!.program, "gh");
      assertEquals(lastCommandArgs!.args[0], "issue");
      assertEquals(lastCommandArgs!.args[1], "list");
      assertEquals(lastCommandArgs!.args[2], "--json");
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("pr_view builds correct gh args", async () => {
    stubDenoCommand('{"number":10,"title":"feat"}');
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "pr_view", number: 10 });

      assertEquals(result.isError, undefined);
      assertEquals(lastCommandArgs!.program, "gh");
      assertEquals(lastCommandArgs!.args[0], "pr");
      assertEquals(lastCommandArgs!.args[1], "view");
      assertEquals(lastCommandArgs!.args[2], "10");
      assertEquals(lastCommandArgs!.args[3], "--json");
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("pr_list builds correct gh args", async () => {
    stubDenoCommand('[{"number":1}]');
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "pr_list" });

      assertEquals(result.isError, undefined);
      assertEquals(lastCommandArgs!.program, "gh");
      assertEquals(lastCommandArgs!.args[0], "pr");
      assertEquals(lastCommandArgs!.args[1], "list");
      assertEquals(lastCommandArgs!.args[2], "--json");
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("pr_diff builds correct gh args", async () => {
    stubDenoCommand("diff --git a/file.ts b/file.ts");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "pr_diff", number: 10 });

      assertEquals(result.isError, undefined);
      assertEquals(lastCommandArgs!.program, "gh");
      assertEquals(lastCommandArgs!.args, ["pr", "diff", "10"]);
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("pr_checks builds correct gh args", async () => {
    stubDenoCommand("check1\tpass\t1m");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "pr_checks", number: 10 });

      assertEquals(result.isError, undefined);
      assertEquals(lastCommandArgs!.program, "gh");
      assertEquals(lastCommandArgs!.args, ["pr", "checks", "10"]);
    } finally {
      restoreDenoCommand();
    }
  });

  // DC3: number required but missing
  await t.step("issue_view without number returns error", async () => {
    stubDenoCommand("");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "issue_view" });

      assertEquals(result.isError, true);
      assertEquals(
        result.content[0].text.includes("number is required"),
        true,
      );
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("pr_view without number returns error", async () => {
    stubDenoCommand("");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "pr_view" });

      assertEquals(result.isError, true);
      assertEquals(
        result.content[0].text.includes("number is required"),
        true,
      );
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("pr_diff without number returns error", async () => {
    stubDenoCommand("");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "pr_diff" });

      assertEquals(result.isError, true);
      assertEquals(
        result.content[0].text.includes("number is required"),
        true,
      );
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("pr_checks without number returns error", async () => {
    stubDenoCommand("");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "pr_checks" });

      assertEquals(result.isError, true);
      assertEquals(
        result.content[0].text.includes("number is required"),
        true,
      );
    } finally {
      restoreDenoCommand();
    }
  });

  // DC4: Unknown operation
  await t.step("unknown operation returns error", async () => {
    stubDenoCommand("");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "unknown_op" });

      assertEquals(result.isError, true);
      assertEquals(
        result.content[0].text.includes("unknown operation"),
        true,
      );
    } finally {
      restoreDenoCommand();
    }
  });

  // DC5: gh command failure
  await t.step("gh command failure propagates stderr", async () => {
    stubDenoCommand("", false, "not found");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      const result = await handler({ operation: "issue_list" });

      assertEquals(result.isError, true);
      assertEquals(result.content[0].text.includes("not found"), true);
    } finally {
      restoreDenoCommand();
    }
  });

  // DC6: Optional args for list operations
  await t.step("issue_list passes optional args", async () => {
    stubDenoCommand("[]");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      await handler({
        operation: "issue_list",
        state: "closed",
        label: "bug",
        limit: 5,
      });

      const args = lastCommandArgs!.args;
      // Verify optional flags are present in the args
      const stateIdx = args.indexOf("--state");
      assertEquals(stateIdx !== -1, true);
      assertEquals(args[stateIdx + 1], "closed");

      const labelIdx = args.indexOf("--label");
      assertEquals(labelIdx !== -1, true);
      assertEquals(args[labelIdx + 1], "bug");

      const limitIdx = args.indexOf("--limit");
      assertEquals(limitIdx !== -1, true);
      assertEquals(args[limitIdx + 1], "5");
    } finally {
      restoreDenoCommand();
    }
  });

  await t.step("pr_list passes optional args", async () => {
    stubDenoCommand("[]");
    try {
      const handler = createGitHubReadHandler(TEST_CWD);
      await handler({
        operation: "pr_list",
        state: "merged",
        limit: 10,
      });

      const args = lastCommandArgs!.args;
      const stateIdx = args.indexOf("--state");
      assertEquals(stateIdx !== -1, true);
      assertEquals(args[stateIdx + 1], "merged");

      const limitIdx = args.indexOf("--limit");
      assertEquals(limitIdx !== -1, true);
      assertEquals(args[limitIdx + 1], "10");
    } finally {
      restoreDenoCommand();
    }
  });

  // cwd passed through
  await t.step("cwd is passed to Deno.Command", async () => {
    stubDenoCommand("[]");
    try {
      const handler = createGitHubReadHandler("/test/workspace");
      await handler({ operation: "issue_list" });

      assertEquals(lastCommandArgs!.cwd, "/test/workspace");
    } finally {
      restoreDenoCommand();
    }
  });
});
