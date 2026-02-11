# MCP Test Scripts

This directory contains executable test scripts for the MCP (Model Context
Protocol) implementation. These are **not** unit tests run by `deno test`, but
rather standalone scripts that test the MCP server functionality through
integration testing.

## Scripts

### Server Test Scripts

- **simple-mcp-test.ts** - Simple MCP server implementation for basic testing
- **test-mcp.ts** - MCP server test using the official SDK client
- **test-mcp-simple.ts** - Basic MCP server operation test
- **test-mcp-debug.ts** - MCP test script with debug output

### Tool Test Scripts

- **test-all-tools.ts** - Comprehensive test for all MCP tools (search,
  describe, execute)
- **test-execute-response.ts** - Tests execute tool response format compliance
- **test-mcp-tool.ts** - Tests MCP tool functionality
- **test-uv-options.ts** - Tests userVariables (uv-* options) in describe tool

## Running Scripts

These scripts are executable and can be run directly:

```bash
# Run a specific test script
./scripts/mcp/test-all-tools.ts

# Or using deno run
deno run --allow-read --allow-write --allow-net --allow-env --allow-run scripts/mcp/test-all-tools.ts
```

## Note

For actual unit tests that are part of the test suite, see `/tests/mcp/`:

- `test-mcp-config.ts` - MCP configuration tests
- `test-mcp-tools.ts` - Search and describe tool tests
