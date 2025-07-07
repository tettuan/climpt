/**
 * Climpt - A CLI tool for managing prompts and AI interactions
 * 
 * Climpt is a wrapper CLI tool around the breakdown package (@tettuan/breakdown),
 * providing a unified interface for AI-assisted development instruction tools.
 * It enables developers to create, manage, and execute development instructions
 * using TypeScript and JSON Schema for AI system interpretation.
 * 
 * @example
 * ```typescript
 * import { main } from "jsr:@aidevtool/climpt";
 * 
 * // Execute CLI with arguments
 * await main(["init"]);
 * await main(["to", "project", "--config=custom"]);
 * ```
 * 
 * @module
 */

// Export main CLI functionality
export * from "./src/cli.ts";
