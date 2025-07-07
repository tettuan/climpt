// Core types for climpt
export interface CliOptions {
  version?: boolean;
  help?: boolean;
  verbose?: boolean;
  v?: boolean;
  h?: boolean;
}

export interface PromptConfig {
  name: string;
  description: string;
  template: string;
  variables?: Record<string, string>;
}

export interface AIProvider {
  name: string;
  apiKey?: string;
  baseUrl?: string;
}
