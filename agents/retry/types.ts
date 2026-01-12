/**
 * RetryHandler Types
 *
 * リトライプロンプト生成のための型定義。
 */

import type { Logger } from "../src_common/logger.ts";

// Re-export common types
export type {
  CompletionPattern,
  StepConfigV3,
  StepsRegistryV3,
  ValidationResultV3,
} from "../common/completion-types.ts";

/**
 * RetryHandler のコンテキスト
 */
export interface RetryHandlerContext {
  /** 作業ディレクトリ */
  workingDir: string;
  /** ロガー */
  logger: Logger;
  /** Agent ID */
  agentId: string;
}

/**
 * C3L パス解決オプション
 */
export interface C3LResolveOptions {
  /** C3L c1 コンポーネント */
  c1: string;
  /** C3L c2 コンポーネント */
  c2: string;
  /** C3L c3 コンポーネント */
  c3: string;
  /** C3L edition コンポーネント */
  edition: string;
  /** C3L adaptation コンポーネント（オプション） */
  adaptation?: string;
}

/**
 * リトライプロンプト生成結果
 */
export interface RetryPromptResult {
  /** 生成されたプロンプト */
  prompt: string;
  /** 使用したパターン */
  pattern: string;
  /** 注入されたパラメータ */
  params: Record<string, unknown>;
}
