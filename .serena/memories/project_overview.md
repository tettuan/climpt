# Climpt Project Overview

## Purpose
Climpt is a CLI wrapper tool around the `@tettuan/breakdown` JSR package. It provides a unified interface for AI-assisted development instruction tools, enabling developers to create, manage, and execute development instructions using TypeScript and JSON Schema for AI system interpretation.

The main purposes are:
- Act as a wrapper to call breakdown package functionality
- Provide prompt management and invocation system
- Enable AI systems (particularly Claude and Cursor) to interpret and execute development instructions
- Centralized management of patterned prompts
- Dynamic invocation from CLI agents
- Building processing flows through prompt chaining

## Tech Stack
- **Runtime**: Deno (2.4 or later recommended)
- **Language**: TypeScript
- **Package System**: JSR (JavaScript Registry)
- **Dependencies**: @tettuan/breakdown package (core functionality)
- **Target AI Systems**: Claude (primarily Claude-4-sonnet), Cursor

## Project Structure
```
climpt/
├── mod.ts              # Main module exports
├── cli.ts              # CLI entry point
├── src/
│   ├── cli.ts         # Core CLI implementation
│   ├── version.ts     # Version management
│   └── mcp/           # MCP (Model Context Protocol) related
│       └── index.ts
├── tests/             # Test files (currently empty)
│   ├── cli_test.ts
│   └── utils_test.ts
├── examples/          # Example prompts
│   └── prompts/
├── docs/              # Documentation
├── deno.json          # Deno configuration
└── CLAUDE.md          # AI agent instructions
```

## Key Components
- **mod.ts**: Main module that exports the `main` function from src/cli.ts
- **cli.ts**: Executable entry point that imports and runs the main function
- **src/cli.ts**: Core implementation that dynamically imports breakdown package
- **src/version.ts**: Version constant (1.4.1) used for package imports

## Design Principles
- Minimal wrapper architecture - core functionality remains in breakdown package
- Dynamic import strategy for the breakdown package
- Type-safe with TypeScript and JSON Schema
- Optimized for AI coding assistants
- Support for profile switching via --config option