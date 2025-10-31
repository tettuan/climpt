# Climpt

プロンプトとAIインタラクションを管理するCLIツール - breakdownパッケージのラッパー。

## 概要

Climptは、事前に用意したプロンプト群を使い分け、望んだプロンプトを1行のコマンドで呼び出し、出力します。
呼び出し時に、プロンプトへ差し込む値を引数で渡すことが可能です。

実行例:
```sh
# Bugレポートに基づいた新規テスト構築
cat bug_report.md | climpt-buld new test --input=bug

# 課題からタスクへの詳細なブレークダウン
climpt-breakdown to task --input=issue --from=github_issue_123.md --adaptation=detailed --uv-storypoint=5

```

AI支援による開発指示ツールの統一インターフェースを提供し、TypeScriptとJSON Schemaを用いてAIシステムが解釈できる開発指示の作成・管理・実行を可能にします。

このツールはAIコーディングエージェントと連携して動作するよう設計されており、特にCursorやClaude向けに最適化されています。基盤となるAIモデルはClaudeを想定していますが、構文や構造は他のAIモデルでも容易に解釈できるよう設計されています。

## インストール

### 推奨: CLIとしてインストール

Climptは主にCLIツールとして使用することを想定しています。公式のDeno/JSR方式でインストールできます:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global climpt jsr:@aidevtool/climpt
```

- `--allow-read`: ファイルやディレクトリの読み取りを許可（入力ファイルに必要）
- `--allow-write`: ファイルやディレクトリの書き込みを許可（出力生成に必要）
- `--allow-net`: ネットワークアクセスを許可（JSRからbreakdownパッケージのダウンロードに必要）
- `--allow-env`: 環境変数へのアクセスを許可（設定に必要）
- `-f`: 既存コマンドの上書き
- `--global`: グローバルにインストール
- `climpt`: コマンド名

> **注意:**
> 便利さのために`-A`（全権限許可）を使うこともできますが、セキュリティのため上記のように特定の権限フラグを使うことを推奨します。
> CLIモジュールは`jsr:@aidevtool/climpt`として指定してください。
> これは`deno.json`の`exports`設定に基づいています。

## 使い方

### 基本コマンド

インストール後、climptコマンドを直接使用できます:

```bash
# ヘルプを表示
climpt --help

# 初期設定ファイルを生成
climpt init

# バージョン確認
climpt --version
```

Climptはbreakdownパッケージの全機能にシンプルなラッパーインターフェースを通じてアクセスできます。
（将来的には、機能開発自体をBreakdownからClimptへ移行する予定です。）

### コマンド構文

Climptコマンドは以下の構文に従います:

```bash
climpt-<profile> <directive> <layer> [options]
```

**構成要素:**
- `<profile>`: プロファイル名（例: git, breakdown, build）
- `<directive>`: 実行するアクション（例: create, analyze, trace）
- `<layer>`: ターゲット層（例: refinement-issue, quality-metrics）
- `[options]`: 各種オプション

### オプション一覧

#### 入力/出力オプション

| オプション | 短縮形 | 説明 | 対応する変数 |
|---------|------|------|------------|
| `--from` | `-f` | 入力ファイルを指定 | `{input_text_file}` |
| `--destination` | `-o` | 出力先を指定（ファイルまたはディレクトリ） | `{destination_path}` |
| (STDIN) | - | 標準入力からデータを受け取る | `{input_text}` |

#### 処理モードオプション

| オプション | 短縮形 | 説明 | 用途 |
|---------|------|------|------|
| `--input` | `-i` | 入力レイヤーの種類を指定 | プロンプトファイル選択に使用(指定がないときは "default" ） |
| `--adaptation` | `-a` | プロンプトの種類を指定 | プロンプトのバリエーション選択 |

プロンプトファイル名 `f_<input>_<adaptation>.md` を探します。　

#### カスタム変数オプション

| オプション | 説明 | 例 |
|---------|------|-----|
| `--uv-*` | ユーザー定義変数を指定 | `--uv-max-line-num=100` |

#### システムオプション

| オプション | 説明 |
|---------|------|
| `--help` | ヘルプメッセージを表示 |
| `--version` | バージョン情報を表示 |
| `--config` | 使用するプロファイルを指定 |

### テンプレート変数とオプションの対応表

プロンプトテンプレート内で使用できる変数とCLIオプションの対応:

| テンプレート変数 | CLIオプション | 説明 | 必須 |
|---------------|-------------|------|------|
| `{input_text}` | STDIN | 標準入力からのテキスト | ✗ |
| `{input_text_file}` | `-f`, `--from` | 入力ファイルのパス | ✗ |
| `{destination_path}` | `-o`, `--destination` | 出力先のパス | ✗ |
| `{uv-*}` | `--uv-*` | カスタム変数（任意の名前） | ✗ |

**注意:** `-f`/`--from` オプションと STDIN は独立して動作し、両方を同時に使用できます。

### 使用例

#### 1. 標準入力を使用する

```bash
# エラーログから対処方針を生成
echo "something error" | climpt-diagnose trace stack --input=test -o=./tmp/abc --uv-max-line-num=3
```

#### 2. ファイルから入力する

```bash
# 要件ドキュメントからリファインメント課題を作成
climpt-git create refinement-issue -f=requirements.md -o=./issues/

