[English](../en/08-prompt-structure.md) | [日本語](../ja/08-prompt-structure.md)

# 8. プロンプト構造編

プロンプトファイルの構造、手動作成方法、テンプレート変数の仕組みを説明します。

## 8.1 プロンプトファイルの基本

### ファイル配置

```
.agent/climpt/prompts/{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md
```

例：

```
.agent/climpt/prompts/git/decide-branch/working-branch/f_default.md
.agent/climpt/prompts/code/review/pull-request/f_detailed.md
.agent/climpt/prompts/meta/create/instruction/f_default_strict.md
```

### ファイル構造

プロンプトファイルは2つの部分で構成されます：

```markdown
---
# フロントマター（YAML形式のメタデータ）
c1: git
c2: decide-branch
c3: working-branch
title: Decide Working Branch
description: Decide branch strategy based on task content
---

# プロンプト本文（Markdown）

ここにAIへの指示を記述します。 テンプレート変数を使用できます： {input_text}
{destination_path}
```

### ファイル命名規則

| ファイル名                    | 説明             | 選択条件              |
| ----------------------------- | ---------------- | --------------------- |
| `f_default.md`                | デフォルト       | オプション未指定時    |
| `f_{edition}.md`              | エディション指定 | `--edition={edition}` |
| `f_{edition}_{adaptation}.md` | 両方指定         | 両オプション指定時    |

---

## 8.2 フロントマターの書き方

### 必須フィールド

```yaml
---
c1: code                           # ドメイン
c2: analyze                        # アクション
c3: complexity                     # ターゲット
title: Analyze Code Complexity     # タイトル（英語）
---
```

### 推奨フィールド

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
    - detailed
  adaptation:
    - default
    - strict
  file: true
  stdin: true
  destination: true
---
```

### フィールド説明

| フィールド            | 型       | 必須   | 説明             |
| --------------------- | -------- | ------ | ---------------- |
| `c1`                  | string   | はい   | ドメイン         |
| `c2`                  | string   | はい   | アクション       |
| `c3`                  | string   | はい   | ターゲット       |
| `title`               | string   | はい   | タイトル（英語） |
| `description`         | string   | いいえ | 説明（英語）     |
| `usage`               | string   | いいえ | 使用例           |
| `c3l_version`         | string   | いいえ | C3L バージョン   |
| `options.edition`     | string[] | いいえ | エディション一覧 |
| `options.adaptation`  | string[] | いいえ | 処理モード一覧   |
| `options.file`        | boolean  | いいえ | ファイル入力対応 |
| `options.stdin`       | boolean  | いいえ | STDIN 対応       |
| `options.destination` | boolean  | いいえ | 出力先対応       |
| `uv`                  | array    | いいえ | ユーザー変数定義 |

### 重要なルール

- **すべての値は英語で記述**
- `c3l_version` は引用符で囲む: `"0.5"`
- `c1`, `c2`, `c3` は小文字とハイフンのみ

---

## 8.3 テンプレート変数

### 利用可能な変数

| 変数                 | CLI オプション        | 説明                   |
| -------------------- | --------------------- | ---------------------- |
| `{input_text}`       | STDIN                 | 標準入力からのテキスト |
| `{input_text_file}`  | `-f`, `--from`        | 入力ファイルのパス     |
| `{destination_path}` | `-o`, `--destination` | 出力先パス             |
| `{uv-*}`             | `--uv-*`              | ユーザー定義変数       |

### 使用例

プロンプトファイル：

```markdown
# コード分析

## 対象ファイル

{input_text_file}

## 入力内容
```

{input_text}

```
## 出力先
{destination_path}
```

CLI 実行：

```bash
echo "function test() { return 1; }" | \
  climpt-code analyze complexity \
  -f=./src/main.ts \
  -o=./output/result.md
```

テンプレート変数は CLI 入力の値で置換され、最終プロンプトが出力されます。

---

## 8.4 ユーザー変数（uv）

### フロントマターでの宣言

```yaml
---
c1: code
c2: convert
c3: source-file
title: Convert Source File
options:
  edition:
    - default
  file: true
  stdin: true
  destination: true
uv:
  - target_language: Target programming language for conversion
  - style_guide: Code style guide to follow (optional)
---
```

### プロンプト本文での使用

```markdown
# コード変換

入力コードを **{uv-target_language}** に変換してください。

## スタイルガイド

{uv-style_guide}

## 入力コード
```

{input_text}

```
```

### CLI での指定

```bash
echo "def hello(): print('Hello')" | \
  climpt-code convert source-file \
  --uv-target_language=typescript \
  --uv-style_guide=airbnb
```

### uv フィールドの形式

```yaml
uv:
  - variable_name: Description of the variable
  - another_var: Another description
```

- 変数名はスネークケース（`target_language`）
- プロンプト内では `{uv-target_language}` で参照
- CLI では `--uv-target_language=value` で指定

---

## 8.5 プロンプトの手動作成手順

`meta create instruction` を使わずに手動で作成する方法です。

### Step 1: ディレクトリとファイルを作成

```bash
mkdir -p .agent/climpt/prompts/code/analyze/complexity
touch .agent/climpt/prompts/code/analyze/complexity/f_default.md
```

### Step 2: フロントマターとプロンプト本文を記述

ファイルの先頭にフロントマター（c1, c2, c3, title
等）を記述し、続けてプロンプト本文を記述します。新規ドメインの場合は
`{domain}-app.yml`
と実行ファイル（`.deno/bin/climpt-{domain}`）も作成してください。

### Step 3: レジストリ更新と動作確認

```bash
deno task generate-registry
climpt-{domain} {action} {target} --help
```

---

## 8.6 エディションとアダプテーション

### 概念

| 概念       | 説明             | 例                                         |
| ---------- | ---------------- | ------------------------------------------ |
| edition    | 入力の種類・用途 | `default`, `bug`, `feature`, `refactor`    |
| adaptation | 処理の詳細度     | `default`, `detailed`, `strict`, `minimal` |

### ファイル選択の優先順位

```
--edition=bug --adaptation=detailed の場合:

1. f_bug_detailed.md  <- 最優先
2. f_bug.md
3. f_default_detailed.md
4. f_default.md       <- 最後のフォールバック
```

### 使用例

```bash
# デフォルト
climpt-code review pull-request

# バグ修正向けエディション
climpt-code review pull-request --edition=bug

# 詳細な処理モード
climpt-code review pull-request --adaptation=detailed

# 両方指定
climpt-code review pull-request --edition=bug --adaptation=detailed
```

### ディレクトリ構造例

```
prompts/code/review/pull-request/
├── f_default.md           # デフォルト
├── f_bug.md               # バグ修正向け
├── f_feature.md           # 新機能向け
├── f_default_detailed.md  # 詳細モード
├── f_bug_detailed.md      # バグ修正 + 詳細
└── f_feature_strict.md    # 新機能 + 厳格
```
