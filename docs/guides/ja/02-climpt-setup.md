[English](../en/02-climpt-setup.md) | [日本語](../ja/02-climpt-setup.md)

# 2. Climpt のセットアップ

JSR直接実行を使用して、プロジェクトでClimptを設定します。

## 2.1 前提条件

- **Deno 2.5以上**: [deno.land](https://deno.land)からインストール
- **インターネット接続**: JSRパッケージ解決に必要

Denoのインストール確認:

```bash
deno --version
```

---

## 2.2 プロジェクトの初期化

プロジェクトディレクトリへ移動し、初期化コマンドを実行します。

```bash
cd your-project
deno run -A jsr:@aidevtool/climpt init
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

---

## 2.3 Claude Code プラグインのインストール

Iterate Agent を使用するには、Claude Code プラグインのインストールが必須です。

```
/plugin marketplace add tettuan/climpt
/plugin install climpt-agent
```

**注意**: `/plugin install` が失敗した場合は、`/plugin`
でプラグインブラウザを開き、「Discover」タブから `climpt-agent`
を検索してインストールしてください。

インストール確認（`/plugin list` で `climpt-agent` が表示されれば成功）：

```
/plugin list
```

---

## 2.4 動作確認

```bash
# ヘルプ表示
deno run -A jsr:@aidevtool/climpt --help

# バージョン確認
deno run -A jsr:@aidevtool/climpt --version

# 設定ファイルの存在確認
ls -la .agent/climpt/config/
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

- **既存の指示書を使う場合** →
  [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) へ進んで Iterate
  Agent を設定
- **カスタム指示書を作成する場合** →
  [03-instruction-creation.md](./03-instruction-creation.md)
  へ進んで指示書の作成方法を学ぶ