# 詳細モードで課題をタスクに分解
climpt-breakdown to task --input=issue --from=github_issue_123.md --adaptation=detailed --uv-storypoint=5
```

#### 3. 標準入力とファイル入力を組み合わせる

```bash
# バグレポートから新規テストを構築
cat bug_report.md | climpt-build new test --input=bug
```

#### 4. プロファイルを切り替える

```bash
# アーキテクチャ最適化プロンプトを使用
climpt-arch optimize go -f=current_design.md

# セットアップ用プロンプトを使用
climpt-setup climpt list
```

### プロンプトファイルの構造

プロンプトファイルは以下のルールに従って配置されます:

```
.agent/climpt/prompts/<profile>/<directive>/<layer>/f_<input>_<adaptation>.md
```

**命名規則:**
- `f_default.md`: デフォルトプロンプト（`--input`と`--adaptation`の指定なし）
- `f_<input>.md`: 特定の入力タイプ用（例: `f_code.md`）
- `f_<input>_<adaptation>.md`: 入力タイプと処理モードの組み合わせ（例: `f_default_strict.md`）

**フロントマター例:**

```yaml
---
title: Git branch の新規立ち上げ判断と、新ブランチ作成
input_text: 今回の作業内容を30文字以内で指定
description: ブランチ戦略に基づいて適切なブランチを選択・作成
options:
  input: ["default"]
  adaptation: []
  input_text: true
  input_file: false
  destination_path: false
