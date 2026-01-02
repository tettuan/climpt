[English](../en/01-prerequisites.md) | [日本語](../ja/01-prerequisites.md)

# 1. 前提条件

Iterate Agent を使用するために必要なツールをインストールします。

## 必要なツール一覧

| ツール | バージョン | 確認コマンド | 用途 |
|--------|-----------|-------------|------|
| Deno | 2.x 以上 | `deno --version` | Climpt 実行環境 |
| GitHub CLI (gh) | 2.x 以上 | `gh --version` | GitHub API アクセス |

---

## 1.1 Deno のインストール

Deno は TypeScript/JavaScript ランタイムです。Climpt の実行に必要です。

### macOS / Linux

```bash
curl -fsSL https://deno.land/install.sh | sh
```

### macOS (Homebrew)

```bash
brew install deno
```

### Windows (PowerShell)

```powershell
irm https://deno.land/install.ps1 | iex
```

### インストール確認

```bash
deno --version
```

出力例：
```
deno 2.1.4 (stable, release, aarch64-apple-darwin)
v8 13.0.245.12-rusty
typescript 5.6.2
```

### PATH の設定

インストール後、Deno が見つからない場合は PATH を設定します：

```bash
# ~/.bashrc または ~/.zshrc に追加
export DENO_INSTALL="$HOME/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"
```

設定を反映：
```bash
source ~/.zshrc  # または source ~/.bashrc
```

---

## 1.2 GitHub CLI (gh) のインストール

GitHub CLI は GitHub との対話を行うコマンドラインツールです。
Iterate Agent は `gh` を通じて Issue/Project の情報を取得します。

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

### Linux (dnf)

```bash
# Fedora/RHEL
sudo dnf install 'dnf-command(config-manager)'
sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
sudo dnf install gh
```

### Windows

```powershell
# Scoop
scoop install gh

# Chocolatey
choco install gh

# winget
winget install --id GitHub.cli
```

### インストール確認

```bash
gh --version
```

出力例：
```
gh version 2.62.0 (2024-11-14)
```

---

## 1.3 GitHub CLI の認証

`gh` をインストールしたら、GitHub アカウントで認証します。

### 認証の実行

```bash
gh auth login
```

対話形式で以下を選択：

1. **Where do you use GitHub?**
   → `GitHub.com` を選択

2. **What is your preferred protocol for Git operations on this host?**
   → `HTTPS` を選択（推奨）

3. **Authenticate Git with your GitHub credentials?**
   → `Yes` を選択

4. **How would you like to authenticate GitHub CLI?**
   → `Login with a web browser` を選択

5. ブラウザが開くので、表示されたコードを入力して認証

### 認証の確認

```bash
gh auth status
```

成功時の出力例：
```
github.com
  ✓ Logged in to github.com account your-username
  ✓ Git operations for github.com configured to use https protocol.
  ✓ Token: gho_************************************
  ✓ Token scopes: 'gist', 'read:org', 'repo', 'workflow'
```

### 認証に問題がある場合

```bash
# 再認証
gh auth logout
gh auth login

# トークンの更新
gh auth refresh
```

---

## 確認チェックリスト

以下のコマンドがすべて正常に動作することを確認してください：

```bash
# Deno バージョン確認
deno --version

# gh バージョン確認
gh --version

# gh 認証状態確認
gh auth status
```

すべて正常であれば、次のステップへ進みます。

---

## 次のステップ

[02-climpt-setup.md](./02-climpt-setup.md) へ進んで、Climpt をインストールします。
