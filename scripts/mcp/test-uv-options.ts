#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run
// deno-lint-ignore-file no-console prefer-ascii no-await-in-loop

/**
 * Test MCP describe tool returns userVariables (uv-* options)
 * Verifies that registry.json userVariables are included in describe results
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

console.log("🔧 Testing MCP describe returns userVariables (uv-* options)...");

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
    clientInfo: { name: "uv-options-test-client", version: "1.0.0" },
  },
}) + "\n";

await writer.write(new TextEncoder().encode(initMessage));

// Describe tool call for command with userVariables
const describeMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "describe",
    arguments: {
      c1: "git",
      c2: "group-commit",
      c3: "unstaged-changes",
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
          console.log("✅ Server initialized! Calling describe tool...");
          initReceived = true;
          await writer.write(new TextEncoder().encode(describeMessage));
        }

        if (message.result && message.id === 2) {
          console.log("🎉 Describe tool call completed!");

          const result = message.result;
          if (!result.content || !Array.isArray(result.content)) {
            console.log("❌ FAILED: Response missing 'content' array");
            await writer.close();
            process.kill();
            Deno.exit(1);
          }

          const textContent = result.content[0];
          const responseData = JSON.parse(textContent.text);

          console.log("\n📋 Describe response:");
          console.log(JSON.stringify(responseData, null, 2));

          // Validate userVariables are present
          const commands = responseData.commands;
          if (!commands || commands.length === 0) {
            console.log("❌ FAILED: No commands found in describe response");
            await writer.close();
            process.kill();
            Deno.exit(1);
          }

          const command = commands[0];
          const uv = command.options?.uv;

          if (!uv) {
            console.log("❌ FAILED: uv not found in describe response");
            console.log(
              "📄 Command options:",
              JSON.stringify(command.options, null, 2),
            );
            await writer.close();
            process.kill();
            Deno.exit(1);
          }

          // Check for expected uv variables
          if (!uv.scope || !uv.prefix) {
            console.log(
              "❌ FAILED: Expected uv 'scope' and 'prefix' not found",
            );
            console.log("📄 uv:", JSON.stringify(uv, null, 2));
            await writer.close();
            process.kill();
            Deno.exit(1);
          }

          console.log("\n✅ SUCCESS: uv found in describe response");
          console.log("📄 uv:");
          console.log(`  - scope: ${uv.scope}`);
          console.log(`  - prefix: ${uv.prefix}`);

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
