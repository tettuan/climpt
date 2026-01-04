# agents/common

Iterator / Reviewer Agent 間で共有するユーティリティモジュール。

## モジュール構成

```
agents/common/
├── mod.ts           # エクスポート
├── types.ts         # 共通型定義
├── logger.ts        # ロガーユーティリティ
├── worktree.ts      # Worktree 操作 (予定)
└── merge.ts         # マージ操作 (予定)
```

## 現在のモジュール

### types.ts

Agent 間で共有する型定義。

| 型                     | 説明                          |
| ---------------------- | ----------------------------- |
| `AgentName`            | Agent 名                      |
| `PermissionMode`       | Claude Agent SDK の権限モード |
| `LogLevel`             | ログレベル                    |
| `LogEntry`             | JSONL ログエントリ構造        |
| `GitHubIssue`          | GitHub Issue データ           |
| `BaseAgentConfig`      | Agent 基本設定                |
| `LoggingConfig`        | ロギング設定                  |
| `BaseIterationSummary` | イテレーション結果サマリー    |

### logger.ts

JSONL 形式でのログ出力ユーティリティ。

```typescript
import { createLogger } from "./logger.ts";

const logger = await createLogger(config, "iterator");
logger.info("Agent started", { iteration: 1 });
logger.error("Failed", { error: { name: "Error", message: "..." } });
```

## 計画中のモジュール

### worktree.ts

Git worktree 操作ユーティリティ。

```typescript
// 予定 API
setupWorktree(config, options); // Worktree セットアップ
getCurrentBranch(); // 現在ブランチ取得
generateBranchName(base); // タイムスタンプ付きブランチ名生成
createWorktree(path, branch); // Worktree 作成
removeWorktree(path); // Worktree 削除
```

### merge.ts

ブランチマージ操作ユーティリティ。

```typescript
// 予定 API
mergeBranch(source, target, strategies); // 戦略順にマージ試行

// マージ戦略順序
ITERATOR_MERGE_ORDER; // squash → ff → merge
REVIEWER_MERGE_ORDER; // ff → squash → merge
```

## 設計資料

- [Worktree 統合設計書](../../docs/internal/worktree-design.md)
- [Iterator Agent 設計書](../../docs/internal/iterate-agent-design.md)

## 使用方法

```typescript
// mod.ts からインポート
import { type GitHubIssue, type LogEntry } from "../common/mod.ts";

// 個別インポート
import { createLogger } from "../common/logger.ts";
import type { BaseAgentConfig } from "../common/types.ts";
```
