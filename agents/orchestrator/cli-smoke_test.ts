import { assertEquals } from "@std/assert";

const RUN_WORKFLOW = "agents/scripts/run-workflow.ts";

Deno.test("cli: --help shows usage and --workflow option", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", RUN_WORKFLOW, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.success, true);
  // Verify key options are documented
  assertEquals(stdout.includes("--workflow"), true);
  assertEquals(stdout.includes("--label"), true);
  assertEquals(stdout.includes("--prioritize"), true);
});

Deno.test("cli: no args runs without error (batch mode, no --issue required)", async () => {
  // Without a workflow file, it should fail with a workflow-not-found error,
  // not a missing-argument error.
  const tempDir = await Deno.makeTempDir();
  try {
    const cmd = new Deno.Command("deno", {
      args: ["run", "--allow-all", RUN_WORKFLOW],
      stdout: "piped",
      stderr: "piped",
      cwd: tempDir,
    });
    const output = await cmd.output();

    assertEquals(output.success, false);
    const stderr = new TextDecoder().decode(output.stderr);
    // Should fail because workflow.json is missing, not because of missing args
    assertEquals(
      stderr.includes("not found") || stderr.includes("Workflow config"),
      true,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cli: invalid --workflow path shows descriptive error", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-all",
        RUN_WORKFLOW,
        "--workflow",
        ".agent/nonexistent.json",
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: tempDir,
    });
    const output = await cmd.output();

    assertEquals(output.success, false);
    const stderr = new TextDecoder().decode(output.stderr);
    // loadWorkflow throws "Workflow config not found: <path>"
    assertEquals(
      stderr.includes("not found") || stderr.includes("Workflow config"),
      true,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
