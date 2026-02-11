[English](../en/03-instruction-creation.md) |
[日本語](../ja/03-instruction-creation.md)

# 3. 指示書（プロンプト）の作成方法

Climpt で使用する指示書（プロンプトファイル）の作成方法を説明します。

## 3.1 指示書とは

指示書は、AI に対する指示を定義したマークダウンファイルです。 C3L（Climpt 3-word
Language）仕様に従って、3つの要素で構成されます：

| 要素             | 役割         | 例                                      |
| ---------------- | ------------ | --------------------------------------- |
| c1（ドメイン）   | 対象領域     | `git`, `code`, `meta`, `test`           |
| c2（アクション） | 実行する動作 | `create`, `analyze`, `review`           |
| c3（ターゲット） | 対象物       | `branch`, `pull-request`, `instruction` |

コマンド形式： `climpt-<c1> <c2> <c3> [options]`

例： `climpt-git decide-branch working-branch`、`climpt-meta create instruction`

---

## 3.2 作成の流れ

1. **Step 1**: `meta create instruction` —
   目的・ドメイン等を入力し、プロンプトファイルの雛形を生成
2. **Step 2**: `meta build frontmatter` — C3L v0.5
   準拠のフロントマターを生成し、ファイル先頭に挿入
3. **Step 3**: `/reg` でレジストリ更新 — プロンプトから registry.json
   を再生成し、MCP/CLI で利用可能に

---

## 3.3 Step 1: meta create instruction で指示書を作成

### コマンド実行

Claude Code で以下を実行するか、Skill を呼び出します：

```bash
climpt-meta create instruction << 'EOF'
Purpose: コードの複雑度を分析
Domain: code
Action: analyze
Target: complexity
Description: サイクロマティック複雑度を計算し改善提案を行う
EOF
```

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

1. ディレクトリ: `.agent/climpt/prompts/code/analyze/complexity/`
2. プロンプトファイル: `f_default.md`
3. 設定ファイル（必要に応じて）: `code-app.yml`, `code-user.yml`
4. 実行ファイル（必要に応じて）: `.deno/bin/climpt-code`

---

## 3.4 Step 2: meta build frontmatter でフロントマターを生成

作成したプロンプトファイルに、C3L v0.5 準拠のフロントマターを生成します。

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

生成されたフロントマターをプロンプトファイルの先頭に挿入してください。

---

## 3.5 Step 3: レジストリの更新

プロンプトファイルを作成・更新したら、レジストリを再生成します。

```
/reg
```

または `deno task generate-registry`、JSR 経由:
`deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg`

新しいコマンドが登録されたか確認：

```bash
cat .agent/climpt/registry.json | jq '.tools.commands[] | select(.c1 == "code")'
```

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

```bash
# Step 1: 指示書作成
climpt-meta create instruction << 'EOF'
Purpose: タスク内容に基づいてブランチ戦略を決定
Domain: git
Action: decide-branch
Target: working-branch
Description: 新規ブランチを作成するか、現在のブランチで続行するかを判断
EOF

# Step 2: フロントマター生成
climpt-meta build frontmatter << 'EOF'
Domain: git
Action: decide-branch
Target: working-branch
Purpose: Decide branch strategy based on task content
EOF

# Step 3: レジストリ更新
deno task generate-registry
```

ユーザー変数が必要な場合は、プロンプト内で `{uv-変数名}` を使用し、CLI で
`--uv-変数名=値` を指定します。フロントマターの `uv`
フィールドに変数を宣言してください。
