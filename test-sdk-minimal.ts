/**
 * Minimal SDK test to verify basic functionality
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

console.log("🧪 Testing Claude Agent SDK with minimal configuration\n");

const response = query({
  prompt: "Say hello and list the files in the current directory",
  options: {
    allowedTools: ["Bash"],
  },
});

for await (const message of response) {
  console.log(`📨 Message type: ${message.type}`);

  if (message.type === "system" && message.subtype === "init") {
    console.log(`   Session ID: ${message.session_id}`);
    console.log(`   Model: ${message.model}`);
  }

  if (message.type === "assistant") {
    const textContent = message.message.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    if (textContent) {
      console.log(`   Assistant: ${textContent.substring(0, 100)}...`);
    }
  }

  if (message.type === "result") {
    console.log(`   Result: ${message.result}`);
    console.log(`   Duration: ${message.duration_ms}ms`);
    console.log(`   Turns: ${message.num_turns}`);
  }
}

console.log("\n✅ Test complete");
