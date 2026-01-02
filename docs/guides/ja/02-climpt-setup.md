[English](../en/02-climpt-setup.md) | [日本語](../ja/02-climpt-setup.md)

# 2. Climpt のセットアップ

Climpt をインストールし、プロジェクトで使用できるように設定します。

## 目次

1. [Climpt のインストール](#21-climpt-のインストール)
2. [プロジェクトの初期化](#22-プロジェクトの初期化)
3. [Claude Code プラグインのインストール](#23-claude-code-プラグインのインストール)
4. [動作確認](#24-動作確認)

---

## 2.1 Climpt のインストール

### グローバルインストール（推奨）

```bash
deno install \
  --allow-read \
  --allow-write \
  --allow-net \
  --allow-env \
  --global \
  climpt \
  jsr:@aidevtool/climpt
```

各オプションの説明：
- `--allow-read`: ファイル読み取り（入力ファイルに必要）
- `--allow-write`: ファイル書き込み（出力生成に必要）
- `--allow-net`: ネットワークアクセス（JSR パッケージダウンロードに必要）
- `--allow-env`: 環境変数アクセス（設定に必要）
- `--global`: グローバルにインストール
- `climpt`: コマンド名

### インストール確認

```bash
climpt --version
```

出力例：
```
climpt 1.9.18
```

### ヘルプの表示

```bash
climpt --help
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
climpt init
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
climpt --help

# バージョン確認
climpt --version
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

### climpt: command not found

Deno の bin ディレクトリが PATH に含まれていない可能性があります：

```bash
# PATH を確認
echo $PATH | tr ':' '\n' | grep deno

# PATH に追加
export PATH="$HOME/.deno/bin:$PATH"
```

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
