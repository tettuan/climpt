/**
 * @fileoverview Registry and Schema initialization module for climpt
 * @module init/registry-init
 */

import { resolve } from "@std/path";
import type { Registry, RegistryConfig } from "./types.ts";

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
  const configResult = await createRegistryConfig(fullWorkingDir, force);
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
 */
function getEmbeddedSchema(fileName: string): string | null {
  const schemas: Record<string, object> = {
    "registry.schema.json": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "required": ["version", "tools"],
      "properties": {
        "version": { "type": "string" },
        "description": { "type": "string" },
        "tools": {
          "type": "object",
          "properties": {
            "availableConfigs": {
              "type": "array",
              "items": { "type": "string" },
            },
            "commands": { "type": "array" },
          },
        },
      },
    },
    "command.schema.json": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "required": ["c1", "c2", "c3"],
      "properties": {
        "c1": { "type": "string", "pattern": "^[a-z]+(-[a-z]+)?$" },
        "c2": { "type": "string", "pattern": "^[a-z]+(-[a-z]+)?$" },
        "c3": { "type": "string", "pattern": "^[a-z]+(-[a-z]+)?$" },
        "title": { "type": "string" },
        "description": { "type": "string" },
        "usage": { "type": "string" },
      },
    },
    "registry.template.json": {
      "version": "{version}",
      "description": "{description}",
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
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const configPath = resolve(workingDir, "config/registry_config.json");

  if ((await exists(configPath)) && !force) {
    result.skipped.push(configPath);
    console.log(`  Skip: ${configPath} (already exists)`);
    return result;
  }

  // workingDir からの相対パスで設定
  const registryConfig: RegistryConfig = {
    version: "1.0.0",
    registries: {
      climpt: "registry.json",
    },
    defaults: {
      promptsDir: "prompts",
      outputDir: ".",
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