---
```

### エラーハンドリング

- **ファイルが見つからない:** プロンプトファイルのパスと命名規則を確認
- **権限エラー:** 必要な権限（`--allow-read`, `--allow-write`など）を確認
- **設定ファイル不足:** `climpt init`を実行して`.agent/climpt/config/default-app.yml`を生成

## 主な特徴

- 最適化されたMarkdown変換プロンプト
- AIシステム向けJSON Schema構文
- breakdownパッケージのラッパーインターフェース
- 多様な出力形式（Markdown/JSON/YAML）対応

## 目的

開発要件を標準化された方法で表現し、人間が書いた仕様とAIが解釈可能な指示の橋渡しをすること。

このツール自体はルールに基づくドキュメント生成は行いません。AIによるドキュメント生成を支援するため、AIが解釈・処理しやすいプロンプトや構造化フォーマットを提供します。

## MCP（Model Context Protocol）サーバー

Climptには、ClaudeなどのAIアシスタントがコマンドレジストリと直接対話し、標準化されたプロトコルを通じて開発タスクを実行できるようにする組み込みMCPサーバーが含まれています。

**重要**: MCPを使用する場合、`.deno/bin`ディレクトリは**不要**です。MCPサーバーはローカルCLIバイナリを必要とせず、プロトコルを通じて直接コマンドを実行します。

### MCP機能

- **動的ツール読み込み**: `.agent/climpt/registry.json`から利用可能なツールを自動的に読み込み
- **完全なコマンドレジストリアクセス**: すべてのClimptコマンド（code、docs、git、meta、spec、test）が利用可能
- **複数Registry対応** (v1.6.1以降): 複数のエージェントのregistryを管理・切り替え可能
- **Registry設定管理**: `.agent/climpt/mcp/config.json`による設定ベースのregistry管理
- **パフォーマンス最適化**: Registryキャッシングによる高速な応答
- **グレースフルフォールバック**: 設定が利用できない場合は標準ツールにデフォルト
- **JSRディストリビューション**: ローカルインストールなしでJSRから直接実行可能
- **バイナリ依存なし**: `.deno/bin`インストールなしで動作

### MCP設定

ClaudeまたはCursorの設定（`.mcp.json`または`~/.claude.json`）でMCPサーバーを設定:

```json
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        "jsr:@aidevtool/climpt/mcp"
      ]
    }
  }
}
```

### 複数Registry設定（v1.6.1以降）

v1.6.1から、MCPサーバーは複数のエージェントのregistryを管理できるようになりました。

#### MCP Config設定

`.agent/climpt/mcp/config.json`で複数のエージェントとそのregistryパスを定義します：

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "inspector": ".agent/inspector/registry.json",
    "auditor": ".agent/auditor/registry.json"
  }
}
```

**設定場所の優先順位:**
1. カレントディレクトリ: `.agent/climpt/mcp/config.json`
2. ホームディレクトリ: `~/.agent/climpt/mcp/config.json`
3. デフォルト設定（自動作成）

**デフォルト設定:**
MCP起動時に自動的に作成されます：
```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json"
  }
}
```

#### ツールでのエージェント指定

`search`および`describe`ツールで、オプションの`agent`パラメータを使用してregistryを切り替えられます：

```javascript
// climpt registryで検索（デフォルト）
search({ query: "commit changes" })

// inspector registryで検索
search({ query: "analyze code quality", agent: "inspector" })

// auditor registryから詳細を取得
describe({ c1: "test", c2: "run", c3: "unit", agent: "auditor" })
```

### レジストリ設定

MCPサーバーは各エージェントの`.agent/{agent}/registry.json`から設定を読み込みます。このファイルはC3L（Climpt 3-word Language）仕様に従って、利用可能なツールとそのコマンドマッピングを定義します。

#### レジストリファイルスキーマ

```typescript
{
  "version": string,           // レジストリバージョン（例: "1.0.0"）
  "description": string,       // レジストリ全体の説明
  "tools": {
    // ツール名の配列 - 各ツールはclimpt-{name}として利用可能
    "availableConfigs": string[],  // ["git", "spec", "test", "code", "docs", "meta"]

    // コマンドレジストリ - 利用可能なすべてのC3Lコマンドを定義
    "commands": [
      {
        "c1": string,         // ドメイン/カテゴリ（git, spec, test, code, docs, meta）
        "c2": string,         // アクション/ディレクティブ（create, analyze, execute など）
        "c3": string,         // ターゲット/レイヤー（refinement-issue, quality-metrics など）
        "description": string,// コマンドの説明
        "usage": string,      // 使用方法と例
        "options": {          // このコマンドで利用可能なオプション
          "input": string[],     // 入力レイヤーの種類（プロンプトファイル選択に使用）
          "adaptation": string[], // プロンプトの種類（プロンプトのバリエーション選択）
          "file": boolean,  // ファイル入力サポート
          "stdin": boolean,       // 標準入力サポート
          "destination": boolean  // 出力先指定サポート
        }
      }
    ]
  }
}
```

#### 完全なレジストリテンプレート

