#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run

// Enhanced MCP test script with debug output
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

console.log("🚀 Starting MCP test with debug output...");

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
      name: "debug-test-client",
      version: "1.0.0",
    },
  },
}) + "\n";

console.log("📤 Sending initialization message:", initMessage.trim());
await writer.write(new TextEncoder().encode(initMessage));

// レスポンスを読み取り
const reader = process.stdout.getReader();
const errorReader = process.stderr.getReader();

// エラー出力を読み取る（デバッグ情報）
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

readStderr(); // バックグラウンドで実行

let buffer = "";

// タイムアウト設定
setTimeout(async () => {
  console.log("⏱️ Timeout - closing connection");
  await writer.close();
  process.kill();
  Deno.exit(0);
}, 5000);

// 初期化レスポンスを待つ
let initReceived = false;

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
        
        if (message.result && message.id === 1 && !initReceived) {
          console.log("✅ Server initialized successfully!");
          initReceived = true;
          
          // プロンプト一覧を要求
          const listPromptsMessage = JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "prompts/list",
            params: {},
          }) + "\n";
          
          console.log("📤 Requesting prompts list...");
          await writer.write(new TextEncoder().encode(listPromptsMessage));
        }
        
        if (message.result && message.id === 2) {
          console.log("📋 Got prompts list!");
          console.log("Available prompts:", message.result.prompts?.map((p: any) => p.name));
          
          // ツール一覧を要求
          const listToolsMessage = JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/list",
            params: {},
          }) + "\n";
          
          console.log("📤 Requesting tools list...");
          await writer.write(new TextEncoder().encode(listToolsMessage));
        }
        
        if (message.result && message.id === 3) {
          console.log("🔧 Got tools list!");
          console.log("Available tools:", message.result.tools?.map((t: any) => t.name));
          
          console.log("🎉 All tests completed successfully!");
          await writer.close();
          process.kill();
          Deno.exit(0);
        }
        
      } catch (e) {
        console.log("❌ Error parsing JSON:", e, "Line:", line);
      }
    }
  }
}