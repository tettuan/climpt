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

### Windows (PowerShell)

```powershell
irm https://deno.land/install.ps1 | iex
```

### Verify Installation

```bash
deno --version
```

Example output:

```
deno 2.1.4 (stable, release, aarch64-apple-darwin)
v8 13.0.245.12-rusty
typescript 5.6.2
```

### Setting PATH

If Deno is not found after installation, set the PATH:

```bash
# Add to ~/.bashrc or ~/.zshrc
export DENO_INSTALL="$HOME/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"
```

Apply settings:

```bash
source ~/.zshrc  # or source ~/.bashrc
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

### Verify Installation

```bash
gh --version
```

Example output:

```
gh version 2.62.0 (2024-11-14)
```

---

## 1.3 GitHub CLI Authentication

After installing `gh`, authenticate with your GitHub account.

### Execute Authentication

```bash
gh auth login
```

Interactive prompts:

1. **Where do you use GitHub?** → Select `GitHub.com`

2. **What is your preferred protocol for Git operations on this host?** → Select
   `HTTPS` (recommended)

3. **Authenticate Git with your GitHub credentials?** → Select `Yes`

4. **How would you like to authenticate GitHub CLI?** → Select
   `Login with a web browser`

5. A browser will open - enter the displayed code to authenticate

### Verify Authentication

```bash
gh auth status
```

Example successful output:

```
github.com
  ✓ Logged in to github.com account your-username
  ✓ Git operations for github.com configured to use https protocol.
  ✓ Token: gho_************************************
  ✓ Token scopes: 'gist', 'read:org', 'repo', 'workflow'
```

### Troubleshooting Authentication

```bash
# Re-authenticate
gh auth logout
gh auth login

# Refresh token
gh auth refresh
```

---

## Verification Checklist

Verify that all the following commands work correctly:

```bash
# Check Deno version
deno --version

# Check gh version
gh --version

# Check gh authentication status
gh auth status
```

If everything works, proceed to the next step.

---

## Next Step

Proceed to [02-climpt-setup.md](./02-climpt-setup.md) to install Climpt.
