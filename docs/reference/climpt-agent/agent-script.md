# Agent Script 仕様 (climpt-agent.ts)

`climpt-agent.ts` の技術仕様を説明します。

## 概要

`climpt-agent.ts` は Claude Agent SDK を使用して動的に Sub-agent を生成・実行するスクリプトです。

## ファイル情報

- **パス**: `climpt-plugins/skills/delegate-climpt-agent/scripts/climpt-agent.ts`
- **ランタイム**: Deno 2.x
- **依存関係**: `npm:@anthropic-ai/claude-agent-sdk`

## コマンドラインインターフェース

### 使用方法

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  climpt-agent.ts \
  --agent=<name> \
  --c1=<c1> \
  --c2=<c2> \
  --c3=<c3> \
  [--options=<opt1,opt2,...>]
```

### パラメータ

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--agent` | Yes | MCP サーバー識別子 (例: `"climpt"`, `"inspector"`) |
| `--c1` | Yes | ドメイン識別子 (例: `git`, `meta`) |
| `--c2` | Yes | アクション識別子 (例: `group-commit`) |
| `--c3` | Yes | ターゲット識別子 (例: `unstaged-changes`) |
| `--options` | No | カンマ区切りのオプション |

### 実行例

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  climpt-agent.ts \
  --agent=climpt \
  --c1=git \
  --c2=group-commit \
  --c3=unstaged-changes
```

## 内部アーキテクチャ

### 処理フロー

```
1. コマンドライン引数パース
   ↓
2. パラメータ検証
   ↓
3. Sub-agent 名生成 (C3L 命名規則)
   ↓
4. Climpt CLI 実行 → プロンプト取得
   ↓
5. Claude Agent SDK で Sub-agent 実行
   ↓
6. メッセージストリーム処理
   ↓
7. 完了 or エラー報告
```

### 主要関数

#### generateSubAgentName

```typescript
function generateSubAgentName(cmd: ClimptCommand): string
```

C3L 命名規則に基づいて Sub-agent 名を生成します。形式: `<agent>-<c1>-<c2>-<c3>`

**入力:**

```typescript
{
  agent: "climpt",
  c1: "git",
  c2: "group-commit",
  c3: "unstaged-changes"
}
```

**出力:**

```
"climpt-git-group-commit-unstaged-changes"
```

#### getClimptPrompt

```typescript
async function getClimptPrompt(cmd: ClimptCommand): Promise<string>
```

Climpt CLI を実行して指示プロンプトを取得します。

**config パラメータ構築:**

C3L v0.5 仕様に基づき、config パラメータを構築します:
- `agent` が `"climpt"` の場合: `configParam = c1` (例: `"git"`)
- それ以外の場合: `configParam = ${agent}-${c1}` (例: `"inspector-git"`)

**実行されるコマンド:**

```bash
deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config \
  jsr:@aidevtool/climpt \
  --config=<configParam>
  <c2> \
  <c3>
```

**例:**
- agent=`climpt`, c1=`git`, c2=`group-commit`, c3=`unstaged-changes`
- → `--config=git group-commit unstaged-changes`

#### runSubAgent

```typescript
async function runSubAgent(agentName: string, prompt: string, cwd: string): Promise<void>
```

Claude Agent SDK を使用して Sub-agent を実行します。

## Claude Agent SDK 設定

### Options 設定

```typescript
const options: Options = {
  cwd: string,                    // 作業ディレクトリ
  settingSources: ["project"],    // プロジェクト設定を読み込み
  allowedTools: [                 // 許可するツール
    "Skill",
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "Task",
  ],
  systemPrompt: {
    type: "preset",
    preset: "claude_code",        // Claude Code のシステムプロンプト
  },
};
```

### 許可ツール一覧

| Tool | Description |
|------|-------------|
| `Skill` | 他の Skill を呼び出し |
| `Read` | ファイル読み取り |
| `Write` | ファイル書き込み |
| `Edit` | ファイル編集 |
| `Bash` | シェルコマンド実行 |
| `Glob` | ファイルパターンマッチ |
| `Grep` | テキスト検索 |
| `Task` | Sub-agent 起動 |

### SDKMessage 処理

```typescript
function handleMessage(message: SDKMessage): void
```

**メッセージタイプ:**

| Type | Subtype | Description |
|------|---------|-------------|
| `assistant` | - | アシスタントの応答テキスト |
| `result` | `success` | 正常完了、コスト情報含む |
| `result` | `error` | エラー発生、エラー詳細含む |
| `system` | `init` | セッション初期化、session_id, model 情報 |

## エラーハンドリング

### Climpt 実行エラー

```typescript
if (code !== 0) {
  const errorText = new TextDecoder().decode(stderr);
  throw new Error(`Climpt execution failed: ${errorText}`);
}
```

### パラメータ検証エラー

```typescript
if (!cmd.agent || !cmd.c1 || !cmd.c2 || !cmd.c3) {
  console.error("Usage: climpt-agent.ts --agent=<name> ...");
  Deno.exit(1);
}
```

### SDK エラー

```typescript
case "result":
  if (message.subtype !== "success") {
    console.error(`Error: ${message.subtype}`);
    if ("errors" in message) {
      console.error(message.errors.join("\n"));
    }
  }
```

## 出力形式

### 標準出力 (stdout)

Sub-agent のテキスト応答が出力されます。

### 標準エラー (stderr)

実行ステータスとメタ情報が出力されます：

```
Generated sub-agent name: climpt-git-group-commit-unstaged-changes
Fetching prompt for: climpt-git group-commit unstaged-changes
Starting sub-agent: climpt-git-group-commit-unstaged-changes
Session: abc123, Model: claude-3-opus
Completed. Cost: $0.0150
```

## Deno 権限

スクリプト実行に必要な権限：

| Permission | Reason |
|------------|--------|
| `--allow-read` | ファイル読み取り |
| `--allow-write` | ファイル書き込み |
| `--allow-net` | API 通信 |
| `--allow-env` | 環境変数アクセス |
| `--allow-run` | Climpt CLI 実行 |

## 依存関係

### npm パッケージ

```typescript
import { query } from "npm:@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "npm:@anthropic-ai/claude-agent-sdk";
```

### JSR パッケージ

Climpt CLI は jsr 経由で実行：

```bash
deno run jsr:@aidevtool/climpt
```

## テスト方法

### 単体テスト

```bash
# パラメータ解析テスト
deno run climpt-agent.ts --agent=climpt --c1=climpt-git --c2=group-commit --c3=unstaged-changes
```

### 統合テスト

```bash
# 実際の Climpt コマンド実行
deno run --allow-all climpt-agent.ts \
  --agent=climpt \
  --c1=climpt-git \
  --c2=group-commit \
  --c3=unstaged-changes
```