```json
{
  "version": "1.0.0",
  "description": "Climpt MCPサーバーとコマンドレジストリの包括的設定",
  "tools": {
    "availableConfigs": [
      "code",
      "docs",
      "git",
      "meta",
      "spec",
      "test"
    ],
    "commands": [
      // Gitコマンド
      {
        "c1": "git",
        "c2": "create",
        "c3": "refinement-issue",
        "description": "要件ドキュメントからリファインメント課題を作成",
        "usage": "要件ドキュメントからリファインメント課題を作成します。\n例: climpt-git create refinement-issue -f requirements.md",
        "options": {
          "input": ["default"],
          "adaptation": ["default", "detailed"],
          "file": true,
          "stdin": false,
          "destination": true
        }
      },
      {
        "c1": "git",
        "c2": "analyze",
        "c3": "commit-history",
        "description": "コミット履歴を分析してインサイトを生成"
      },

      // Specコマンド
      {
        "c1": "spec",
        "c2": "analyze",
        "c3": "quality-metrics",
        "description": "仕様の品質と完全性を分析"
      },
      {
        "c1": "spec",
        "c2": "validate",
        "c3": "requirements",
        "description": "要件を標準に対して検証"
      },

      // Testコマンド
      {
        "c1": "test",
        "c2": "execute",
        "c3": "integration-suite",
        "description": "統合テストスイートを実行"
      },
      {
        "c1": "test",
        "c2": "generate",
        "c3": "unit-tests",
        "description": "仕様からユニットテストを生成"
      },

      // Codeコマンド
      {
        "c1": "code",
        "c2": "create",
        "c3": "implementation",
        "description": "設計ドキュメントから実装を作成"
      },
      {
        "c1": "code",
        "c2": "refactor",
        "c3": "architecture",
        "description": "パターンに基づいてコードアーキテクチャをリファクタリング"
      },

      // Docsコマンド
      {
        "c1": "docs",
        "c2": "generate",
        "c3": "api-reference",
        "description": "APIリファレンスドキュメントを生成"
      },
      {
        "c1": "docs",
        "c2": "update",
        "c3": "user-guide",
        "description": "ユーザーガイドドキュメントを更新"
      },

      // Metaコマンド
      {
        "c1": "meta",
        "c2": "list",
        "c3": "available-commands",
        "description": "利用可能なすべてのClimptコマンドをリスト"
      },
      {
        "c1": "meta",
        "c2": "resolve",
        "c3": "command-definition",
        "description": "コマンド定義を解決して表示"
      }
    ]
  }
}
```

**読み込みプロセス**:
1. サーバーは起動時に`.agent/climpt/registry.json`を読み込む
2. `availableConfigs`から動的にツールを作成
3. ファイルが見つからない場合はデフォルトにフォールバック
4. 各ツールは`climpt-{name}`として利用可能

**フィールドの説明**:
- `version`: レジストリスキーマのバージョン
- `description`: レジストリ全体の説明
- `availableConfigs`: `climpt-{name}`コマンドとして利用可能になるツール名の配列
- `commands`: C3L仕様に従ったコマンド定義の配列
  - `c1/c2/c3`: コマンド構造（ドメイン/アクション/ターゲット）
  - `description`: コマンドの目的
  - `usage`: 使用方法と例
  - `options`: 各コマンドで利用可能なオプション
    - `input`: 入力レイヤーの種類（プロンプトファイル選択に使用、指定がないときは "default"）（例: ["default", "code", "bug"]）
    - `adaptation`: プロンプトの種類（プロンプトのバリエーション選択）（例: ["default", "detailed", "strict"]）
    - `file`: ファイル入力がサポートされているか（true または false）
    - `stdin`: 標準入力がサポートされているか（true または false）
    - `destination`: 出力先を指定できるか（true または false）

**クイックスタート**:
テンプレートファイルをプロジェクトにコピー:
```bash
cp examples/mcp/registry.template.json .agent/climpt/registry.json
```

完全なテンプレートファイルは[`examples/mcp/registry.template.json`](examples/mcp/registry.template.json)で利用可能

