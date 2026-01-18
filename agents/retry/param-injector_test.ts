/**
 * Parameter Injector Tests
 */

import { assertEquals } from "@std/assert";
import { injectParams } from "./param-injector.ts";

// Simple substitution tests
Deno.test("injectParams - substitutes simple variables", () => {
  const template = "Hello, {{name}}!";
  const params = { name: "World" };
  const result = injectParams(template, params);
  assertEquals(result, "Hello, World!");
});

Deno.test("injectParams - handles missing variables", () => {
  const template = "Hello, {{name}}!";
  const params = {};
  const result = injectParams(template, params);
  assertEquals(result, "Hello, !");
});

Deno.test("injectParams - handles nested properties", () => {
  const template = "{{user.name}} is {{user.age}} years old";
  const params = { user: { name: "Alice", age: 30 } };
  const result = injectParams(template, params);
  assertEquals(result, "Alice is 30 years old");
});

// Each block tests
Deno.test("injectParams - iterates over arrays", () => {
  const template = "Files: {{#each files}}- {{this}}\n{{/each}}";
  const params = { files: ["a.ts", "b.ts"] };
  const result = injectParams(template, params);
  assertEquals(result, "Files: - a.ts\n- b.ts\n");
});

Deno.test("injectParams - handles empty arrays in each", () => {
  const template = "Files: {{#each files}}- {{this}}\n{{/each}}";
  const params = { files: [] };
  const result = injectParams(template, params);
  assertEquals(result, "Files: ");
});

Deno.test("injectParams - accesses object properties in each", () => {
  const template =
    "{{#each errors}}- {{this.file}}: {{this.message}}\n{{/each}}";
  const params = {
    errors: [
      { file: "a.ts", message: "error1" },
      { file: "b.ts", message: "error2" },
    ],
  };
  const result = injectParams(template, params);
  assertEquals(result, "- a.ts: error1\n- b.ts: error2\n");
});

// If block tests
Deno.test("injectParams - renders content when condition is truthy", () => {
  const template = "{{#if hasError}}Error!{{/if}}";
  const params = { hasError: true };
  const result = injectParams(template, params);
  assertEquals(result, "Error!");
});

Deno.test("injectParams - does not render content when condition is falsy", () => {
  const template = "{{#if hasError}}Error!{{/if}}";
  const params = { hasError: false };
  const result = injectParams(template, params);
  assertEquals(result, "");
});

Deno.test("injectParams - handles if-else blocks", () => {
  const template = "{{#if success}}OK{{else}}FAIL{{/if}}";
  const params = { success: false };
  const result = injectParams(template, params);
  assertEquals(result, "FAIL");
});

Deno.test("injectParams - treats empty arrays as falsy", () => {
  const template = "{{#if items}}Has items{{else}}No items{{/if}}";
  const params = { items: [] };
  const result = injectParams(template, params);
  assertEquals(result, "No items");
});

Deno.test("injectParams - treats non-empty arrays as truthy", () => {
  const template = "{{#if items}}Has items{{else}}No items{{/if}}";
  const params = { items: [1, 2, 3] };
  const result = injectParams(template, params);
  assertEquals(result, "Has items");
});

// Array value test
Deno.test("injectParams - joins arrays with commas for simple substitution", () => {
  const template = "Files: {{files}}";
  const params = { files: ["a.ts", "b.ts", "c.ts"] };
  const result = injectParams(template, params);
  assertEquals(result, "Files: a.ts, b.ts, c.ts");
});
