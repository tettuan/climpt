/**
 * Completion Validation Types (V3)
 *
 * 完了条件検証と部分リトライのための型定義。
 * 既存の validators/ システムと連携して動作する。
 */

import type { StepRegistry } from "./step-registry.ts";

// ============================================================================
// CompletionPattern - C3L連携のための失敗パターン定義
// ============================================================================

/**
 * 失敗パターン定義
 * パターン名からC3Lプロンプトパスへのマッピングを提供
 */
export interface CompletionPattern {
  /** パターンの説明 */
  description: string;
  /** C3L edition (e.g., "failed") */
  edition: string;
  /** C3L adaptation (e.g., "git-dirty") */
  adaptation: string;
  /** リトライプロンプトに注入するパラメータ名 */
  params: string[];
}

// ============================================================================
// ValidatorDefinition - JSON定義可能なValidator仕様
// ============================================================================

/**
 * Validator の成功条件
 *
 * - "empty": 出力が空（git status --porcelain が空）
 * - "exitCode:N": 終了コードがN
 * - "contains:STRING": 出力に文字列を含む
 * - "matches:REGEX": 出力が正規表現にマッチ
 */
export type SuccessCondition =
  | "empty"
  | `exitCode:${number}`
  | `contains:${string}`
  | `matches:${string}`;

/**
 * パラメータ抽出ルール名
 */
export type ExtractorType =
  | "parseChangedFiles"
  | "parseUntrackedFiles"
  | "parseTestOutput"
  | "parseTypeErrors"
  | "parseLintErrors"
  | "parseFormatOutput"
  | "extractFiles"
  | "generateDiff"
  | "stderr"
  | "stdout"
  | "exitCode"
  | "missingPaths"
  | "expectedPath";

/**
 * Validator タイプ
 */
export type ValidatorType = "command" | "file" | "custom";

/**
 * Validator の宣言的定義（JSON形式）
 *
 * 実行ロジックは CompletionValidator が担当する。
 */
export interface ValidatorDefinition {
  /** Validator タイプ */
  type: ValidatorType;
  /** command タイプの場合: 実行コマンド */
  command?: string;
  /** file タイプの場合: チェック対象パス */
  path?: string;
  /** 成功条件 */
  successWhen: SuccessCondition;
  /** 失敗時のパターン名（completionPatterns のキー） */
  failurePattern: string;
  /** パラメータ抽出ルール */
  extractParams: Record<string, ExtractorType | string>;
}

// ============================================================================
// CompletionCondition - ステップの完了条件
// ============================================================================

/**
 * 単一の完了条件
 */
export interface CompletionCondition {
  /** validator ID または validators のキー */
  validator: string;
  /** validator へのオプショナルパラメータ */
  params?: Record<string, unknown>;
}

/**
 * 失敗時のアクション
 */
export type FailureAction = "retry" | "abort" | "skip";

/**
 * 失敗時のアクション定義
 */
export interface OnFailureConfig {
  /** 失敗時のアクション */
  action: FailureAction;
  /** retry の場合の最大試行回数 */
  maxAttempts?: number;
}

// ============================================================================
// StepConfigV3 - V3 ステップ設定
// ============================================================================

/**
 * V3 ステップ設定
 *
 * 完了条件とリトライ設定を含む拡張版のステップ定義。
 */
export interface StepConfigV3 {
  /** ステップID */
  stepId: string;
  /** 表示名 */
  name: string;
  /** C3L path component: c2 (retry, complete, etc.) */
  c2: string;
  /** C3L path component: c3 (issue, project, etc.) */
  c3: string;
  /** 完了条件の配列（AND条件） */
  completionConditions: CompletionCondition[];
  /** 失敗時の動作 */
  onFailure: OnFailureConfig;
  /** 説明 */
  description?: string;
}

// ============================================================================
// ValidationResult (V3拡張)
// ============================================================================

/**
 * V3 検証結果
 *
 * パターンとパラメータを含む拡張版の検証結果。
 */
export interface ValidationResultV3 {
  /** 検証成功/失敗 */
  valid: boolean;
  /** 失敗時のパターン名 */
  pattern?: string;
  /** 抽出されたパラメータ（リトライプロンプト注入用） */
  params?: Record<string, unknown>;
  /** エラーメッセージ */
  error?: string;
  /** 詳細情報 */
  details?: string[];
}

// ============================================================================
// StepsRegistryV3 - 統合レジストリ
// ============================================================================

/**
 * V3 Steps Registry
 *
 * 既存の StepRegistry を拡張し、completionPatterns と validators を追加。
 */
export interface StepsRegistryV3 extends StepRegistry {
  /** 失敗パターン定義 */
  completionPatterns?: Record<string, CompletionPattern>;

  /** Validator 定義 */
  validators?: Record<string, ValidatorDefinition>;

  /** V3 ステップ設定（completionConditions 付き） */
  stepsV3?: Record<string, StepConfigV3>;
}

// ============================================================================
// 型ガード
// ============================================================================

/**
 * V3 ステップ設定かどうか判定
 */
export function isStepConfigV3(
  step: unknown,
): step is StepConfigV3 {
  return (
    typeof step === "object" &&
    step !== null &&
    "completionConditions" in step &&
    Array.isArray((step as StepConfigV3).completionConditions)
  );
}

/**
 * V3 レジストリかどうか判定
 */
export function isRegistryV3(
  registry: unknown,
): registry is StepsRegistryV3 {
  return (
    typeof registry === "object" &&
    registry !== null &&
    ("completionPatterns" in registry || "validators" in registry)
  );
}

/**
 * 検証結果からパターンを取得
 */
export function getPatternFromResult(
  result: ValidationResultV3,
): string | undefined {
  return result.pattern;
}

// ============================================================================
// コマンド実行結果
// ============================================================================

/**
 * コマンド実行結果
 */
export interface CommandResult {
  /** 成功フラグ */
  success: boolean;
  /** 終了コード */
  exitCode: number;
  /** 標準出力 */
  stdout: string;
  /** 標準エラー出力 */
  stderr: string;
}
