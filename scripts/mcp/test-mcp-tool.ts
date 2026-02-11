#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run
// deno-lint-ignore-file no-console prefer-ascii no-await-in-loop

// Test MCP tool functionality
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

console.log("🔧 Testing MCP tool functionality...");

const process = cmd.spawn();
const writer = process.stdin.getWriter();

// 初期化
const initMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "tool-test-client", version: "1.0.0" },
  },
}) + "\n";

await writer.write(new TextEncoder().encode(initMessage));

// ツール呼び出し
const toolCallMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "breakdown",
    arguments: {
      command: "summary",
      input: "This is a test summary request.",
      options: {
        outputFormat: "markdown",
      },
    },
  },
}) + "\n";

const reader = process.stdout.getReader();
const errorReader = process.stderr.getReader();

// エラー出力を読み取る
const readStderr = async () => {
  try {
    while (true) {
      const { value, done } = await errorReader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      console.log("🐛 DEBUG:", text.trim());
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
  Deno.exit(0);
}, 10000);

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
        console.log(
          `📨 Response ${message.id}:`,
          JSON.stringify(message, null, 2),
        );

        if (message.result && message.id === 1 && !initReceived) {
          console.log("✅ Server initialized! Calling breakdown tool...");
          initReceived = true;
          await writer.write(new TextEncoder().encode(toolCallMessage));
        }

        if (message.result && message.id === 2) {
          console.log("🎉 Tool call completed successfully!");
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
        console.log("❌ Error parsing JSON:", e, "Line:", line);
      }
    }
  }
}
