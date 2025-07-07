// Utility functions for climpt
export function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith("-")) {
        parsed[key] = nextArg;
        i++; // Skip next argument as it's a value
      } else {
        parsed[key] = true;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      parsed[key] = true;
    }
  }

  return parsed;
}

export function loadConfig(configPath: string): Promise<any> {
  // TODO: Implement config loading logic
  return Promise.resolve({});
}

export function saveConfig(config: any, configPath: string): Promise<void> {
  // TODO: Implement config saving logic
  return Promise.resolve();
}
