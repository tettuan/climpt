# Registry Specification

Climpt コマンドレジストリの仕様書。MCP サーバーおよび Plugin
実装の両方がこの仕様に準拠する。

## 参照元

この仕様は以下のファイルから参照されている:

| ファイル                                              | 用途                            |
| ----------------------------------------------------- | ------------------------------- |
| `src/mcp/types.ts`                                    | MCP Server の型定義             |
| `src/mcp/registry.ts`                                 | MCP Server のレジストリ読み込み |
| `climpt-plugins/plugins/climpt-agent/lib/types.ts`    | Plugin の型定義                 |
| `climpt-plugins/plugins/climpt-agent/lib/registry.ts` | Plugin のレジストリ読み込み     |

## Registry ファイル構造

### ファイルパス

```
.agent/<agent-name>/registry.json
```

例:

- `.agent/climpt/registry.json` - climpt エージェントのレジストリ
- `.agent/inspector/registry.json` - inspector エージェントのレジストリ

### Registry Config

レジストリパスを管理する設定ファイル。

**ファイルパス:**

```
.agent/climpt/config/registry_config.json
```

**スキーマ:**

```typescript
interface MCPConfig {
  registries: {
    [agentName: string]: string; // パス: ".agent/<agent>/registry.json"
  };
}
```

**例:**

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "inspector": ".agent/inspector/registry.json"
  }
}
```

### Registry スキーマ

```typescript
interface Registry {
  /** スキーマバージョン */
  version: string;

  /** レジストリの説明 */
  description: string;

  /** ツール定義 */
  tools: {
    /** 利用可能な設定名リスト (optional) */
    availableConfigs?: string[];

    /** コマンド定義リスト */
    commands: Command[];
  };
}
```

### Command スキーマ

```typescript
interface Command {
  /**
   * ドメイン識別子 (C3L 第1階層)
   * @example "git", "meta", "spec", "test", "code", "docs"
   */
  c1: string;

  /**
   * アクション識別子 (C3L 第2階層)
   * @example "create", "analyze", "execute", "generate", "group-commit"
   */
  c2: string;

  /**
   * ターゲット識別子 (C3L 第3階層)
   * @example "unstaged-changes", "quality-metrics", "frontmatter"
   */
  c3: string;

  /** コマンドの説明文 */
  description: string;

  /** 使用方法の説明 (optional) */
  usage?: string;

  /** コマンドオプション (optional) */
  options?: {
    /** edition パラメータ値リスト */
    edition?: string[];

    /** adaptation パラメータ値リスト */
    adaptation?: string[];

    /** -f/--from フラグサポート */
    file?: boolean;

    /** stdin 入力サポート */
    stdin?: boolean;

    /** -d/--destination フラグサポート */
    destination?: boolean;
  };
}
```

## Registry 例

```json
{
  "version": "1.0.0",
  "description": "Climpt command registry",
  "tools": {
    "availableConfigs": ["git", "meta"],
    "commands": [
      {
        "c1": "git",
        "c2": "group-commit",
        "c3": "unstaged-changes",
        "description": "Group file changes by semantic proximity and execute multiple commits sequentially",
        "options": {
          "edition": ["default"],
          "adaptation": ["default", "detailed"],
          "file": true,
          "stdin": false,
          "destination": true
        }
      },
      {
        "c1": "meta",
        "c2": "build",
        "c3": "frontmatter",
        "description": "Generate C3L v0.5 compliant frontmatter"
      }
    ]
  }
}
```

## C3L 命名規則

C3L (Command 3-Level) は、コマンドを3階層で識別する命名規則。

| Level | Name   | Description    | Examples                            |
| ----- | ------ | -------------- | ----------------------------------- |
| c1    | Domain | 機能ドメイン   | `git`, `meta`, `spec`, `test`       |
| c2    | Action | 実行アクション | `create`, `analyze`, `group-commit` |
| c3    | Target | 対象ターゲット | `unstaged-changes`, `frontmatter`   |

**完全識別子:** `<agent>-<c1>-<c2>-<c3>`

例: `climpt-git-group-commit-unstaged-changes`
