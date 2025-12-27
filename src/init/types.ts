/**
 * @fileoverview Type definitions for climpt init module
 * @module init/types
 */

/**
 * climpt init コマンドのオプション
 */
export interface InitOptions {
  /** 作業ディレクトリ (default: ".agent/climpt") */
  workingDir: string;
  /** 既存ファイルを上書き */
  force: boolean;
  /** Meta Domain初期化をスキップ */
  skipMeta: boolean;
  /** Registry生成をスキップ */
  skipRegistry: boolean;
  /** プロジェクトルート */
  projectRoot: string;
}

/**
 * 検出結果
 */
export interface DetectionResult {
  /** working_dir 存在 */
  hasWorkingDir: boolean;
  /** meta-app.yml 存在 */
  hasMetaAppYml: boolean;
  /** meta-user.yml 存在 */
  hasMetaUserYml: boolean;
  /** registry_config.json 存在 */
  hasRegistryConfig: boolean;
  /** registry.json 存在 */
  hasRegistry: boolean;
  /** frontmatter-to-schema/ 存在 */
  hasSchemaDir: boolean;
  /** prompts/ 存在 */
  hasPromptsDir: boolean;
  /** prompts/meta/ 存在 */
  hasMetaPromptsDir: boolean;
}

/**
 * Init処理結果
 */
export interface InitResult {
  success: boolean;
  created: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Registry Config構造
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
 * Registry構造
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
 * C3Lコマンド定義
 */
export interface Command {
  c1: string;
  c2: string;
  c3: string;
  title?: string;
  description: string;
  usage?: string;
  c3l_version?: string;
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
