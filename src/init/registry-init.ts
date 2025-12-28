/**
 * @fileoverview Registry and Schema initialization module for climpt
 * @module init/registry-init
 */

import { resolve } from "@std/path";
import type { Registry } from "./types.ts";

const SCHEMA_FILES = [
  "registry.schema.json",
  "registry.template.json",
  "command.schema.json",
  "command.template.json",
] as const;

/**
 * Check if a path exists
 */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/**
 * Ensure directory exists, creating it if necessary
 */
async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

/**
 * Registry & Schema初期化を実行
 */
export async function initRegistryAndSchema(
  projectRoot: string,
  workingDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const fullWorkingDir = resolve(projectRoot, workingDir);

  // 1. frontmatter-to-schema/ 配置
  const schemaResult = await deploySchemaFiles(fullWorkingDir, force);
  result.created.push(...schemaResult.created);
  result.skipped.push(...schemaResult.skipped);

  // 2. registry_config.json 生成
  const configResult = await createRegistryConfig(
    fullWorkingDir,
    workingDir,
    force,
  );
  result.created.push(...configResult.created);
  result.skipped.push(...configResult.skipped);

  // 3. registry.json 初期化
  const registryResult = await initRegistry(fullWorkingDir, force);
  result.created.push(...registryResult.created);
  result.skipped.push(...registryResult.skipped);

  return result;
}

/**
 * frontmatter-to-schema ファイルを配置
 */
async function deploySchemaFiles(
  workingDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const schemaDir = resolve(workingDir, "frontmatter-to-schema");

  if ((await exists(schemaDir)) && !force) {
    result.skipped.push(schemaDir);
    console.log(`  Skip: ${schemaDir} (already exists)`);
    return result;
  }

  await ensureDir(schemaDir);
  console.log(`  Created: ${schemaDir}`);

  for (const fileName of SCHEMA_FILES) {
    const filePath = resolve(schemaDir, fileName);
    const embedded = getEmbeddedSchema(fileName);

    if (embedded) {
      await Deno.writeTextFile(filePath, embedded);
      result.created.push(filePath);
      console.log(`  Deployed: ${fileName}`);
    }
  }

  return result;
}

/**
 * 埋め込みスキーマを取得
 * Note: These schemas must match the full versions in .agent/climpt/frontmatter-to-schema/
 * The x- attributes are required by @aidevtool/frontmatter-to-schema for aggregation
 */
