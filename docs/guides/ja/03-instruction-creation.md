[English](../en/03-instruction-creation.md) |
[日本語](../ja/03-instruction-creation.md)

# 3. 指示書（プロンプト）の作成方法

Climpt で使用する指示書（プロンプトファイル）の作成方法を説明します。

## 目次

1. [指示書とは](#31-指示書とは)
2. [作成の流れ](#32-作成の流れ)
3. [Step 1: meta create instruction で指示書を作成](#33-step-1-meta-create-instruction-で指示書を作成)
4. [Step 2: meta build frontmatter でフロントマターを生成](#34-step-2-meta-build-frontmatter-でフロントマターを生成)
5. [Step 3: レジストリの更新](#35-step-3-レジストリの更新)
6. [指示書の構造](#36-指示書の構造)
7. [実践例](#37-実践例)

---

## 3.1 指示書とは

指示書は、AI に対する指示を定義したマークダウンファイルです。 C3L（Climpt 3-word
Language）仕様に従って、3つの要素で構成されます：

| 要素             | 役割         | 例                                      |
| ---------------- | ------------ | --------------------------------------- |
| c1（ドメイン）   | 対象領域     | `git`, `code`, `meta`, `test`           |
| c2（アクション） | 実行する動作 | `create`, `analyze`, `review`           |
| c3（ターゲット） | 対象物       | `branch`, `pull-request`, `instruction` |

コマンド形式：

```bash
climpt-<c1> <c2> <c3> [options]
```

例：

```bash
climpt-git decide-branch working-branch
climpt-meta create instruction
climpt-code review pull-request
```

---

## 3.2 作成の流れ

```
┌─────────────────────────────────────────────────────────────┐
│                    指示書作成フロー                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1: meta create instruction                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 目的・ドメイン・アクション・ターゲットを入力        │   │
│  │ → プロンプトファイルの雛形を生成                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│  Step 2: meta build frontmatter                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ C3L v0.5 準拠のフロントマターを生成                 │   │
│  │ → YAML形式でファイル先頭に挿入                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│  Step 3: レジストリ更新 (/reg)                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ プロンプトから registry.json を再生成               │   │
│  │ → MCP/CLI でコマンドが利用可能に                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3.3 Step 1: meta create instruction で指示書を作成

### コマンド実行

Claude Code で以下を実行するか、Skill を呼び出します：

```bash
# 標準入力で情報を渡す
echo "Purpose: コードの複雑度を分析
Domain: code
Action: analyze
Target: complexity
Description: サイクロマティック複雑度を計算し改善提案を行う" | climpt-meta create instruction
```

または、heredoc を使用：

```bash
climpt-meta create instruction << 'EOF'
Purpose: コードの複雑度を分析
Domain: code
Action: analyze
Target: complexity
Description: サイクロマティック複雑度を計算し改善提案を行う
EOF
```

### Claude Code での Skill 呼び出し

Claude Code 内で自然言語で依頼することも可能です：

```
新しいClimpt指示書を作成してください。
- 目的: コードの複雑度分析
- ドメイン: code
- アクション: analyze
- ターゲット: complexity

meta create instruction を使ってください。
```

### 生成される内容

このコマンドにより、以下が生成されます：

1. ディレクトリ構造：
   ```
   .agent/climpt/prompts/code/analyze/complexity/
   ```

2. プロンプトファイル：
   ```
   .agent/climpt/prompts/code/analyze/complexity/f_default.md
   ```

3. 設定ファイル（必要に応じて）：
   ```
   .agent/climpt/config/code-app.yml
   .agent/climpt/config/code-user.yml
   ```

4. 実行ファイル（必要に応じて）：
   ```
   .deno/bin/climpt-code
   ```

---

## 3.4 Step 2: meta build frontmatter でフロントマターを生成

作成したプロンプトファイルに、C3L v0.5 準拠のフロントマターを生成します。

### コマンド実行

```bash
echo "Domain: code
Action: analyze
Target: complexity
Purpose: サイクロマティック複雑度を計算し改善提案を行う" | climpt-meta build frontmatter
```

### 生成されるフロントマター

```yaml
---
c1: code
c2: analyze
c3: complexity
title: Analyze Code Complexity
description: Calculate cyclomatic complexity and provide improvement suggestions
usage: climpt-code analyze complexity
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
    - detailed
  file: true
  stdin: false
  destination: false
---
```

### 重要なルール

- **すべてのフロントマター値は英語で記述**
- `c3l_version` は引用符で囲む: `"0.5"`
- `title` と `description` は英語で記述

### フロントマターの挿入

生成されたフロントマターをプロンプトファイルの先頭に挿入します：

```bash
# プロンプトファイルを編集
vim .agent/climpt/prompts/code/analyze/complexity/f_default.md
```

---

## 3.5 Step 3: レジストリの更新

プロンプトファイルを作成・更新したら、レジストリを再生成します。

### Claude Code での実行（推奨）

```
/reg
```

または：

```bash
deno task generate-registry
```

### JSR 経由での実行

```bash
deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg
```

### 実行結果

```
Registry generated successfully!
Updated: .agent/climpt/registry.json
Commands: 12 registered
```

### registry.json の確認

```bash
cat .agent/climpt/registry.json | jq '.tools.commands[] | select(.c1 == "code")'
```

新しいコマンドが登録されていれば成功です。

---

## 3.6 指示書の構造

### ファイル配置

```
.agent/climpt/prompts/<domain>/<action>/<target>/
├── f_default.md           # デフォルト版
├── f_detailed.md          # 詳細版（オプション）
└── f_<edition>.md         # その他のバリエーション
```

### ファイル命名規則

| ファイル名                    | 説明             | 使用条件                     |
| ----------------------------- | ---------------- | ---------------------------- |
| `f_default.md`                | デフォルト       | `--edition` 未指定時         |
| `f_<edition>.md`              | 特定エディション | `--edition=<edition>` 指定時 |
| `f_<edition>_<adaptation>.md` | 組み合わせ       | 両方指定時                   |

### テンプレート変数

プロンプト内で使用できる変数：

| 変数                 | CLI オプション        | 説明                   |
| -------------------- | --------------------- | ---------------------- |
| `{input_text}`       | STDIN                 | 標準入力からのテキスト |
| `{input_text_file}`  | `-f`, `--from`        | 入力ファイルパス       |
| `{destination_path}` | `-o`, `--destination` | 出力先パス             |
| `{uv-*}`             | `--uv-*`              | カスタム変数           |

### 例：テンプレート変数の使用

```markdown
# コード複雑度分析

## 対象ファイル

{input_text_file}

## 分析内容

{input_text}

## 出力先

結果を `{destination_path}` に保存してください。

## オプション

最大行数: {uv-max-lines}
```

---

## 3.7 実践例

### 例1: Git ブランチ判断コマンドの作成

```bash
# Step 1: 指示書作成
climpt-meta create instruction << 'EOF'
Purpose: タスク内容に基づいてブランチ戦略を決定
Domain: git
Action: decide-branch
Target: working-branch
Description: 新規ブランチを作成するか、現在のブランチで続行するかを判断
EOF

# Step 2: フロントマター生成（必要に応じて）
climpt-meta build frontmatter << 'EOF'
Domain: git
Action: decide-branch
Target: working-branch
Purpose: Decide branch strategy based on task content
EOF

# Step 3: レジストリ更新
deno task generate-registry
```

### 例2: コードレビューコマンドの作成

```bash
# Step 1: 指示書作成
climpt-meta create instruction << 'EOF'
Purpose: プルリクエストのコードレビューを実行
Domain: code
Action: review
Target: pull-request
Description: コード品質、バグ、改善点を分析してフィードバックを提供
EOF

# Step 2 & 3: フロントマター生成 + レジストリ更新
climpt-meta build frontmatter << 'EOF'
Domain: code
Action: review
Target: pull-request
Purpose: Review pull request code and provide feedback
EOF

deno task generate-registry
```

### 例3: ユーザー変数を使用するコマンド

```bash
# プロンプト内で {uv-target_language} を使用
climpt-meta create instruction << 'EOF'
Purpose: ソースコードを別の言語に変換
Domain: code
Action: convert
Target: source-file
Description: Translate source code to target programming language
User Variables:
  - target_language: 変換先の言語
  - style_guide: コーディングスタイル
EOF
```

フロントマターに `uv` フィールドが追加されます：

```yaml
options:
  edition:
    - default
  file: true
  stdin: false
  destination: true
uv:
  - target_language: Target programming language for conversion
  - style_guide: Code style guide to follow
```

使用方法：

```bash
climpt-code convert source-file -f=main.py --uv-target_language=typescript
```

---

## 確認チェックリスト

指示書作成後、以下を確認してください：

- [ ] プロンプトファイルが正しい場所に存在
  ```bash
  ls -la .agent/climpt/prompts/<domain>/<action>/<target>/
  ```

- [ ] フロントマターが正しい形式
  ```bash
  head -30 .agent/climpt/prompts/<domain>/<action>/<target>/f_default.md
  ```

- [ ] レジストリに登録されている
  ```bash
  cat .agent/climpt/registry.json | jq '.tools.commands[] | select(.c2 == "<action>")'
  ```

- [ ] コマンドが実行できる
  ```bash
  climpt-<domain> <action> <target> --help
  ```

---

## 次のステップ

[04-iterate-agent-setup.md](./04-iterate-agent-setup.md) へ進んで、Iterate Agent
を設定します。
