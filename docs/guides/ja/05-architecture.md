[English](../en/05-architecture.md) | [日本語](../ja/05-architecture.md)

# 5. Climpt 全体像

Climpt の基本概念、アーキテクチャ、コマンド実行の流れを説明します。

## 5.1 Climpt とは何か

### 基本概念

Climpt は「CLI + Prompt = Climpt」という命名の通り、**CLI
でプロンプトを呼び出すツール**です。入力（引数、STDIN、ファイル）を受け取り、プロンプトテンプレートのテンプレート変数を置換して、最終プロンプトを出力します。

| 機能                 | 説明                                                           |
| -------------------- | -------------------------------------------------------------- |
| プロンプトの一元管理 | 事前に用意したプロンプト群を整理・保存                         |
| 1行での呼び出し      | `climpt-git create branch` のようなコマンドで即座に取得        |
| 動的な値の差し込み   | 引数や標準入力で変数を置換                                     |
| AI との連携          | MCP サーバーを通じて Claude などの AI がプロンプトを選択・実行 |

### C3L（Climpt 3-word Language）

Climpt のコマンドは3つの要素で構成されます：

| 要素             | 役割         | 例                                      |
| ---------------- | ------------ | --------------------------------------- |
| c1（ドメイン）   | 対象領域     | `git`, `code`, `meta`                   |
| c2（アクション） | 実行する動作 | `create`, `analyze`, `review`           |
| c3（ターゲット） | 対象物       | `branch`, `pull-request`, `instruction` |

コマンド形式：

```
climpt-<c1> <c2> <c3> [options]
```

実行例：

```bash
climpt-git decide-branch working-branch
climpt-meta create instruction
climpt-code review pull-request
```

---

## 5.2 アーキテクチャ概要

### 各コンポーネントの役割

| コンポーネント  | 役割                                               |
| --------------- | -------------------------------------------------- |
| CLI Interface   | コマンドライン引数を解析し、Core Engine を呼び出す |
| MCP Server      | AI アシスタントからのツール呼び出しを処理          |
| Plugin          | Claude Code との統合                               |
| Config Loader   | 設定ファイル（app.yml, user.yml）を読み込む        |
| Prompt Loader   | プロンプトファイル（.md）を読み込む                |
| Template Engine | テンプレート変数を置換                             |

ユーザー入力（CLI / MCP / Plugin）は Core Engine（Config Loader、Prompt
Loader、Template
Engine）を経由し、ファイルシステム（`.agent/climpt/config/`、`.agent/climpt/prompts/`、`registry.json`）からプロンプトを読み込み・置換して出力します。

### breakdown パッケージとの関係

Climpt は内部で `@tettuan/breakdown` パッケージを使用しています。breakdown
が提供する機能：

- YAML 設定ファイルの解析
- Markdown プロンプトファイルの読み込み
- テンプレート変数（`{input_text}` など）の置換

---

## 5.3 5層構造

Climpt は段階的に進化し、現在は5つの層から構成されています。

- **Agent 層（自律実行）**
  - **最上位層**: Iterator/Reviewer Agent — Claude Agent SDK で GitHub
    Issue/Project と連携（SDK Session #1）
  - **中間層**: delegate-climpt-agent Skill — Claude Code
    Plugin。コマンド検索、オプション解決
  - **実行層**: climpt-agent.ts (Sub-Agent) — Claude Agent SDK で自律実行（SDK
    Session #2）
- **環境層（基盤）**
  - **ツール層**: CLI / MCP — プロンプト取得のインターフェース
  - **設定層**: registry.json / prompts/ — @tettuan/breakdown
    によるテンプレート変換

### 各層の役割

| 層       | 役割                         | コンテクスト    | 実体                                                                        |
| -------- | ---------------------------- | --------------- | --------------------------------------------------------------------------- |
| 最上位層 | GitHub連携、反復制御         | SDK Session #1  | `agents/scripts/run-agent.ts`                                               |
| 中間層   | パラメータ変換、コマンド解決 | Plugin Context  | `plugins/climpt-agent/skills/delegate-climpt-agent/SKILL.md`                |
| 実行層   | プロンプト取得、自律実行     | SDK Session #2  | `plugins/climpt-agent/skills/delegate-climpt-agent/scripts/climpt-agent.ts` |
| ツール層 | CLI/MCP による呼び出し       | CLI/MCP Process | `cli.ts`, `mcp.ts`                                                          |
| 設定層   | プロンプトテンプレート       | File System     | `.agent/climpt/`                                                            |

### 三層連鎖（Agent 層内部）

Agent
層は3つの層が連鎖し、**コンテクスト分離**によって柔軟な自律動作を実現します。

**ポイント**:

- 最上位層と実行層は**別々の SDK セッション**で動作
- 中間層が**橋渡し**となり、パラメータ変換や検索を担当
- 各層のコンテクストが分離されているため、責務が明確

### 呼び出しの入口

| 用途           | エントリポイント                        |
| -------------- | --------------------------------------- |
| CLI 実行       | `jsr:@aidevtool/climpt/cli`             |
| MCP サーバー   | `jsr:@aidevtool/climpt/mcp`             |
| Iterator Agent | `jsr:@aidevtool/climpt/agents/iterator` |
| Reviewer Agent | `jsr:@aidevtool/climpt/agents/reviewer` |

---

## 5.4 コマンド実行の流れ

### 実行例

```bash
echo "バグ修正の実装" | climpt-git decide-branch working-branch -o=./output/
```

### 処理フロー（5ステップ）

**Step 1: コマンド解析**

```
climpt-git decide-branch working-branch -o=./output/
   │         │              │              │
   │         │              │              └─ destination: ./output/
   │         │              └─ c3 (target): working-branch
   │         └─ c2 (action): decide-branch
   └─ c1 (domain): git (--config=git)
```

**Step 2: 設定ファイル読み込み**

`.agent/climpt/config/git-app.yml` から `working_dir`、`app_prompt.base_dir`
を取得。

**Step 3: プロンプトファイル特定**

パス構築: `base_dir + c2 + c3 + filename` =
`prompts/git/decide-branch/working-branch/f_default.md`

edition/adaptation による選択: `--edition=bug --adaptation=detailed` →
`f_bug_detailed.md` → `f_bug.md` → `f_default.md`（フォールバック）

**Step 4: テンプレート変数の置換**

`{input_text}` → "バグ修正の実装" (STDIN)、`{destination_path}` → "./output/"

**Step 5: 結果出力**

置換済みプロンプトを標準出力へ。
