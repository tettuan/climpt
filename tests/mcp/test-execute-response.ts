#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run

/**
 * Test MCP execute tool response format
 * Verifies that the response follows MCP specification without exposing internal details
 */

const cmd = new Deno.Command("deno", {
  args: [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-net",
    "--allow-env",
    "--allow-run",
    "./src/mcp/index.ts",
  ],
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
});

console.log("🔧 Testing MCP execute tool response format...");

const process = cmd.spawn();
const writer = process.stdin.getWriter();

// Initialize
const initMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "execute-test-client", version: "1.0.0" },
  },
}) + "\n";

await writer.write(new TextEncoder().encode(initMessage));

// Execute tool call
const executeMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "execute",
    arguments: {
      agent: "climpt",
      c1: "meta",
      c2: "describe",
      c3: "version",
      options: [],
    },
  },
}) + "\n";

const reader = process.stdout.getReader();
const errorReader = process.stderr.getReader();

// Read stderr
const readStderr = async () => {
  try {
    while (true) {
      const { value, done } = await errorReader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      console.log("🐛 STDERR:", text.trim());
    }
  } catch (e) {
    console.log("Error reading stderr:", e);
  }
};

readStderr();

let buffer = "";
let initReceived = false;

setTimeout(async () => {
  console.log("⏱️ Timeout - closing connection");
  await writer.close();
  process.kill();
  Deno.exit(1);
}, 15000);

while (true) {
  const { value, done } = await reader.read();
  if (done) break;

  buffer += new TextDecoder().decode(value);
  const lines = buffer.split("\n");
  buffer = lines[lines.length - 1];

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line) {
      try {
        const message = JSON.parse(line);

        if (message.result && message.id === 1 && !initReceived) {
          console.log("✅ Server initialized! Calling execute tool...");
          initReceived = true;
          await writer.write(new TextEncoder().encode(executeMessage));
        }

        if (message.result && message.id === 2) {
          console.log("🎉 Execute tool call completed!");
          console.log("\n📋 Response structure:");
          console.log(JSON.stringify(message.result, null, 2));

          // Validate response format
          const result = message.result;
          if (!result.content || !Array.isArray(result.content)) {
            console.log("❌ FAILED: Response missing 'content' array");
            await writer.close();
            process.kill();
            Deno.exit(1);
          }

          const textContent = result.content[0];
          if (!textContent || textContent.type !== "text") {
            console.log("❌ FAILED: First content item is not type 'text'");
            await writer.close();
            process.kill();
            Deno.exit(1);
          }

          const text = textContent.text;

          // Check if response exposes internal implementation details (should NOT)
          const hasInternalDetails = text.includes('"success"') ||
            text.includes('"exitCode"') ||
            text.includes('"command"') ||
            text.includes('"stdout"') ||
            text.includes('"stderr"');

          if (hasInternalDetails) {
            console.log(
              "❌ FAILED: Response exposes internal implementation details",
            );
            console.log("📄 Response content (first 500 chars):");
            console.log(text.substring(0, 500));
            await writer.close();
            process.kill();
            Deno.exit(1);
          }

          console.log("✅ SUCCESS: Response follows MCP specification");
          console.log("✅ No internal details exposed");
          console.log("\n📄 Clean response content (first 200 chars):");
          console.log(text.substring(0, 200));

          await writer.close();
          process.kill();
          Deno.exit(0);
        }

        if (message.error) {
          console.log("❌ Error received:", message.error);
          await writer.close();
          process.kill();
          Deno.exit(1);
        }
      } catch (e) {
        console.log("⚠️ Error parsing JSON:", e);
      }
    }
  }
}