### MCPサーバーの実行

MCPサーバーを直接実行することもできます:

```bash
# JSRから（推奨）
deno run --allow-read --allow-write --allow-net --allow-env --allow-run jsr:@aidevtool/climpt/mcp

# 開発用にローカルで
deno run --allow-read --allow-write --allow-net --allow-env --allow-run ./src/mcp/index.ts
```

MCPサーバーは、AIアシスタントにClimptの全機能への構造化されたアクセスを提供します。

## Climp のユースケース

多様なプロンプトを使い分け、望んだプロンプトを1行のコマンドで取得します。
主に、以下のユースケースを想定しています。

- パターン化したプロンプトの使い分けを、一元管理したい
- Claude CodeのようなCLIエージェントから、動的に呼び出したい
- 処理の連鎖に、プロンプトを仲介して加工フローを構築したい
- 特定の実装領域に、特定の洗練されたプロンプト群を用いて使い分けたい
- Coding Agent にプロンプトを選ばせたい

また、応用ユースケースとしては、次のようなケースが想定されています。

- Coding Agent が生成するコードを導き、安定化させたい
- 抽象度の高い実装を、再現性高く実行したい

応用のために、Denoを用います。
Climptを複数Deno実行コマンドとして、最適化して用意します。
用意された実行コマンドは、プロファイルを切り替えることができます。

## セットアップ

### 初期設定

Climptは、`.agent/climpt/config/default-app.yml` を必要とします。
通常は、プロジェクト直下にて `climpt init` することで生成されます。

任意の階層化へインストールすることもできます。例えば tests/ 配下で init することも可能です。
推奨は、`.deno/bin/*` に複数の実行ファイルを用意する方法です。各所へ点在するよりも、利便性高く管理できます。

さらに、 `.deno/bin/*` 配下へ `subagent-*` や `inspector-*` といった別名で配置すると、Sub-Agent に対応させることもできます。

### 設定ファイル構成

Climptは2種類の設定ファイルを使用します:

#### app.yml（アプリケーション設定）

プロンプトとスキーマの配置ディレクトリを定義します。

```yaml
# .agent/climpt/config/git-app.yml の例
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/git"
app_schema:
  base_dir: "schema/git"
```

#### user.yml（ユーザー設定）

オプションのデフォルト値や動作をカスタマイズします。特に`destination`のプレフィックスを設定できます。

```yaml
# .agent/climpt/config/git-user.yml の例
options:
  destination:
    prefix: "output/git"  # -o で指定したパスの前に自動的に追加されるプレフィックス
```

**設定の優先順位:**
1. コマンドラインオプション（最優先）
2. `user.yml` の設定
3. `app.yml` の設定
4. デフォルト値

**destinationプレフィックスの動作例:**

```bash
# user.yml で prefix: "output/git" を設定している場合
climpt-git create issue -o=tasks/task1.md
# 実際の出力先: output/git/tasks/task1.md

# プレフィックス未設定の場合
climpt-git create issue -o=tasks/task1.md
# 実際の出力先: tasks/task1.md
```

### 複数インストール設定

プロファイルの切り替えは、`--config` オプションで行います。
Deno の呼び出し時に、 `--config=profilename` を付与します。

これにより、以下を実現します。

まず、.deno/bin 配下に --config 違いの呼び出しを複数用意します。

```
.deno/bin
├── climpt-arch         # --config=arch
├── climpt-breakdown    # --config=breakdown
├── climpt-build        # --config=build
├── climpt-diagnose     # --config=diagnose
├── climpt-research     # --config=research
├── climpt-setup        # --config=setup
└── climpt-verify       # --config=verify
```

次に、対応する設定を、複数用意します。 `*-app.yml` の * 部分がプロファイル名です。
プロファイルごとに、受け付けられる引数指定を変えられます。
例えば `arch` は `climpt-arch optimize go` を実行できるが、`climpt-setup optimize go` は実行できない状態を作ることが可能です。

