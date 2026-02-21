[English](../en/06-config-files.md) | [日本語](../ja/06-config-files.md)

# 6. 設定ファイル編

Climpt のディレクトリ構造と設定ファイルの詳細を説明します。

## 6.1 ディレクトリ構造

### 全体構造

```
your-project/
├── .agent/climpt/
│   ├── config/                    # 設定ファイル群
│   │   ├── registry_config.json   # レジストリ設定
│   │   ├── default-app.yml        # デフォルト設定
│   │   ├── default-user.yml       # ユーザー設定（オプション）
│   │   ├── git-app.yml            # git ドメイン設定
│   │   └── ...
│   ├── prompts/                   # プロンプトテンプレート群
│   │   ├── git/{c2}/{c3}/f_default.md
│   │   ├── meta/{c2}/{c3}/f_default.md
│   │   └── code/{c2}/{c3}/f_default.md
│   ├── schema/                    # JSON Schema（オプション）
│   └── registry.json              # コマンドレジストリ
├── .deno/bin/                     # CLI 実行ファイル（MCP のみなら不要）
│   ├── climpt, climpt-git, climpt-meta, climpt-code, climpt-test
└── .agent/                        # エージェント設定（オプション）
    ├── iterator/agent.json
    ├── reviewer/agent.json
    └── facilitator/agent.json
```

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

`.agent/climpt/config/{domain}-app.yml` — 例:
`git-app.yml`、`code-app.yml`、`default-app.yml`（デフォルト）

### 設定項目

```yaml
# .agent/climpt/config/git-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/git" # working_dir からの相対パス
app_schema:
  base_dir: "schema/git" # オプション
```

| 項目                  | 説明                                   | 必須   |
| --------------------- | -------------------------------------- | ------ |
| `working_dir`         | プロンプト検索の基点ディレクトリ       | はい   |
| `app_prompt.base_dir` | プロンプトファイルのベースディレクトリ | はい   |
| `app_schema.base_dir` | スキーマファイルのベースディレクトリ   | いいえ |

### パス解決の仕組み

```
コマンド: climpt-git decide-branch working-branch

1. working_dir: ".agent/climpt"
2. app_prompt.base_dir: "prompts/git"
3. c2: "decide-branch"
4. c3: "working-branch"
5. filename: "f_default.md"

結果: .agent/climpt/prompts/git/decide-branch/working-branch/f_default.md
```

---

## 6.3 user.yml（ユーザー設定）

オプションのデフォルト値や動作をカスタマイズします。ファイル名:
`.agent/climpt/config/{domain}-user.yml`

```yaml
# .agent/climpt/config/git-user.yml
options:
  destination:
    prefix: "output/git" # -o で指定したパスの前に付加
params:
  two:
    directiveType:
      pattern: "^(decide-branch|group-commit|merge-up)$"
    layerType:
      pattern: "^(working-branch|unstaged-changes|base-branch)$"
```

| 項目                               | 説明                                   |
| ---------------------------------- | -------------------------------------- |
| `options.destination.prefix`       | 出力先パスの前に付加するプレフィックス |
| `params.two.directiveType.pattern` | c2（アクション）の検証正規表現         |
| `params.two.layerType.pattern`     | c3（ターゲット）の検証正規表現         |

### destination プレフィックスの動作

```bash
# user.yml で prefix: "output/git" を設定した場合
climpt-git create issue -o=tasks/task1.md
# 実際の出力先: output/git/tasks/task1.md
```

---

## 6.4 registry_config.json（レジストリ設定）

複数のエージェントのレジストリを管理します。

検索の優先順位:

1. `.agent/climpt/config/registry_config.json`（プロジェクト）
2. `~/.agent/climpt/config/registry_config.json`（ホーム）
3. デフォルト設定（自動生成）

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "inspector": ".agent/inspector/registry.json"
  }
}
```

```bash
# MCP 経由で異なるエージェントのコマンドを検索
search({ query: "commit", agent: "climpt" })
search({ query: "analyze", agent: "inspector" })
```

---

## 6.5 設定の優先順位

```
1. コマンドラインオプション（最優先）
2. user.yml の設定
3. app.yml の設定
4. デフォルト値
```

設定ファイルの検索順序: `{domain}-app.yml` → `default-app.yml` → エラー

---

## 新規ドメインの設定手順

1. **app.yml を作成**: `.agent/climpt/config/myapp-app.yml`
2. **user.yml を作成**（オプション）: `.agent/climpt/config/myapp-user.yml`
3. **プロンプトディレクトリを作成**:
   `mkdir -p .agent/climpt/prompts/myapp/create/item`
4. **実行ファイルを作成**（CLI 使用時）: `.deno/bin/climpt-myapp` —
   `--config=myapp` を指定するシェルスクリプト
