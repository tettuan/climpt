/**
 * Minimal SDK query test -- verifies OAuth authentication works.
 *
 * This test proves that ANTHROPIC_API_KEY is NOT required.
 * The Claude Agent SDK uses OAuth via the `claude` CLI.
 *
 * Usage:
 *   deno run --allow-all --config ../../deno.json test-sdk-query.ts
 *
 * Expected: 3 messages (system, assistant, result), exit 0
 * If OAuth is not configured: "Claude Code process exited with code 1"
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

// deno-lint-ignore no-console
const info = (msg: string) => console.error(`[INFO]  ${msg}`);
// deno-lint-ignore no-console
const ok = (msg: string) => console.error(`[OK]    ${msg}`);
// deno-lint-ignore no-console
const fail = (msg: string) => console.error(`[ERROR] ${msg}`);

info("=== SDK Query Test (OAuth) ===");
info(
  `ANTHROPIC_API_KEY: ${
    Deno.env.get("ANTHROPIC_API_KEY") ? "set" : "(not set)"
  }`,
);

const claudeBin = await (async () => {
  try {
    const cmd = new Deno.Command("which", {
      args: ["claude"],
      stdout: "piped",
    });
    const out = await cmd.output();
    return new TextDecoder().decode(out.stdout).trim() || "(not found)";
  } catch {
    return "(not found)";
  }
})();
info(`claude CLI: ${claudeBin}`);

const start = performance.now();
let messageCount = 0;
let success = false;

try {
  const iter = query({
    prompt: "Say exactly: SDK_QUERY_OK",
    options: {
      systemPrompt: "Respond with only the exact text requested.",
      allowedTools: [],
      maxTurns: 1,
    },
  });

  for await (const msg of iter) {
    messageCount++;
    const m = msg as Record<string, unknown>;
    const type = String(m.type ?? "unknown");
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    if (type === "system") {
      ok(`[${elapsed}s] session initialized`);
    } else if (type === "assistant") {
      const content = JSON.stringify(m).slice(0, 200);
      ok(`[${elapsed}s] assistant response: ${content}`);
    } else if (type === "result") {
      const isError = (m as Record<string, unknown>).is_error;
      const cost = (m as Record<string, unknown>).total_cost_usd;
      if (isError) {
        fail(
          `[${elapsed}s] result with error: ${JSON.stringify(m).slice(0, 300)}`,
        );
      } else {
        ok(`[${elapsed}s] result: cost=$${cost ?? "?"}`);
        success = true;
      }
    } else {
      info(`[${elapsed}s] ${type}: ${JSON.stringify(m).slice(0, 150)}`);
    }
  }
} catch (e) {
  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  fail(`[${elapsed}s] ${e instanceof Error ? e.message : String(e)}`);
}

const total = ((performance.now() - start) / 1000).toFixed(1);
info(`--- ${messageCount} messages in ${total}s ---`);

if (success) {
  ok("PASS: SDK query completed via OAuth");
} else {
  fail("FAIL: SDK query did not complete successfully");
  Deno.exit(1);
}
