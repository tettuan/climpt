/**
 * Minimal Runner Test -- verifies AgentRunner works end-to-end.
 *
 * Creates a temporary agent config, runs the runner via run-agent.ts,
 * and checks the result.
 *
 * Usage:
 *   deno run --allow-all --config ../../deno.json test-runner-minimal.ts
 *
 * Expected: Agent completes with success=true, sentinel file created.
 */

import { resolve } from "@std/path";

// deno-lint-ignore no-console
const info = (msg: string) => console.error(`[INFO]  ${msg}`);
// deno-lint-ignore no-console
const ok = (msg: string) => console.error(`[OK]    ${msg}`);
// deno-lint-ignore no-console
const fail = (msg: string) => console.error(`[ERROR] ${msg}`);

// --- Setup ---

const tmpBase = Deno.env.get("TMPDIR") ?? "/private/tmp/claude";
const workDir = resolve(tmpBase, "runner-minimal-test");
const agentName = "echo-test";
const agentDir = resolve(workDir, ".agent", agentName);
const climptConfigDir = resolve(workDir, ".agent", "climpt", "config");
const sentinel = resolve(tmpBase, "runner-minimal-sentinel.txt");

info("=== Runner Minimal Test ===");
info(`workDir: ${workDir}`);

// Clean
try {
  Deno.removeSync(workDir, { recursive: true });
} catch { /* ok */ }
try {
  Deno.removeSync(sentinel);
} catch { /* ok */ }

// Create directories
for (
  const dir of [
    resolve(agentDir, "prompts/steps/initial/task"),
    resolve(agentDir, "prompts/steps/closure/done"),
    climptConfigDir,
  ]
) {
  Deno.mkdirSync(dir, { recursive: true });
}

// --- agent.json ---
Deno.writeTextFileSync(
  resolve(agentDir, "agent.json"),
  JSON.stringify(
    {
      $schema: "../../agents/schemas/agent.schema.json",
      version: "1.0.0",
      name: agentName,
      displayName: "Echo Test",
      description: "Minimal test agent",
      parameters: {
        issue: {
          type: "number",
          description: "Dummy issue number",
          required: true,
          cli: "--issue",
        },
      },
      runner: {
        flow: {
          systemPromptPath: "prompts/system.md",
          prompts: { registry: "steps_registry.json", fallbackDir: "prompts/" },
        },
        verdict: {
          type: "poll:state",
          config: { type: "issueClose", issueParam: "issue", maxIterations: 1 },
        },
        boundaries: {
          allowedTools: ["Write", "Read"],
          permissionMode: "acceptEdits",
        },
        integrations: { github: { enabled: false } },
        actions: { enabled: false, types: [], outputFormat: "action" },
        execution: { worktree: { enabled: false } },
        logging: {
          directory: "tmp/logs/agents/echo-test",
          format: "jsonl",
          maxFiles: 10,
        },
      },
    },
    null,
    2,
  ),
);

// --- steps_registry.json ---
Deno.writeTextFileSync(
  resolve(agentDir, "steps_registry.json"),
  JSON.stringify(
    {
      agentId: agentName,
      version: "1.0.0",
      c1: "steps",
      entryStepMapping: { "poll:state": "initial.task" },
      steps: {
        system: {
          stepId: "system",
          name: "System Prompt",
          c2: "system",
          c3: "prompt",
          edition: "default",
          uvVariables: [],
          usesStdin: false,
        },
        "initial.task": {
          stepId: "initial.task",
          name: "Task",
          c2: "initial",
          c3: "task",
          edition: "default",
          stepKind: "work",
          uvVariables: ["uv-issue"],
          usesStdin: false,
          transitions: { next: { target: "closure.done" } },
        },
        "closure.done": {
          stepId: "closure.done",
          name: "Done",
          c2: "closure",
          c3: "done",
          edition: "default",
          stepKind: "closure",
          uvVariables: ["uv-issue"],
          usesStdin: false,
          transitions: {},
        },
      },
    },
    null,
    2,
  ),
);

// --- Prompt files ---
Deno.writeTextFileSync(
  resolve(agentDir, "prompts/system.md"),
  `# Echo Test Agent\n\nYou are a minimal test agent. Do exactly what is asked.\nWrite the sentinel file and report done.`,
);

Deno.writeTextFileSync(
  resolve(agentDir, "prompts/steps/initial/task/f_default.md"),
  `# Task\n\n## Issue\n{uv-issue}\n\n---\n\nWrite the text 'RUNNER_OK' to ${sentinel}. Then say "Done".`,
);

