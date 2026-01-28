/**
 * @fileoverview Type definitions for climpt init module
 * @module init/types
 */

/**
 * Options for climpt init command
 */
export interface InitOptions {
  /** Working directory (default: ".agent/climpt") */
  workingDir: string;
  /** Overwrite existing files */
  force: boolean;
  /** Skip Meta Domain initialization */
  skipMeta: boolean;
  /** Skip Registry generation */
  skipRegistry: boolean;
  /** Project root directory */
  projectRoot: string;
}

/**
 * Detection result
 */
export interface DetectionResult {
  /** working_dir exists */
  hasWorkingDir: boolean;
  /** meta-app.yml exists */
  hasMetaAppYml: boolean;
  /** meta-user.yml exists */
  hasMetaUserYml: boolean;
  /** registry_config.json exists */
  hasRegistryConfig: boolean;
  /** registry.json exists */
  hasRegistry: boolean;
  /** frontmatter-to-schema/ exists */
  hasSchemaDir: boolean;
  /** prompts/ exists */
  hasPromptsDir: boolean;
  /** prompts/meta/ exists */
  hasMetaPromptsDir: boolean;
}

/**
 * Init process result
 */
export interface InitResult {
  success: boolean;
  created: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Registry Config structure
 */
export interface RegistryConfig {
  version: string;
  registries: Record<string, string>;
  defaults: {
    promptsDir: string;
    outputDir: string;
  };
}

/**
 * Registry structure
 */
export interface Registry {
  version: string;
  description: string;
  tools: {
    availableConfigs: string[];
    commands: Command[];
  };
}

/**
 * C3L command definition
 */
export interface Command {
  c1: string;
  c2: string;
  c3: string;
  title?: string;
  description: string;
  usage?: string;
  "c3l_version"?: string;
  options?: CommandOptions;
  uv?: UserVariable[];
}

export interface CommandOptions {
  edition?: string[];
  adaptation?: string[];
  file?: boolean;
  stdin?: boolean;
  destination?: boolean;
}

export interface UserVariable {
  name: string;
  description: string;
}
