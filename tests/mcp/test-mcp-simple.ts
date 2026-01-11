#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run
// deno-lint-ignore-file no-console prefer-ascii no-await-in-loop

// MCP server basic operation test
const cmd = new Deno.Command("deno", {
  args: [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-net",
    "--allow-env",
    "./src/mcp/index.ts",
  ],
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
});

const process = cmd.spawn();

// 初期化メッセージを送信
const writer = process.stdin.getWriter();
const initMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0",
    },
  },
}) + "\n";

await writer.write(new TextEncoder().encode(initMessage));

// レスポンスを読み取り
const reader = process.stdout.getReader();
let buffer = "";

setTimeout(async () => {
  console.log("⏱️ Timeout - closing connection");
  await writer.close();
  process.kill();
  Deno.exit(0);
}, 3000);

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
        console.log("📨 Received:", JSON.stringify(message, null, 2));

        if (message.result && message.id === 1) {
          console.log("✅ Server initialized successfully!");

          // プロンプト一覧を要求
          const listPromptsMessage = JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "prompts/list",
            params: {},
          }) + "\n";

          await writer.write(new TextEncoder().encode(listPromptsMessage));
        }

        if (message.result && message.id === 2) {
          console.log("✅ Got prompts list!");
          await writer.close();
          process.kill();
          Deno.exit(0);
        }
      } catch (e) {
        console.error("Parse error:", e, "Line:", line);
      }
    }
  }
}
