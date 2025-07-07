#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * CLI entry point for Climpt
 * 
 * This script serves as the main executable for the Climpt CLI tool.
 * It imports and executes the main function with command line arguments.
 */

import { main } from "./src/cli.ts";

await main(Deno.args);
