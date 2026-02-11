#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run
// deno-lint-ignore-file no-console prefer-ascii no-await-in-loop

/**
 * Comprehensive test for all MCP tools: search, describe, execute
 * Verifies response format compliance and JSON compactness
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

console.log("🔧 Testing all MCP tools (search, describe, execute)...\n");

const process = cmd.spawn();
const writer = process.stdin.getWriter();
const reader = process.stdout.getReader();
const errorReader = process.stderr.getReader();

// Read stderr
const readStderr = async () => {
  try {
    while (true) {
      const { value, done } = await errorReader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      if (text.includes("Error") || text.includes("Failed")) {
        console.log("🐛 STDERR:", text.trim());
      }
    }
  } catch (e) {
    console.log("Error reading stderr:", e);
  }
};

readStderr();

let buffer = "";
let testStep = 0;
const results: { [key: string]: boolean } = {};

// Initialize
const initMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "all-tools-test-client", version: "1.0.0" },
  },
}) + "\n";

await writer.write(new TextEncoder().encode(initMessage));

setTimeout(async () => {
  console.log("\n⏱️ Timeout - closing connection");
  await writer.close();
  process.kill();
  Deno.exit(1);
}, 20000);

/**
 * Validate response format and JSON compactness
 */
function validateResponse(
  toolName: string,
  result: { content: Array<{ type: string; text: string }> },
): boolean {
  console.log(`\n📋 Validating ${toolName} response...`);

  if (!result.content || !Array.isArray(result.content)) {
    console.log(`❌ ${toolName}: Missing content array`);
    return false;
  }

  const textContent = result.content[0];
  if (!textContent || textContent.type !== "text") {
    console.log(`❌ ${toolName}: First content item is not type 'text'`);
    return false;
  }

  const text = textContent.text;

  // Check JSON compactness for search/describe (should not have pretty-print indentation)
  if (toolName === "search" || toolName === "describe") {
    const hasExcessiveIndentation = text.includes("\n  ") ||
      text.includes("\n    ");
    if (hasExcessiveIndentation) {
      console.log(`❌ ${toolName}: Response uses excessive indentation`);
      console.log(`   First 200 chars: ${text.substring(0, 200)}`);
      return false;
    }

    // Verify it's valid JSON
    try {
      const parsed = JSON.parse(text);
      console.log(`✅ ${toolName}: Valid compact JSON response`);
      console.log(`   Keys: ${Object.keys(parsed).join(", ")}`);
      return true;
    } catch (e) {
      console.log(`❌ ${toolName}: Invalid JSON - ${e}`);
      return false;
    }
  }

  // For execute tool, check that internal details are not exposed
  if (toolName === "execute") {
    const hasInternalDetails = text.includes('"success"') ||
      text.includes('"exitCode"') ||
      text.includes('"command"') ||
      (text.includes('"stdout"') && text.includes('"stderr"'));

    if (hasInternalDetails) {
      console.log(`❌ ${toolName}: Exposes internal implementation details`);
      return false;
    }

    console.log(`✅ ${toolName}: Clean response without internal details`);
    return true;
  }

  return true;
}

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

        // Step 0: Initialization
        if (message.result && message.id === 1 && testStep === 0) {
          console.log("✅ Server initialized!\n");
          testStep = 1;

          // Test 1: Search tool
          console.log("🔍 Testing SEARCH tool...");
          const searchMessage = JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "search",
              arguments: {
                query: "create git commit",
                agent: "climpt",
              },
            },
          }) + "\n";

          await writer.write(new TextEncoder().encode(searchMessage));
        } // Step 1: Search result
        else if (message.result && message.id === 2 && testStep === 1) {
          results["search"] = validateResponse("search", message.result);
          testStep = 2;

          // Test 2: Describe tool
          console.log("\n📖 Testing DESCRIBE tool...");
          const describeMessage = JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "describe",
              arguments: {
                agent: "climpt",
                c1: "meta",
                c2: "describe",
                c3: "version",
              },
            },
          }) + "\n";

          await writer.write(new TextEncoder().encode(describeMessage));
        } // Step 2: Describe result
        else if (message.result && message.id === 3 && testStep === 2) {
          results["describe"] = validateResponse("describe", message.result);
          testStep = 3;

          // Test 3: Execute tool
          console.log("\n⚡ Testing EXECUTE tool...");
          const executeMessage = JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
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

          await writer.write(new TextEncoder().encode(executeMessage));
        } // Step 3: Execute result
        else if (message.result && message.id === 4 && testStep === 3) {
          results["execute"] = validateResponse("execute", message.result);

          // Print summary
          console.log("\n" + "=".repeat(50));
          console.log("📊 TEST SUMMARY");
          console.log("=".repeat(50));

          let allPassed = true;
          for (const [tool, passed] of Object.entries(results)) {
            const status = passed ? "✅ PASS" : "❌ FAIL";
            console.log(`${status} - ${tool} tool`);
            if (!passed) allPassed = false;
          }

          console.log("=".repeat(50));

          await writer.close();
          process.kill();
          Deno.exit(allPassed ? 0 : 1);
        }

        if (message.error) {
          console.log("❌ Error received:", JSON.stringify(message.error));
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
