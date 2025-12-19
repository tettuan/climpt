# Skill 仕様 (delegate-climpt-agent)

`delegate-climpt-agent` Skill の技術仕様を説明します。

## SKILL.md 構造

### Frontmatter

```yaml
---
name: delegate-climpt-agent
description: Delegates development tasks to Climpt Agent. Use when user asks to perform git operations, create instructions, manage branches, generate frontmatter, or any development workflow that matches Climpt commands.
---
```

#### フィールド

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Skill 識別子 (最大64文字、小文字・数字・ハイフンのみ) |
| `description` | string | Yes | Skill の発動条件を記述 (最大1024文字) |

### Description の設計指針

`description` は Claude が Skill を発動するかどうかを判断する重要なフィールドです：

1. **具体的なユースケースを列挙**: git operations, branch management, frontmatter generation など
2. **アクション動詞を使用**: "delegates", "use when user asks" など
3. **ドメイン固有の用語を含める**: Climpt, git commits, PR workflows など

## ワークフロー

### Step 1: コマンド検索

```
mcp__climpt__search({
  "query": "<ユーザーの意図>",
  "agent": "climpt"
})
```

**パラメータ:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | 自然言語での検索クエリ |
| `agent` | string | Yes | 常に `"climpt"` |

**レスポンス:**

```json
[
  {
    "c1": "climpt-git",
    "c2": "group-commit",
    "c3": "unstaged-changes",
    "description": "Group file changes by semantic proximity...",
    "score": 0.85
  }
]
```

### Step 2: コマンド詳細取得

```
mcp__climpt__describe({
  "agent": "climpt",
  "c1": "climpt-git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
})
```

**パラメータ:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | Yes | 常に `"climpt"` |
| `c1` | string | Yes | ドメイン識別子 |
| `c2` | string | Yes | アクション識別子 |
| `c3` | string | Yes | ターゲット識別子 |

**レスポンス:**

```json
{
  "c1": "climpt-git",
  "c2": "group-commit",
  "c3": "unstaged-changes",
  "description": "Group file changes by semantic proximity...",
  "usage": "climpt-git group-commit unstaged-changes",
  "options": {
    "edition": ["default"],
    "adaptation": ["default", "detailed"],
    "file": true,
    "stdin": false,
    "destination": true
  }
}
```

### Step 3: コマンド実行

```
mcp__climpt__execute({
  "agent": "climpt",
  "c1": "climpt-git",
  "c2": "group-commit",
  "c3": "unstaged-changes",
  "options": {}
})
```

**パラメータ:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | Yes | 常に `"climpt"` |
| `c1` | string | Yes | ドメイン識別子 |
| `c2` | string | Yes | アクション識別子 |
| `c3` | string | Yes | ターゲット識別子 |
| `options` | object | No | コマンドオプション |

**レスポンス:**

指示ドキュメント（プロンプト）がテキストとして返されます。

## C3L 命名規則

Commands follow the C3L (Command 3-Level) naming convention:

### レベル定義

| Level | Description | Pattern | Examples |
|-------|-------------|---------|----------|
| `c1` | ドメイン識別子 | `climpt-<domain>` | `climpt-git`, `climpt-meta` |
| `c2` | アクション識別子 | `<verb>-<modifier>?` | `group-commit`, `build`, `create` |
| `c3` | ターゲット識別子 | `<noun>-<qualifier>?` | `unstaged-changes`, `frontmatter` |

### 命名パターン

**Sub-agent 名生成:**

```
<c1>-<c2>-<c3>
```

**例:**

| c1 | c2 | c3 | Sub-agent Name |
|----|----|----|----------------|
| `climpt-git` | `group-commit` | `unstaged-changes` | `climpt-git-group-commit-unstaged-changes` |
| `climpt-meta` | `build` | `frontmatter` | `climpt-meta-build-frontmatter` |
| `climpt-meta` | `create` | `instruction` | `climpt-meta-create-instruction` |

## 発動条件

Skill は以下の条件で自動発動します：

1. **Git 操作関連**
   - 「コミットして」「変更をまとめて」
   - 「ブランチを決めて」「ブランチを整理して」
   - 「PRを確認して」「マージして」

2. **Meta 操作関連**
   - 「frontmatter を生成して」
   - 「instruction を作成して」

3. **一般的なワークフロー**
   - 「開発フローを実行して」
   - 「Climpt コマンドを実行して」

## エラーハンドリング

### 検索結果なし

```markdown
Climpt コマンドが見つかりませんでした。
- クエリを別の表現で試してください
- `mcp__climpt__reload` でレジストリを更新してください
```

### 実行エラー

```markdown
コマンド実行に失敗しました: <error message>
- コマンドパラメータを確認してください
- Climpt CLI が正しくインストールされているか確認してください
```

## ベストプラクティス

1. **検索クエリは具体的に**: 「変更をコミット」より「意味的に近いファイルをグループ化してコミット」が精度向上
2. **複数候補がある場合**: スコアと description を比較して最適なコマンドを選択
3. **オプションの活用**: edition, adaptation などを適切に設定してカスタマイズ
