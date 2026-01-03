[English](../en/02-climpt-setup.md) | [日本語](../ja/02-climpt-setup.md)

# 2. Climpt のセットアップ

JSR直接実行を使用して、プロジェクトでClimptを設定します。

## 目次

1. [前提条件](#21-前提条件)
2. [プロジェクトの初期化](#22-プロジェクトの初期化)
3. [Claude Code プラグインのインストール](#23-claude-code-プラグインのインストール)
4. [動作確認](#24-動作確認)

---

## 2.1 前提条件

- **Deno 2.5以上**: [deno.land](https://deno.land)からインストール
- **インターネット接続**: JSRパッケージ解決に必要

Denoのインストール確認:
```bash
deno --version
```

---

## 2.2 プロジェクトの初期化

Climpt を使用するプロジェクトで初期化を実行します。

### プロジェクトディレクトリへ移動

```bash
cd your-project
```

### 初期化コマンドの実行

```bash
deno run -A jsr:@aidevtool/climpt init
```

出力例：
```
Climpt initialized successfully!
Created configuration files in .agent/climpt/
```

### 作成されるファイル構造

```
your-project/
├── .agent/
│   └── climpt/
│       ├── config/
│       │   ├── default-app.yml      # アプリケーション設定
│       │   └── registry_config.json # レジストリ設定
│       ├── prompts/                  # プロンプトテンプレート
│       │   └── (初期状態では空)
│       └── registry.json             # コマンドレジストリ
└── ...
```

### 設定ファイルの確認

#### default-app.yml

```yaml
# .agent/climpt/config/default-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts"
app_schema:
  base_dir: "schema"
```

#### registry_config.json

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json"
  }
}
```

---

## 2.3 Claude Code プラグインのインストール

Iterate Agent を使用するには、Claude Code プラグインのインストールが必須です。

### マーケットプレイスの追加

Claude Code で以下のコマンドを実行：

```
/plugin marketplace add tettuan/climpt
```

### プラグインのインストール

```
/plugin install climpt-agent
```

**注意**: `/plugin install` が失敗した場合：

1. `/plugin` でプラグインブラウザを開く
2. 「Discover」タブを選択
3. `climpt-agent` を検索してインストール

### インストール確認

プラグインが正常にインストールされると、以下の Skill が利用可能になります：

- `delegate-climpt-agent`: Climpt エージェントにタスクを委任

確認方法：
```
/plugin list
```

出力に `climpt-agent` が含まれていれば成功です。

---

## 2.4 動作確認

### Climpt コマンドの確認

```bash
# ヘルプ表示
deno run -A jsr:@aidevtool/climpt --help

# バージョン確認
deno run -A jsr:@aidevtool/climpt --version
```

### プロジェクト設定の確認

```bash
# 設定ファイルの存在確認
ls -la .agent/climpt/config/
```

### プラグインの確認（Claude Code 内）

```
/plugin list
```

---

## トラブルシューティング

### 初期化に失敗する

プロジェクトルートで実行しているか確認：

```bash
pwd
ls -la
```

### プラグインのインストールに失敗

1. Claude Code を最新版にアップデート
2. `/plugin` でプラグインブラウザから手動インストール

---

## 次のステップ

以下の2つのパスがあります：

### A. 既存の指示書を使う場合

→ [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) へ進んで Iterate Agent を設定

### B. カスタム指示書を作成する場合

→ [03-instruction-creation.md](./03-instruction-creation.md) へ進んで指示書の作成方法を学ぶ
