/**
 * @fileoverview Type definitions for climpt upgrade module
 * @module upgrade/types
 */

export interface UpgradeOptions {
  /** Docs output directory (default: ".agent/climpt/docs") */
  docsDir: string;
  /** Skip docs update */
  skipDocs: boolean;
  /** Skip validation */
  skipValidate: boolean;
}

export interface UpgradeResult {
  success: boolean;
  previousVersion: string;
  latestVersion: string;
  docsInstalled: number;
  docsFailed: number;
  validation: ValidationResult;
  errors: string[];
}

export interface ValidationResult {
  version: boolean;
  docsList: boolean;
}
