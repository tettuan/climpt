[English](../en/01-prerequisites.md) | [日本語](../ja/01-prerequisites.md)

# 1. 前提条件

Iterate Agent を使用するために必要なツールをインストールします。

## 必要なツール一覧

| ツール          | バージョン | 確認コマンド     | 用途                |
| --------------- | ---------- | ---------------- | ------------------- |
| Deno            | 2.x 以上   | `deno --version` | Climpt 実行環境     |
| GitHub CLI (gh) | 2.x 以上   | `gh --version`   | GitHub API アクセス |

---

## 1.1 Deno のインストール

Deno は TypeScript/JavaScript ランタイムです。Climpt の実行に必要です。

### macOS / Linux

```bash
curl -fsSL https://deno.land/install.sh | sh
```

macOS では `brew install deno` も可能です。

> **他のプラットフォーム**: [deno.land](https://deno.land)
> のインストール手順を参照してください。

### インストール確認

```bash
deno --version
```

---

## 1.2 GitHub CLI (gh) のインストール

GitHub CLI は GitHub との対話を行うコマンドラインツールです。 Iterate Agent は
`gh` を通じて Issue/Project の情報を取得します。

### macOS (Homebrew)

```bash
brew install gh
```

### Linux (apt)

```bash
# Debian/Ubuntu
type -p curl >/dev/null || sudo apt install curl -y
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh -y
```

> **他のプラットフォーム（Windows、Fedora 等）**:
> [cli.github.com/manual/installation](https://cli.github.com/manual/installation)
> を参照してください。

### インストール確認

```bash
gh --version
```

---

## 1.3 GitHub CLI の認証

`gh` をインストールしたら、GitHub アカウントで認証します。

```bash
gh auth login
```

対話形式で以下を選択：

1. **Where do you use GitHub?** → `GitHub.com`
2. **What is your preferred protocol for Git operations on this host?** →
   `HTTPS`（推奨）
3. **Authenticate Git with your GitHub credentials?** → `Yes`
4. **How would you like to authenticate GitHub CLI?** →
   `Login with a web browser`
5. ブラウザが開くので、表示されたコードを入力して認証

認証の確認：

```bash
gh auth status
```

問題がある場合は `gh auth logout` → `gh auth login` で再認証、または
`gh auth refresh` でトークンを更新してください。

---

## 確認チェックリスト

```bash
deno --version       # Deno バージョン確認
gh --version         # gh バージョン確認
gh auth status       # gh 認証状態確認
```

すべて正常であれば、次のステップへ進みます。
