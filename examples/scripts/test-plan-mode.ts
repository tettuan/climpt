/**
 * Plan mode test -- verifies tool approval works via canUseTool callback.
 *
 * Tests:
 * 1. SDK query with permissionMode: "plan"
 * 2. canUseTool callback receives tool requests
 * 3. Approved tools execute, denied tools are blocked
 *
 * Usage:
 *   deno run --allow-all --config ../../deno.json test-plan-mode.ts [approve|deny]
 *
 * approve (default): canUseTool returns "allow" -> Write succeeds -> sentinel created
 * deny:              canUseTool returns "deny"  -> Write blocked  -> sentinel NOT created
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

// deno-lint-ignore no-console
const info = (msg: string) => console.error(`[INFO]  ${msg}`);
// deno-lint-ignore no-console
const ok = (msg: string) => console.error(`[OK]    ${msg}`);
// deno-lint-ignore no-console
const fail = (msg: string) => console.error(`[ERROR] ${msg}`);

const mode = Deno.args[0] ?? "approve";
const sentinel = "/private/tmp/claude/plan-mode-sentinel.txt";

info(`=== Plan Mode Test (${mode}) ===`);

// Clean sentinel
try {
  Deno.removeSync(sentinel);
} catch { /* ok */ }

const start = performance.now();
let messageCount = 0;
let canUseToolCalls = 0;
let success = false;

try {
  const iter = query({
    prompt: `Write the text 'PLAN_MODE_OK' to ${sentinel}`,
    options: {
      systemPrompt:
        "You are a test agent. Do exactly what is asked. Use the Write tool.",
      permissionMode: "plan",
      allowedTools: ["Write", "Read"],
      maxTurns: 3,
      canUseTool: (
        toolName: string,
        input: Record<string, unknown>,
      ) => {
        canUseToolCalls++;
        const elapsed = ((performance.now() - start) / 1000).toFixed(1);
        info(
          `[${elapsed}s] canUseTool #${canUseToolCalls}: ${toolName} -> ${mode}`,
        );

        if (mode === "deny") {
          return Promise.resolve({
            behavior: "deny" as const,
            message: `Denied by test: ${toolName}`,
          });
        }
        return Promise.resolve({
          behavior: "allow" as const,
          updatedInput: input,
        });
      },
    },
  });

  for await (const msg of iter) {
    messageCount++;
    const m = msg as Record<string, unknown>;
    const type = String(m.type ?? "unknown");
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    if (type === "result") {
      const isError = (m as Record<string, unknown>).is_error;
      const cost = (m as Record<string, unknown>).total_cost_usd;
      if (isError) {
        fail(`[${elapsed}s] result error: ${JSON.stringify(m).slice(0, 300)}`);
      } else {
        ok(`[${elapsed}s] result: cost=$${cost ?? "?"}`);
        success = true;
      }
    } else if (type === "system") {
      ok(`[${elapsed}s] session initialized`);
    } else if (type === "assistant") {
      ok(`[${elapsed}s] assistant turn`);
    } else {
      info(`[${elapsed}s] ${type}`);
    }
  }
} catch (e) {
  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  fail(`[${elapsed}s] ${e instanceof Error ? e.message : String(e)}`);
}

const total = ((performance.now() - start) / 1000).toFixed(1);
info(
  `--- ${messageCount} messages, ${canUseToolCalls} canUseTool calls, ${total}s ---`,
);

// Check sentinel
let sentinelExists = false;
try {
  Deno.readTextFileSync(sentinel);
  sentinelExists = true;
} catch { /* ok */ }

if (mode === "approve") {
  if (success && sentinelExists) {
    ok("PASS: plan mode approved -> Write executed -> sentinel created");
  } else {
    fail(
      `FAIL: success=${success}, sentinel=${
        sentinelExists ? "exists" : "missing"
      }`,
    );
    Deno.exit(1);
  }
} else {
  // deny mode
  if (success && !sentinelExists) {
    ok("PASS: plan mode denied -> Write blocked -> sentinel NOT created");
  } else if (sentinelExists) {
    fail("FAIL: sentinel was created despite deny");
    Deno.exit(1);
  } else {
    ok(`PASS: plan mode denied (success=${success}, sentinel absent)`);
  }
}
