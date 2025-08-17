# Suggested Commands for Development

## Development Commands

### Running the CLI
```bash
# Run in development mode with watch
deno task dev

# Run directly with arguments
deno run --allow-read --allow-write --allow-net --allow-env cli.ts [args]

# Run the main module
deno run --allow-read --allow-write --allow-net --allow-env mod.ts [args]
```

### Building
```bash
# Compile to standalone executable
deno task build
# Creates ./dist/climpt executable
```

### Code Quality
```bash
# Format code
deno fmt

# Lint code
deno lint

# Type checking (implicitly done during run)
deno check mod.ts
deno check cli.ts
```

### Testing
```bash
# Run tests (when implemented)
deno test

# Run specific test file
deno test tests/cli_test.ts
deno test tests/utils_test.ts
```

### Installation
```bash
# Install globally
deno install --allow-read --allow-write --allow-net --allow-env --global climpt jsr:@aidevtool/climpt

# Install locally to project
deno install --allow-read --allow-write --allow-net --allow-env --global --root .deno -n climpt jsr:@aidevtool/climpt

# Uninstall global
deno uninstall climpt

# Uninstall local
deno uninstall --root .deno climpt
```

### Git Commands (Darwin/macOS)
```bash
# Check status
git status

# View differences
git diff
git diff --staged

# Commit changes
git add .
git commit -m "message"

# View recent commits
git log --oneline -10

# Create and push branch
git checkout -b feature-branch
git push -u origin feature-branch
```

### System Utilities (Darwin/macOS)
```bash
# List files (macOS version)
ls -la

# Find files
find . -name "*.ts"

# Search in files (use ripgrep if available)
rg "pattern" --type ts
grep -r "pattern" --include="*.ts"

# Watch files for changes
fswatch -o src/ | xargs -n1 -I{} deno run --allow-all cli.ts
```

## Package Management
```bash
# Update dependencies (by updating VERSION in src/version.ts)
# Then reinstall the CLI

# Cache dependencies
deno cache mod.ts
```

## MCP Server Testing
```bash
# Run MCP tests
deno run --allow-all test-mcp.ts
deno run --allow-all test-mcp-simple.ts
```

## Important Notes
- Always use Deno's permission flags appropriately
- The project uses JSR packages, not npm
- Version updates require changing both `src/version.ts` and `deno.json`
- Tests are currently placeholder files and need implementation