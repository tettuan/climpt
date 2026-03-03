[English](../en/01-prerequisites.md) | [日本語](../ja/01-prerequisites.md)

# 1. Prerequisites

Install the required tools for using Iterate Agent.

## Required Tools

| Tool            | Version      | Check Command    | Purpose           |
| --------------- | ------------ | ---------------- | ----------------- |
| Deno            | 2.x or later | `deno --version` | Climpt runtime    |
| GitHub CLI (gh) | 2.x or later | `gh --version`   | GitHub API access |

---

## 1.1 Installing Deno

Deno is a TypeScript/JavaScript runtime required for running Climpt.

### macOS / Linux

```bash
curl -fsSL https://deno.land/install.sh | sh
```

### macOS (Homebrew)

```bash
brew install deno
```

> For Windows, run `irm https://deno.land/install.ps1 | iex` in PowerShell.

### Verify Installation

```bash
deno --version
```

---

## 1.2 Installing GitHub CLI (gh)

GitHub CLI is a command-line tool for interacting with GitHub. Iterate Agent
uses `gh` to retrieve Issue/Project information.

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

> For other platforms (Fedora, Windows, etc.), see
> https://cli.github.com/manual/installation

---

## 1.3 GitHub CLI Authentication

After installing `gh`, authenticate with your GitHub account.

```bash
gh auth login
```

Interactive prompts:

1. **Where do you use GitHub?** -> Select `GitHub.com`
2. **Preferred protocol?** -> Select `HTTPS` (recommended)
3. **Authenticate Git with GitHub credentials?** -> Select `Yes`
4. **How to authenticate?** -> Select `Login with a web browser`
5. A browser will open - enter the displayed code to authenticate

Verify authentication:

```bash
gh auth status
```

If authentication fails, re-authenticate with `gh auth logout && gh auth login`,
or refresh with `gh auth refresh`.

---

## Verification Checklist

```bash
deno --version     # Deno 2.x
gh --version       # gh 2.x
gh auth status     # Logged in
```
