# 29: MCP Start Server

**What:** Verifies the MCP server package resolves and starts without crash.
**Why:** MCP server availability is required for Claude Desktop / Cursor
integration.

## Verifies

- `deno info jsr:@aidevtool/climpt/mcp` resolves successfully
- MCP server starts and exits cleanly when given EOF on stdin
