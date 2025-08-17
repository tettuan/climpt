# Code Style and Conventions

## Language and Runtime
- **TypeScript** with Deno runtime
- Deno 2.4 or later recommended
- Uses JSR (JavaScript Registry) for package management

## File Structure Conventions
- Main module exports in `mod.ts`
- CLI entry points use shebang: `#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env`
- Version management centralized in `src/version.ts`
- Documentation blocks use JSDoc format with @fileoverview, @module, @example tags

## Code Style
- **Type Safety**: Strict TypeScript mode enabled (`"strict": true` in deno.json)
- **Module System**: ES modules with dynamic imports for external packages
- **Error Handling**: Try-catch blocks with console.error and Deno.exit(1) for failures
- **Comments**: Comprehensive JSDoc comments for modules and functions
- **No additional comments** in code unless documenting complex logic

## Naming Conventions
- **Files**: lowercase with hyphens for multi-word (e.g., `cli_test.ts`)
- **Functions**: camelCase (e.g., `importBreakdown`, `runBreakdown`)
- **Constants**: UPPER_CASE (e.g., `VERSION`)
- **Modules**: Named exports preferred over default exports

## Import/Export Patterns
```typescript
// Static imports for internal modules
import { VERSION } from "./version.ts";

// Dynamic imports for external packages
const mod = await import(`jsr:@tettuan/breakdown@^${VERSION}`);

// Named exports
export { main } from "./src/cli.ts";
export async function main(_args: string[] = []): Promise<void>
```

## Formatting Configuration (deno.json)
- Include: `["src/", "*.ts", "*.json"]`
- Exclude: `["dist/", "node_modules/"]`

## Linting Configuration (deno.json)
- Include: `["src/", "*.ts"]`
- Exclude: `["dist/", "node_modules/"]`

## Documentation Standards
- Each file must have a @fileoverview JSDoc comment
- Functions should have JSDoc with parameter and return type descriptions
- Examples should be provided where appropriate
- Version updates require changes in both VERSION constant and deno.json

## Project-Specific Patterns
- Wrapper pattern: Minimal code, delegates to breakdown package
- Dynamic import based on VERSION constant
- Async/await for all asynchronous operations
- Error messages should be descriptive and include context