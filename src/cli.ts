import type { CliOptions } from "./types.ts";
import { parseArgs } from "./utils.ts";

const VERSION = "0.1.0";

export function printHelp(): void {
  console.log(`
climpt v${VERSION}

A CLI tool for managing prompts and AI interactions

Usage:
  climpt [options] [command]

Options:
  --version, -v    Show version number
  --help, -h       Show help
  --verbose        Enable verbose logging

Commands:
  prompt           Manage prompts
  config           Manage configuration
  run              Run a prompt

Examples:
  climpt --version
  climpt prompt list
  climpt config set provider openai
  climpt run my-prompt
`);
}

export function printVersion(): void {
  console.log(`climpt v${VERSION}`);
}

export function main(args: string[] = []): void {
  const options = parseArgs(args) as CliOptions;

  if (options.version || options.v) {
    printVersion();
    return;
  }

  if (options.help || options.h) {
    printHelp();
    return;
  }

  // Default behavior
  console.log("Welcome to climpt! Use --help for usage information.");
}