```
.agent/climpt
├── config
│   ├── arch-app.yml
│   ├── arch-user.yml
│   ├── breakdown-app.yml
│   ├── breakdown-user.yml
│   ├── build-app.yml
│   ├── build-user.yml
```

最後に、テンプレートプロンプトを用意します。
プロンプトの配置場所は、設定で切り替えられます。そのため、プロファイルごとに保存階層を変更できます。
以下の例では、同じ prompts/ 階層に、プロファイル名で分けて階層化しています。


```
.agent/climpt
├── prompts
│   ├── arch
│   │   └── optimize
│   │       └── go
│   │           └── f_default.md
│   ├── breakdown
│   │   └── to
│   │       ├── issue
│   │       │   ├── f_default.md
│   │       │   ├── f_detailed.md
│   ├── diagnose
│   │   └── trace
│   │       └── stack
│   │           └── f_test.md
│   ├── setup
│   │   └── climpt
│   │       └── list
│   │           └── f_default.md
```


### 運用

よく使うプロンプトファイルを、プロンプト階層へ追加します。
プロジェクトに重要なプロンプトは、Git管理下に置きます。

プロンプトには、置換のためのテンプレート変数を用いることができます。

#### プロンプト実装サンプル

実際のプロンプト実装例として、[`examples/prompts/list/usage/f_default.md`](/examples/prompts/list/usage/f_default.md) を参照してください。このファイルは、Climptで利用可能なコマンド一覧を生成するためのプロンプトテンプレートの実装サンプルです。フロントマターの設定方法、テンプレート変数の使用方法、JSON Schemaを用いた構造化出力の定義方法などが含まれています。

``````markdown
# エラー対処方針

エラーを種類で分けて、方針を考えます。
その後、エラー種類ごとにファイルを分け、出力先へ保存します。
1つのファイルに記載する行数上限は、{uv-max-line-num} です。

出力先: `{destination_path}`


# エラー内容

`````
{input_text}
`````
``````

上記のテンプレートに対し、以下のCLIを実行すると、値が置き換わります。

```
echo "something error" | climpt-diagnose trace stack --input=test -o=./tmp/abc --uv-max-line-num=3
```

### アップデート

最新版へアップデートするには、同じインストールコマンドを再度実行してください:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global climpt jsr:@aidevtool/climpt
```

### アンインストール

#### グローバルインストールの場合

```bash
deno uninstall climpt
```

#### ローカル（プロジェクト）インストールの場合

```bash
deno uninstall --root .deno climpt
```
- プロジェクトの`.deno/bin`ディレクトリからアンインストールするには`--root .deno`を使用してください。

### 注意事項

- climptコマンドは`deno.json`の`bin`設定により自動的に`cli.ts`をエントリポイントとして使用します。
- Deno 2.4以降を推奨します。
- 詳細な使い方は「使い方」セクションを参照してください。

### プロジェクトディレクトリへのローカルインストール

特定プロジェクト内のみでclimptコマンドを使いたい場合は、`--root`オプションで`.deno/bin`にインストールできます:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global --root .deno -n climpt jsr:@aidevtool/climpt
```

インストール後、binディレクトリをPATHに追加してください:

```bash
export PATH="$(pwd)/.deno/bin:$PATH"
```

この設定を永続化するには、シェル設定ファイル（例: `~/.zshrc`や`~/.bashrc`）に追加してください。

## アーキテクチャ

Climptは`@tettuan/breakdown`パッケージの軽量ラッパーとして設計されており、基盤となるbreakdownツールの全機能を維持しつつ、統一されたCLIインターフェースを提供します。

## 必要要件

- Deno 2.5以降（推奨）
- インターネット接続（JSRパッケージのダウンロードに必要）

> **注意:** Deno 2.xを推奨します。

## ライセンス

MITライセンス - 詳細はLICENSEファイルを参照してください。

## コントリビュート

本プロジェクトはbreakdownパッケージのラッパーです。コア機能の改善はbreakdownパッケージのリポジトリを参照してください。
