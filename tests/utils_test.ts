import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseArgs } from "../src/utils.ts";

Deno.test("parseArgs should parse command line arguments", () => {
  const args = ["--version", "--help", "-v", "--config", "test.json"];
  const parsed = parseArgs(args);

  assertEquals(parsed.version, true);
  assertEquals(parsed.help, true);
  assertEquals(parsed.v, true);
  assertEquals(parsed.config, "test.json");
});

Deno.test("parseArgs should handle empty arguments", () => {
  const parsed = parseArgs([]);
  assertEquals(Object.keys(parsed).length, 0);
});
