/**
 * CompletionValidator Types
 *
 * CompletionValidator 専用の型定義。
 * 共通型は agents/common/completion-types.ts から re-export する。
 */

import type { Logger } from "../../src_common/logger.ts";

// Re-export common types
export type {
  CommandResult,
  CompletionCondition,
  CompletionPattern,
  ExtractorType,
  FailureAction,
  OnFailureConfig,
  StepConfigV3,
  StepsRegistryV3,
  SuccessCondition,
  ValidationResultV3,
  ValidatorDefinition,
  ValidatorType,
} from "../../common/completion-types.ts";

export {
  getPatternFromResult,
  isRegistryV3,
  isStepConfigV3,
} from "../../common/completion-types.ts";

/**
 * CompletionValidator のコンテキスト
 */
export interface CompletionValidatorContext {
  /** 作業ディレクトリ */
  workingDir: string;
  /** ロガー */
  logger: Logger;
  /** Agent ID */
  agentId?: string;
}

/**
 * Validator レジストリインタフェース
 */
export interface ValidatorRegistry {
  /** Validator 定義のマップ */
  validators: Record<
    string,
    import("../../common/completion-types.ts").ValidatorDefinition
  >;
  /** 完了パターンのマップ */
  completionPatterns?: Record<
    string,
    import("../../common/completion-types.ts").CompletionPattern
  >;
}

/**
 * 単一 Validator の実行結果
 */
export interface ValidatorRunResult {
  /** 検証成功フラグ */
  valid: boolean;
  /** 抽出されたパラメータ */
  params?: Record<string, unknown>;
  /** エラーメッセージ */
  error?: string;
}

/**
 * パラメータ抽出関数のシグネチャ
 */
export type ExtractorFunction = (
  stdout: string,
  stderr: string,
  exitCode: number,
) => unknown;

/**
 * 抽出関数のレジストリ型
 */
export type ExtractorRegistry = Map<string, ExtractorFunction>;
