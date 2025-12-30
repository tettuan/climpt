---
name: delegate-climpt-agent
description: Use when user mentions 'climpt' or 'climpt-agent', or gives project-specific instructions where general knowledge is insufficient. Climpt provides pre-configured prompts tailored to the project's workflow.
---

# Delegate Climpt Agent

Climpt コマンドレジストリを通じた開発タスク委譲。Claude Agent SDK でサブエージェントを起動する。

## Input Components

| Component | Purpose | Passed via | Used for |
|-----------|---------|------------|----------|
| **action** | 何をするか | `--action` arg | コマンド検索 (c2) |
| **target** | 何に対して | `--target` arg | コマンド検索 (c3) |
| **intent** | 実行意図 | `--intent` arg | LLM オプション解決 |
| **content** | 詳細データ | stdin pipe | climpt へ直接渡す |

```
User Request
    │
    ├─► action ──────► Command Search ──► Match climpt command
    ├─► target ──────►     (RRF)
    │
    ├─► intent ──────► Option Resolution ──► CLI args (e.g., -e=feature)
    │                        (LLM)
    │
    └─► content ─────► stdin ──────────────► Climpt command input
         (pipe)
```

## Workflow

### Step 1: action, target, intent を作成

| パラメータ | 形式 | 例 |
|-----------|------|-----|
| action | 動詞中心 ~6語 | "run execute test verify" |
| target | 名詞中心 ~6語 | "specific file unit test" |
| intent | 任意言語 1-2文 | "options-prompt.ts をテスト" |

### Step 2: スクリプト実行

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  -- ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
  --action="<verbs>" --target="<nouns>" [--intent="<description>"]
```

**Sandbox**: `dangerouslyDisableSandbox: true` 必須

### Step 3: stdin でコンテンツを渡す（該当時のみ）

stdin を使う場面: コミット（diff）、ドキュメント生成（コンテキスト）、コード生成（仕様）
stdin を使わない場面: テスト実行、ファイル検索

```bash
# intent = オプション解決用の短い説明
# stdin = climpt に渡す実データ
git diff --staged | deno run ... -- <script.ts> \
  --action="commit save stage changes" \
  --target="unstaged changes semantic group" \
  --intent="新機能追加のコミット"
```

## When to Use

プロジェクト固有の指示で、一般知識では対応が不明な場合に使用。

## Error Handling

| エラー | 対処 |
|-------|------|
| 検索結果なし | クエリを言い換えて再試行 |
| スクリプト失敗 | Deno/Claude Agent SDK/権限を確認 |
| "Import directory failed" | `deno.json` に `"nodeModulesDir": "auto"` を追加 |
