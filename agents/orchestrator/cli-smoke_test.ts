import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

// Resolve to absolute path so tests work with any cwd
const TEST_DIR = fromFileUrl(new URL(".", import.meta.url));
const PROJECT_ROOT = join(TEST_DIR, "..", "..");
const RUN_WORKFLOW = join(PROJECT_ROOT, "agents/scripts/run-workflow.ts");

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
  assertStringIncludes(stdout, "--workflow");
  assertStringIncludes(stdout, "--label");
  assertStringIncludes(stdout, "--prioritize");
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

Deno.test("cli: --help shows --project option", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", RUN_WORKFLOW, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.success, true);
  assertStringIncludes(stdout, "--project");
});

Deno.test("cli: valid --project passes CLI parse and fails at workflow load", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-all",
        RUN_WORKFLOW,
        "--project",
        "tettuan/5",
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: tempDir,
    });
    const output = await cmd.output();

    assertEquals(output.success, false);
    const stderr = new TextDecoder().decode(output.stderr);
    // Should fail because workflow.json is missing, NOT because of --project parse
    assertEquals(
      stderr.includes("not found") || stderr.includes("Workflow config"),
      true,
      `Expected workflow-not-found error, got: ${stderr}`,
    );
    // Must NOT contain project parse error
    assertEquals(stderr.includes("Invalid --project"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cli: invalid --project (no slash) rejected at CLI parse", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-all",
        RUN_WORKFLOW,
        "--project",
        "invalid",
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: tempDir,
    });
    const output = await cmd.output();

    assertEquals(output.success, false);
    const stderr = new TextDecoder().decode(output.stderr);
    assertStringIncludes(stderr, "Invalid --project");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cli: invalid --project (non-numeric number) rejected at CLI parse", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-all",
        RUN_WORKFLOW,
        "--project",
        "tettuan/abc",
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: tempDir,
    });
    const output = await cmd.output();

    assertEquals(output.success, false);
    const stderr = new TextDecoder().decode(output.stderr);
    assertStringIncludes(stderr, "Invalid --project");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cli: invalid --project (empty number) rejected at CLI parse", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-all",
        RUN_WORKFLOW,
        "--project",
        "tettuan/",
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: tempDir,
    });
    const output = await cmd.output();

    assertEquals(output.success, false);
    const stderr = new TextDecoder().decode(output.stderr);
    assertStringIncludes(stderr, "Invalid --project");
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
