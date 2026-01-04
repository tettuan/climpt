# agents/common

Iterator / Reviewer Agent 間で共有するユーティリティモジュール。

## モジュール構成

```
agents/common/
├── mod.ts              # エクスポート
├── types.ts            # 共通型定義
├── logger.ts           # ロガーユーティリティ
├── worktree.ts         # Worktree 操作
├── worktree_test.ts    # Worktree テスト
├── merge.ts            # マージ操作
└── merge_test.ts       # マージテスト
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

### worktree.ts

Git worktree 操作ユーティリティ。Agent 実行を分離環境で行うための機能を提供。

```typescript
import {
  cleanupWorktree,
  createWorktree,
  generateBranchName,
  getCurrentBranch,
  removeWorktree,
  setupWorktree,
} from "../common/worktree.ts";

// Worktree セットアップ（自動ブランチ生成）
const result = await setupWorktree(
  { forceWorktree: true, worktreeRoot: "../worktree" },
  { branch: "feature/docs", baseBranch: "develop" },
);
// result.worktreePath: /path/to/worktree/feature-docs
// result.branchName: feature/docs
// result.baseBranch: develop
// result.created: true

// 個別操作
const branch = await getCurrentBranch();
const newBranch = generateBranchName("feature/docs"); // feature/docs-20260105-143022
await createWorktree("/path/to/worktree", "new-branch", "main");
await removeWorktree("/path/to/worktree");
```

### merge.ts

ブランチマージ操作ユーティリティ。Agent 完了後の統合処理を提供。

```typescript
import {
  createPullRequest,
  ITERATOR_MERGE_ORDER,
  mergeBranch,
  pushBranch,
  REVIEWER_MERGE_ORDER,
} from "../common/merge.ts";

// 戦略順にマージ試行（失敗時は次の戦略を試行）
const result = await mergeBranch(
  "feature/docs",
  "develop",
  ITERATOR_MERGE_ORDER, // squash → ff → merge
);

if (result.success) {
  console.log(`Merged with ${result.strategy}`);
} else {
  // コンフリクト発生時は PR 作成
  console.log(`Conflict: ${result.conflictFiles?.join(", ")}`);
  await pushBranch("feature/docs");
  await createPullRequest("Merge feature/docs", "...", "develop");
}

// マージ戦略順序
ITERATOR_MERGE_ORDER; // ["squash", "fast-forward", "merge-commit"]
REVIEWER_MERGE_ORDER; // ["fast-forward", "squash", "merge-commit"]
```

### Worktree 関連型定義 (types.ts)

| 型                    | 説明                                                    |
| --------------------- | ------------------------------------------------------- |
| `WorktreeConfig`      | Worktree 設定 (forceWorktree, worktreeRoot)             |
| `WorktreeCLIOptions`  | CLI オプション (branch, baseBranch)                     |
| `WorktreeSetupResult` | セットアップ結果 (path, branch, baseBranch)             |
| `MergeStrategy`       | マージ戦略 ("squash" / "fast-forward" / "merge-commit") |
| `MergeResult`         | マージ結果 (success, strategy, error, conflictFiles)    |

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