function getEmbeddedSchema(fileName: string): string | null {
  const schemas: Record<string, object> = {
    "registry.schema.json": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "climpt-registry-schema",
      "title": "Climpt Registry Schema",
      "description":
        "Schema for generating registry.json from prompt frontmatter",
      "type": "object",
      "x-template": "registry.template.json",
      "x-template-items": "command.template.json",
      "required": ["version", "description", "tools"],
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "string",
          "default": "1.0.0",
        },
        "description": {
          "type": "string",
          "default":
            "Climpt comprehensive configuration for MCP server and command registry",
        },
        "tools": {
          "type": "object",
          "additionalProperties": false,
          "required": ["availableConfigs", "commands"],
          "properties": {
            "availableConfigs": {
              "type": "array",
              "items": { "type": "string" },
              "x-derived-from": "tools.commands[].c1",
              "x-derived-unique": true,
              "description": "Unique list of domains derived from c1 values",
            },
            "commands": {
              "type": "array",
              "x-frontmatter-part": true,
              "items": {
                "$ref": "command.schema.json",
              },
              "description": "Array of command definitions from frontmatter",
            },
          },
        },
      },
    },
    "command.schema.json": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "c3l-prompt-schema-v0.5",
      "title": "C3L Prompt Frontmatter Schema",
      "description":
        "Schema for C3L (Climpt 3-word Language) v0.5 compliant prompt frontmatter",
      "type": "object",
      "x-template": "registry.template.json",
      "x-template-items": "command.template.json",
      "required": ["c1", "c2", "c3", "title"],
      "additionalProperties": false,
      "properties": {
        "c1": {
          "type": "string",
          "pattern": "^[a-z]+(-[a-z]+)?$",
          "description":
            "Domain: What domain this acts on (e.g., git, meta, test)",
        },
        "c2": {
          "type": "string",
          "pattern": "^[a-z]+(-[a-z]+)?$",
          "description": "Action: What is done (e.g., group-commit, review)",
        },
        "c3": {
          "type": "string",
          "pattern": "^[a-z]+(-[a-z]+)?$",
          "description":
            "Target: What is acted upon (e.g., unstaged-changes, pull-request)",
        },
        "title": {
          "type": "string",
          "description": "Human-readable title of the prompt",
        },
        "description": {
          "type": "string",
          "description": "Detailed description of what this prompt does",
        },
        "usage": {
          "type": "string",
          "description": "Usage example command",
        },
        "c3l_version": {
          "type": "string",
          "enum": ["0.5"],
          "default": "0.5",
          "description": "C3L specification version",
        },
        "options": {
          "type": "object",
          "description": "Command options configuration",
          "properties": {
            "edition": {
              "type": "array",
              "items": { "type": "string" },
              "default": ["default"],
              "description": "Available edition variants",
            },
            "adaptation": {
              "type": "array",
              "items": { "type": "string" },
              "default": ["default"],
              "description": "Available adaptation levels",
            },
            "file": {
              "type": "boolean",
              "default": false,
              "description": "Whether command accepts file input",
            },
            "stdin": {
              "type": "boolean",
              "default": false,
              "description": "Whether command accepts stdin input",
            },
            "destination": {
              "type": "boolean",
              "default": false,
              "description": "Whether command supports destination output",
            },
          },
        },
        "uv": {
          "type": "array",
          "description":
            "User-defined variables declared in instruction body as {uv-*} templates",
          "items": {
            "type": "object",
            "additionalProperties": {
              "type": "string",
              "description": "Variable description",
            },
          },
        },
      },
    },
    "registry.template.json": {
      "version": "1.0.0",
      "description":
        "Climpt comprehensive configuration for MCP server and command registry",
      "tools": {
        "availableConfigs": "{@derived:availableConfigs}",
        "commands": "{@items}",
      },
    },
    "command.template.json": {
      "c1": "{c1}",
      "c2": "{c2}",
      "c3": "{c3}",
      "description": "{description}",
      "usage": "{usage}",
      "options": {
        "edition": "{options.edition}",
        "adaptation": "{options.adaptation}",
        "file": "{options.file}",
        "stdin": "{options.stdin}",
        "destination": "{options.destination}",
      },
      "uv": "{uv}",
    },
  };

  const schema = schemas[fileName];
  return schema ? JSON.stringify(schema, null, 2) : null;
}

/**
 * registry_config.json を生成
 */
async function createRegistryConfig(
  workingDir: string,
  workingDirRelative: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const configPath = resolve(workingDir, "config/registry_config.json");

  if ((await exists(configPath)) && !force) {
    result.skipped.push(configPath);
    console.log(`  Skip: ${configPath} (already exists)`);
    return result;
  }

  // プロジェクトルートからの相対パスで設定
  const registryConfig = {
    registries: {
      climpt: `${workingDirRelative}/registry.json`,
    },
  };

  await Deno.writeTextFile(
    configPath,
    JSON.stringify(registryConfig, null, 2) + "\n",
  );
  result.created.push(configPath);
  console.log(`  Created: ${configPath}`);

  return result;
}

/**
 * registry.json を初期化
 */
async function initRegistry(
  workingDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const registryPath = resolve(workingDir, "registry.json");

  if ((await exists(registryPath)) && !force) {
    result.skipped.push(registryPath);
    console.log(`  Skip: ${registryPath} (already exists)`);
    return result;
  }

  const registry: Registry = {
    version: "1.0.0",
    description: "Climpt command registry - generated by climpt init",
    tools: {
      availableConfigs: [],
      commands: [],
    },
  };

  await Deno.writeTextFile(
    registryPath,
    JSON.stringify(registry, null, 2) + "\n",
  );
  result.created.push(registryPath);
  console.log(`  Created: ${registryPath}`);

  return result;
}