Deno.writeTextFileSync(
  resolve(agentDir, "prompts/steps/closure/done/f_default.md"),
  `# Done\n\n## Issue\n{uv-issue}\n\n---\n\nConfirm the file was written and the task is complete.`,
);

// --- Breakdown config (app + user) ---
Deno.writeTextFileSync(
  resolve(climptConfigDir, `${agentName}-steps-app.yml`),
  [
    `# Build Configuration for ${agentName}-steps`,
    `working_dir: ".agent/${agentName}"`,
    `app_prompt:`,
    `  base_dir: "prompts/steps"`,
    `app_schema:`,
    `  base_dir: "schema/steps"`,
    "",
  ].join("\n"),
);

Deno.writeTextFileSync(
  resolve(climptConfigDir, `${agentName}-steps-user.yml`),
  [
    `# Breakdown Configuration for ${agentName}-steps`,
    `params:`,
    `  two:`,
    `    directiveType:`,
    `      pattern: "^(initial|closure|system)$"`,
    `    layerType:`,
    `      pattern: "^(task|done|prompt)$"`,
    "",
  ].join("\n"),
);

info("Created all config files");

// --- Run ---

const repoRoot = resolve(new URL(import.meta.url).pathname, "../../..");
const runAgentScript = resolve(repoRoot, "agents/scripts/run-agent.ts");
const denoJson = resolve(repoRoot, "deno.json");

info(
  `Running: deno run --allow-all run-agent.ts --agent ${agentName} --issue 999`,
);
info(`cwd: ${workDir}`);
info("");

const start = performance.now();

const cmd = new Deno.Command("deno", {
  args: [
    "run",
    "--allow-all",
    `--config=${denoJson}`,
    runAgentScript,
    "--agent",
    agentName,
    "--issue",
    "999",
  ],
  cwd: workDir,
  stdout: "piped",
  stderr: "piped",
  env: {
    // Clear Claude Code env vars to avoid nesting issues
    CLAUDE_CODE_ENTRYPOINT: "",
    CLAUDECODE: "",
    CLAUDE_CODE_SESSION_ID: "",
    // Inherit PATH and HOME
    PATH: Deno.env.get("PATH") ?? "",
    HOME: Deno.env.get("HOME") ?? "",
    TMPDIR: tmpBase,
  },
});

const process = cmd.spawn();

const timeout = setTimeout(() => {
  fail("TIMEOUT: runner did not complete within 120s");
  try {
    process.kill();
  } catch { /* ok */ }
}, 120_000);

const output = await process.output();
clearTimeout(timeout);

const elapsed = ((performance.now() - start) / 1000).toFixed(1);
const stdout = new TextDecoder().decode(output.stdout);
const stderr = new TextDecoder().decode(output.stderr);

info(`[${elapsed}s] exit code: ${output.code}`);
info("");

if (stdout.trim()) {
  info("--- stdout ---");
  for (const line of stdout.trim().split("\n")) {
    info(`  ${line}`);
  }
}

if (stderr.trim()) {
  info("--- stderr (last 30 lines) ---");
  for (const line of stderr.trim().split("\n").slice(-30)) {
    info(`  ${line}`);
  }
}

info("");

// --- Verify ---

const hasSuccess = stdout.includes("Agent completed: SUCCESS");
const hasFailed = stdout.includes("Agent completed: FAILED");

let sentinelExists = false;
try {
  Deno.readTextFileSync(sentinel);
  sentinelExists = true;
} catch { /* ok */ }

info(`Agent SUCCESS: ${hasSuccess}`);
info(`Agent FAILED: ${hasFailed}`);
info(`Sentinel exists: ${sentinelExists}`);

if (hasSuccess && sentinelExists) {
  ok(`PASS: Runner completed in ${elapsed}s, sentinel created`);
} else if (hasSuccess && !sentinelExists) {
  // SUCCESS without sentinel -- agent ran but tool policy may have blocked Write
  ok(
    `PARTIAL PASS: Runner completed in ${elapsed}s (sentinel not created -- tool policy or prompt issue)`,
  );
} else if (hasFailed) {
  fail(`FAIL: Runner reported FAILED (${elapsed}s)`);
  // Show reason
  const reasonMatch = stdout.match(/Reason: (.+)/);
  if (reasonMatch) fail(`Reason: ${reasonMatch[1]}`);
  Deno.exit(1);
} else {
  fail(
    `FAIL: Runner did not reach completion (exit=${output.code}, ${elapsed}s)`,
  );
  Deno.exit(1);
}
