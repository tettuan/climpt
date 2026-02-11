# MCP Unit Tests

This directory contains unit tests for the MCP (Model Context Protocol)
implementation. These tests are run as part of the main test suite via
`deno test`.

## Test Files

- **test-mcp-config.ts** - Tests for MCP configuration structure and loading
- **test-mcp-tools.ts** - Tests for search and describe tools functionality

## Configuration

- **simple-mcp-config.json** - Simple configuration file used for testing

## Running Tests

```bash
# Run all tests
deno task test

# Run MCP tests specifically
deno test --allow-read --allow-write --allow-env tests/mcp/

# Run a specific test file
deno test --allow-read --allow-write --allow-env tests/mcp/test-mcp-config.ts
```

## Integration Test Scripts

For executable integration test scripts that test the MCP server end-to-end, see
`/scripts/mcp/`.
