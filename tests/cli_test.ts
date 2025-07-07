import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { main } from "../src/cli.ts";

Deno.test("CLI should handle version flag", () => {
  // Mock console.log to capture output
  const originalLog = console.log;
  let output = "";
  console.log = (msg: string) => {
    output += msg;
  };

  main(["--version"]);

  // Restore console.log
  console.log = originalLog;

  assertEquals(output.includes("climpt v0.1.0"), true);
});
