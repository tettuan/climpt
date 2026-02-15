---
name: test-investigation
description: Use when investigating test failures, tracing test behavior, or needing visibility into test execution. Delegates to sub agent. Examples: "テストが失敗した", "test failed", "テストの中身を見たい", "trace test", "テスト調査", "investigate test", "デバッグ", "debug test".
allowed-tools: [Read, Glob, Grep, Write, Edit, Bash]
---

# BreakdownLogger

`@tettuan/breakdownlogger` はテスト専用のデバッグロガー。テストファイル (`*_test.ts`, `*.test.ts`) からの呼び出し時のみ出力し、本番コードからは何も出力しない。

## 基本使用法

```typescript
import { BreakdownLogger } from "@tettuan/breakdownlogger";

const logger = new BreakdownLogger("component-name");

Deno.test("example", () => {
  logger.debug("detailed trace", { key: "value" });
  logger.info("general info");
  logger.warn("potential issue");
  logger.error("failure details", errorObj);
});
```

## 環境変数

テスト実行時に環境変数で出力を制御する。コード変更不要。

| 変数 | 値 | 用途 |
|------|-----|------|
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | 表示する最低レベル（デフォルト: info） |
| `LOG_LENGTH` | `S`(160), `L`(300), `W`(全文) | メッセージ切り詰め長（デフォルト: 80文字） |
| `LOG_KEY` | カンマ区切りキー名 | 指定キーのロガーのみ表示 |

### 実行例

```bash
# 全デバッグログを表示
LOG_LEVEL=debug deno test --allow-read --allow-env tests/

# 特定コンポーネントのみ、全文表示
LOG_KEY=parser,resolver LOG_LENGTH=W deno test --allow-read --allow-env tests/

# エラーのみ表示
LOG_LEVEL=error deno test --allow-read --allow-env tests/
```

## API

| メソッド | 出力先 | LOG_LEVEL による制御 |
|---------|--------|---------------------|
| `debug(msg, data?)` | stdout | `debug` 時のみ |
| `info(msg, data?)` | stdout | `debug`, `info` 時 |
| `warn(msg, data?)` | stdout | `debug`, `info`, `warn` 時 |
| `error(msg, data?)` | stderr | 常に出力 |

## キー命名規則

このプロジェクトでは以下のパターンを推奨:

```typescript
// モジュール名で分類
new BreakdownLogger("parser");
new BreakdownLogger("resolver");
new BreakdownLogger("agent-runner");

// テストファイル内でスコープを絞る場合
new BreakdownLogger("parser/tokenize");
```

## 実行方針

このスキルの作業（ロガー追加・テスト実行）は **sub agent へ委譲** してメインコンテキストを節約すること。

- テストファイルへのロガー追加 → `general-purpose` sub agent で対象ファイル群を一括編集
- テスト実行・デバッグ → `Bash` sub agent で `LOG_LEVEL=debug deno test ...` を実行

## 注意事項

- テストファイル以外から呼び出しても何も出力されない（安全装置）
- `--allow-env` パーミッションが必要（環境変数読み取り）
- 非テストファイルでの誤用検出: `deno run --allow-read jsr:@tettuan/breakdownlogger/validate ./src`
- 本プロジェクトの独自ロガー (`agents/common/logger.ts` 等) とは別物。BreakdownLogger はテストデバッグ専用
