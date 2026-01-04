[English](../en/06-config-files.md) | [日本語](../ja/06-config-files.md)

# 6. 設定ファイル編

Climpt のディレクトリ構造と設定ファイルの詳細を説明します。

## 目次

1. [ディレクトリ構造](#61-ディレクトリ構造)
2. [app.yml（アプリケーション設定）](#62-appymlアプリケーション設定)
3. [user.yml（ユーザー設定）](#63-userymlユーザー設定)
4. [registry_config.json（レジストリ設定）](#64-registry_configjsonレジストリ設定)
5. [設定の優先順位](#65-設定の優先順位)

---

## 6.1 ディレクトリ構造

### 全体構造

```
your-project/
├── .agent/
│   └── climpt/
│       ├── config/                    # 設定ファイル群
│       │   ├── registry_config.json   # レジストリ設定
│       │   ├── default-app.yml        # デフォルト設定
│       │   ├── default-user.yml       # ユーザー設定（オプション）
│       │   ├── git-app.yml            # git ドメイン設定
│       │   ├── git-user.yml           # git ユーザー設定
│       │   ├── code-app.yml           # code ドメイン設定
│       │   └── ...
│       │
│       ├── prompts/                   # プロンプトテンプレート群
│       │   ├── git/                   # git ドメイン
│       │   │   ├── decide-branch/     # c2: decide-branch
│       │   │   │   └── working-branch/# c3: working-branch
│       │   │   │       └── f_default.md
│       │   │   ├── group-commit/
│       │   │   │   └── unstaged-changes/
│       │   │   │       └── f_default.md
│       │   │   └── merge-up/
│       │   │       └── base-branch/
│       │   │           └── f_default.md
│       │   │
│       │   ├── meta/                  # meta ドメイン
│       │   │   ├── create/
│       │   │   │   └── instruction/
│       │   │   │       └── f_default.md
│       │   │   └── build/
│       │   │       └── frontmatter/
│       │   │           └── f_default.md
│       │   │
│       │   └── code/                  # code ドメイン
│       │       └── review/
│       │           └── pull-request/
│       │               ├── f_default.md
│       │               └── f_detailed.md
│       │
│       ├── schema/                    # スキーマ定義（オプション）
│       │   └── ...
│       │
│       └── registry.json              # コマンドレジストリ
│
├── .deno/
│   └── bin/                           # 実行ファイル（CLIで使用する場合）
│       ├── climpt                     # メインコマンド
│       ├── climpt-git                 # git ドメイン
│       ├── climpt-meta                # meta ドメイン
│       └── climpt-code                # code ドメイン
│
└── agents/                            # エージェント（オプション）
    ├── iterator/                      # Iterate Agent
    │   └── config.json
    └── reviewer/                      # Review Agent
        └── config.json
```

### 各ディレクトリの役割

| ディレクトリ | 役割 | 必須 |
|-------------|------|------|
| `.agent/climpt/config/` | 設定ファイル格納 | はい |
| `.agent/climpt/prompts/` | プロンプトテンプレート | はい |
| `.agent/climpt/schema/` | JSON Schema 定義 | いいえ |
| `.deno/bin/` | CLI 実行ファイル | MCP のみなら不要 |

### プロンプトディレクトリの構造

```
prompts/{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md
         │     │    │        │          │
         │     │    │        │          └─ 処理モード（省略可）
         │     │    │        └─ エディション（省略時は default）
         │     │    └─ ターゲット（対象物）
         │     └─ アクション（動作）
         └─ ドメイン（領域）
```

---

## 6.2 app.yml（アプリケーション設定）

各ドメインのプロンプト・スキーマの配置場所を定義します。

### ファイル名規則

```
.agent/climpt/config/{domain}-app.yml
```

例：
- `git-app.yml` → `climpt-git` コマンド用
- `code-app.yml` → `climpt-code` コマンド用
- `default-app.yml` → デフォルト（`--config` 未指定時）

### 設定項目

```yaml
# .agent/climpt/config/git-app.yml

# 作業ディレクトリ（プロンプト検索の基点）
working_dir: ".agent/climpt"

# プロンプトファイルの配置場所
app_prompt:
  base_dir: "prompts/git"    # working_dir からの相対パス

# スキーマファイルの配置場所（オプション）
app_schema:
  base_dir: "schema/git"
```

### 設定項目の説明

| 項目 | 説明 | 必須 |
|------|------|------|
| `working_dir` | プロンプト検索の基点ディレクトリ | はい |
| `app_prompt.base_dir` | プロンプトファイルのベースディレクトリ | はい |
| `app_schema.base_dir` | スキーマファイルのベースディレクトリ | いいえ |

### パス解決の仕組み

コマンドからプロンプトファイルのパスを解決する流れ：

```
コマンド: climpt-git decide-branch working-branch

1. working_dir: ".agent/climpt"
2. app_prompt.base_dir: "prompts/git"
3. c2: "decide-branch"
4. c3: "working-branch"
5. filename: "f_default.md"

結果: .agent/climpt/prompts/git/decide-branch/working-branch/f_default.md
```

### 複数ドメインの設定例

```yaml
# git-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/git"

# code-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/code"

# meta-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/meta"
```

---

## 6.3 user.yml（ユーザー設定）

オプションのデフォルト値や動作をカスタマイズします。

### ファイル名規則

```
.agent/climpt/config/{domain}-user.yml
```

### 設定項目

```yaml
# .agent/climpt/config/git-user.yml

# 出力先のプレフィックス設定
options:
  destination:
    prefix: "output/git"    # -o で指定したパスの前に付加

# パラメータ検証パターン（オプション）
params:
  two:
    directiveType:
      pattern: "^(decide-branch|group-commit|merge-up)$"
    layerType:
      pattern: "^(working-branch|unstaged-changes|base-branch)$"
```

### 設定項目の説明

| 項目 | 説明 |
|------|------|
| `options.destination.prefix` | 出力先パスの前に付加するプレフィックス |
| `params.two.directiveType.pattern` | c2（アクション）の検証正規表現 |
| `params.two.layerType.pattern` | c3（ターゲット）の検証正規表現 |

### destination プレフィックスの動作

```bash
# user.yml で prefix: "output/git" を設定した場合

climpt-git create issue -o=tasks/task1.md
# 実際の出力先: output/git/tasks/task1.md

# プレフィックスなしの場合
# 実際の出力先: tasks/task1.md
```

### パラメータ検証の動作

```bash
# pattern: "^(decide-branch|group-commit)$" の場合

climpt-git decide-branch working-branch  # OK
climpt-git group-commit unstaged-changes # OK
climpt-git invalid-action target         # エラー
```

---

## 6.4 registry_config.json（レジストリ設定）

複数のエージェントのレジストリを管理します。

### ファイルの場所

優先順位（上から順に検索）：
1. `.agent/climpt/config/registry_config.json`（プロジェクト）
2. `~/.agent/climpt/config/registry_config.json`（ホーム）
3. デフォルト設定（自動生成）

### 設定例

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "inspector": ".agent/inspector/registry.json",
    "auditor": ".agent/auditor/registry.json"
  }
}
```

### 設定項目の説明

| 項目 | 説明 |
|------|------|
| `registries` | エージェント名とレジストリパスのマッピング |
| `registries.{name}` | 各エージェントのレジストリファイルパス |

### 複数エージェントの使い分け

```bash
# MCP 経由で異なるエージェントのコマンドを検索
search({ query: "commit", agent: "climpt" })
search({ query: "analyze", agent: "inspector" })
```

---

## 6.5 設定の優先順位

### 読み込み順序

```
1. コマンドラインオプション（最優先）
   ↓
2. user.yml の設定
   ↓
3. app.yml の設定
   ↓
4. デフォルト値
```

### 優先順位の例

```bash
# コマンドライン: -o=./custom/output
# user.yml: destination.prefix = "output/git"
# app.yml: (なし)

# 結果: ./custom/output（コマンドラインが優先）
```

### 設定ファイルの検索順序

```
1. .agent/climpt/config/{domain}-app.yml
2. .agent/climpt/config/default-app.yml
3. エラー（設定ファイルが見つからない）
```

---

## 新規ドメインの設定手順

### Step 1: app.yml を作成

```bash
cat > .agent/climpt/config/myapp-app.yml << 'EOF'
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/myapp"
app_schema:
  base_dir: "schema/myapp"
EOF
```

### Step 2: user.yml を作成（オプション）

```bash
cat > .agent/climpt/config/myapp-user.yml << 'EOF'
options:
  destination:
    prefix: "output/myapp"
params:
  two:
    directiveType:
      pattern: "^(create|update|delete)$"
    layerType:
      pattern: "^(item|list|detail)$"
EOF
```

### Step 3: プロンプトディレクトリを作成

```bash
mkdir -p .agent/climpt/prompts/myapp/create/item
```

### Step 4: 実行ファイルを作成（CLI で使用する場合）

```bash
cat > .deno/bin/climpt-myapp << 'EOF'
#!/bin/sh
case "$1" in
    -h|--help|-v|--version)
        exec deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config 'jsr:@aidevtool/climpt' "$@"
        ;;
    *)
        exec deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config 'jsr:@aidevtool/climpt' --config=myapp "$@"
        ;;
esac
EOF

chmod +x .deno/bin/climpt-myapp
```

---

## 関連ガイド

- [05-architecture.md](./05-architecture.md) - 全体像編
- [07-dependencies.md](./07-dependencies.md) - 依存構造編（レジストリ、MCP）
- [08-prompt-structure.md](./08-prompt-structure.md) - プロンプト構造編
