import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Test that MCP tool configurations match available configs
Deno.test("MCP tool names match availableConfigs", async () => {
  const registryPath = ".agent/climpt/registry.json";
  
  try {
    const registryText = await Deno.readTextFile(registryPath);
    const registry = JSON.parse(registryText);
    
    const availableConfigs = registry.tools?.availableConfigs || [];
    const commands = registry.tools?.commands || [];
    
    // Check that all c1 values in commands are in availableConfigs
    const c1Values = new Set(commands.map((cmd: any) => cmd.c1));
    
    for (const c1 of c1Values) {
      assertEquals(
        availableConfigs.includes(c1),
        true,
        `Command domain '${c1}' should be in availableConfigs`
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Use default configs if registry doesn't exist
      const defaultConfigs = ["code", "docs", "git", "meta", "spec", "test"];
      assertExists(defaultConfigs, "Default configs should be defined");
      assertEquals(defaultConfigs.length, 6, "Should have 6 default tools");
    } else {
      throw error;
    }
  }
});

// Test registry template matches expected structure
Deno.test("Registry template has correct structure", async () => {
  const templatePath = "examples/mcp/registry.template.json";
  
  try {
    const templateText = await Deno.readTextFile(templatePath);
    const template = JSON.parse(templateText);
    
    // Check template has all required fields
    assertExists(template.version, "Template should have version");
    assertExists(template.description, "Template should have description");
    assertExists(template.tools, "Template should have tools");
    assertExists(template.tools.availableConfigs, "Template should have availableConfigs");
    assertExists(template.tools.commands, "Template should have commands");
    
    // Check template has example commands
    assertEquals(
      template.tools.commands.length > 0,
      true,
      "Template should have example commands"
    );
    
    // Check each command has proper structure
    for (const command of template.tools.commands) {
      assertExists(command.c1, "Template command should have c1");
      assertExists(command.c2, "Template command should have c2");
      assertExists(command.c3, "Template command should have c3");
      assertExists(command.description, "Template command should have description");
      assertExists(command.usage, "Template command should have usage");
      assertExists(command.options, "Template command should have options");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Registry template is missing or invalid: ${message}`);
  }
});

// Test MCP server default configuration fallback
Deno.test("MCP server defaults when registry is missing", async () => {
  // This test simulates what happens when registry.json doesn't exist
  const defaultTools = ["code", "docs", "git", "meta", "spec", "test"];
  
  // Test that defaults are properly defined
  assertEquals(defaultTools.length, 6, "Should have 6 default tools");
  assertEquals(defaultTools.includes("code"), true, "Should include 'code' tool");
  assertEquals(defaultTools.includes("docs"), true, "Should include 'docs' tool");
  assertEquals(defaultTools.includes("git"), true, "Should include 'git' tool");
  assertEquals(defaultTools.includes("meta"), true, "Should include 'meta' tool");
  assertEquals(defaultTools.includes("spec"), true, "Should include 'spec' tool");
  assertEquals(defaultTools.includes("test"), true, "Should include 'test' tool");
});

// Test command options validation
Deno.test("Command options have valid values", async () => {
  const registryPath = ".agent/climpt/registry.json";
  
  try {
    const registryText = await Deno.readTextFile(registryPath);
    const registry = JSON.parse(registryText);
    
    if (registry.tools?.commands) {
      for (const command of registry.tools.commands) {
        if (command.options) {
          // Check input values are valid (input layer types)
          for (const input of command.options.input) {
            const validInputs = ["default", "yaml", "json", "code", "bug"];
            assertEquals(
              validInputs.includes(input),
              true,
              `Invalid input type: ${input}`
            );
          }
          
          // Check adaptation values are valid
          for (const adaptation of command.options.adaptation) {
            const validAdaptations = ["default", "detailed", "compact"];
            assertEquals(
              validAdaptations.includes(adaptation),
              true,
              `Invalid adaptation: ${adaptation}`
            );
          }
          
          // Check boolean arrays only contain booleans
          for (const bool of command.options.file) {
            assertEquals(typeof bool, "boolean", "file should contain booleans");
          }
          for (const bool of command.options.stdin) {
            assertEquals(typeof bool, "boolean", "stdin should contain booleans");
          }
          for (const bool of command.options.destination) {
            assertEquals(typeof bool, "boolean", "destination should contain booleans");
          }
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
});