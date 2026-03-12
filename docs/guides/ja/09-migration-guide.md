[English](../en/09-migration-guide.md) | [日本語](../ja/09-migration-guide.md)

# 9. マイグレーションガイド: v1.11.x → v1.12.0

このガイドでは、カスタム `agent.json` ファイルを v1.11.x のフラット構成形式から
v1.12.0 の `runner.*` 階層構造に更新する方法を説明します。

---

## 9.1 対象者

| 状況                                                     | 対応                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| カスタム `agent.json` なしでプリビルトエージェントを使用 | このガイドは不要です。プリビルトエージェントは自動的に更新されます。                 |
| カスタム `agent.json` ファイルがある                     | このガイドを読んでファイルを移行してください。                                       |
| 新規にエージェントを構築する場合                         | 移行は不要です。最初から v1.12.0 の新構造を使用してください（セクション 9.4 参照）。 |

---

## 9.2 変更内容と理由

v1.11.x では、エージェント設定はフラットなトップレベルキーを使用していました：

```
behavior.*
prompts.*
logging.*
github.*
worktree.*
finalize.*
actions.*
```

v1.12.0 では、これらすべてが単一の `runner`
キーの下に移動し、サブグループに整理されています：

```
runner.flow.*
runner.verdict.*
runner.boundaries.*
runner.integrations.*
runner.actions.*
runner.execution.*
runner.logging.*
```

**理由：**
各サブグループは、設定を利用するランタイムモジュールに対応しています。
これにより、どの設定がシステムのどの部分で使用されるかが明確になり、
新機能追加時の名前衝突を防止できます。

---

## 9.3 マイグレーションマッピング表

### 全フィールドマッピング

| 旧パス (v1.11.x)               | 新パス (v1.12.0)                                  |
| ------------------------------ | ------------------------------------------------- |
| `behavior.systemPromptPath`    | `runner.flow.systemPromptPath`                    |
| `behavior.completionType`      | `runner.verdict.type`                             |
| `behavior.completionConfig`    | `runner.verdict.config`                           |
| `behavior.allowedTools`        | `runner.boundaries.allowedTools`                  |
| `behavior.permissionMode`      | `runner.boundaries.permissionMode`                |
| `behavior.sandboxConfig`       | `runner.boundaries.sandbox`                       |
| `behavior.askUserAutoResponse` | `runner.flow.askUserAutoResponse`                 |
| `behavior.defaultModel`        | `runner.flow.defaultModel`                        |
| `prompts.registry`             | `runner.flow.prompts.registry`                    |
| `prompts.fallbackDir`          | `runner.flow.prompts.fallbackDir`                 |
| `github.enabled`               | `runner.integrations.github.enabled`              |
| `github.labels`                | `runner.integrations.github.labels`               |
| `github.defaultClosureAction`  | `runner.integrations.github.defaultClosureAction` |
| `actions.enabled`              | `runner.actions.enabled`                          |
| `actions.allowedTypes`         | `runner.actions.types`                            |
| `worktree.enabled`             | `runner.execution.worktree.enabled`               |
| `worktree.root`                | `runner.execution.worktree.root`                  |
| `finalize.autoMerge`           | `runner.execution.finalize.autoMerge`             |
| `finalize.push`                | `runner.execution.finalize.push`                  |
| `finalize.remote`              | `runner.execution.finalize.remote`                |
| `finalize.createPr`            | `runner.execution.finalize.createPr`              |
| `finalize.prTarget`            | `runner.execution.finalize.prTarget`              |
| `logging.directory`            | `runner.logging.directory`                        |
| `logging.format`               | `runner.logging.format`                           |

### 削除されたフィールド

| 旧フィールド                  | 理由                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `behavior.preCloseValidation` | デッドコンフィグ — 型システムに定義されていませんでした。 |
| `behavior.disableSandbox`     | `runner.boundaries.sandbox` に統合されました。            |

---

## 9.4 変更前 / 変更後の例

### v1.11.x (旧)

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Example agent",
  "version": "1.0.0",
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "iterationBudget",
    "completionConfig": { "maxIterations": 10 },
    "allowedTools": ["Read", "Write"],
    "permissionMode": "plan"
  },
  "parameters": {},
  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  },
  "github": {
    "enabled": true,
    "labels": {},
    "defaultClosureAction": "close"
  },
  "logging": {
    "directory": "tmp/logs/agents/my-agent",
    "format": "jsonl"
  }
}
```

### v1.12.0 (新)

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Example agent",
  "version": "1.0.0",
  "parameters": {},
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "verdict": {
      "type": "count:iteration",
      "config": { "maxIterations": 10 }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write"],
      "permissionMode": "plan"
    },
    "integrations": {
      "github": {
        "enabled": true,
        "labels": {},
        "defaultClosureAction": "close"
      }
    },
    "logging": {
      "directory": "tmp/logs/agents/my-agent",
      "format": "jsonl"
    }
  }
}
```

構造変更のポイント：

- `behavior.*` は、各フィールドの制御対象に基づいて
  `runner.flow`、`runner.verdict`、 `runner.boundaries` に分割されます。
- `prompts.*` は `runner.flow.prompts` の中に移動します。
- `github.*` は `runner.integrations.github` に移動します。
- `logging.*` は `runner.logging` に移動します。
- `worktree.*` と `finalize.*` はそれぞれ `runner.execution.worktree` と
  `runner.execution.finalize` に移動します。

---

## 9.5 マイグレーション手順

1. **`agent.json` ファイルを開きます。**

2. **`runner` オブジェクトを作成します。** エージェント定義のトップレベルに空の
   `runner: {}` キーを追加します。

3. **`behavior` フィールドを `runner` に移動します。**
   - `behavior.systemPromptPath` --> `runner.flow.systemPromptPath`
   - `behavior.completionType` --> `runner.verdict.type`
   - `behavior.completionConfig` --> `runner.verdict.config`
   - `behavior.allowedTools` --> `runner.boundaries.allowedTools`
   - `behavior.permissionMode` --> `runner.boundaries.permissionMode`
   - `behavior.sandboxConfig` --> `runner.boundaries.sandbox`
   - `behavior.askUserAutoResponse` --> `runner.flow.askUserAutoResponse`
   - `behavior.defaultModel` --> `runner.flow.defaultModel`

4. **`prompts` フィールドを移動します。**
   - `prompts.registry` --> `runner.flow.prompts.registry`
   - `prompts.fallbackDir` --> `runner.flow.prompts.fallbackDir`

5. **`github` フィールドを移動します**（存在する場合）。
   - すべての `github.*` フィールドを `runner.integrations.github`
     の下にラップします。

6. **`actions` フィールドを移動します**（存在する場合）。
   - `actions.enabled` --> `runner.actions.enabled`
   - `actions.allowedTypes` --> `runner.actions.types`

7. **`worktree` と `finalize` フィールドを移動します**（存在する場合）。
   - `worktree.*` --> `runner.execution.worktree.*`
   - `finalize.*` --> `runner.execution.finalize.*`

8. **`logging` フィールドを移動します。**
   - `logging.*` --> `runner.logging.*`

9. **旧トップレベルキーを削除します。** トップレベルから `behavior`、`prompts`、
   `github`、`actions`、`worktree`、`finalize`、`logging` を削除します。

10. **デッドフィールドを削除します。** 設定に `behavior.preCloseValidation`
    または `behavior.disableSandbox` が含まれている場合は削除してください。
    サンドボックス制御には `runner.boundaries.sandbox` を使用してください。

11. **検証します。**
    エージェントを実行してエラーなく読み込まれることを確認します：

    ```bash
    deno task agent --agent {name} --help
    ```

---

## 9.6 Completion Type リファレンス

`behavior.completionType` を移行する場合、有効な `runner.verdict.type`
の値のクイックリファレンスです：

| タイプ            | 完了条件                                         | `runner.verdict.config`             |
| ----------------- | ------------------------------------------------ | ----------------------------------- |
| `detect:keyword`  | 出力にキーワードが含まれた場合                   | `{ "verdictKeyword": "DONE" }`      |
| `count:iteration` | N 回のイテレーションが実行された場合             | `{ "maxIterations": 5 }`            |
| `poll:state`      | 外部条件が満たされた場合（例：Issue のクローズ） | `{}` + `--issue` パラメータ         |
| `detect:graph`    | すべてのステップが完了した場合                   | `{}` + `steps_registry.json`        |
| `meta:custom`     | カスタムハンドラが true を返した場合             | `{ "handlerPath": "./handler.ts" }` |

---

## 9.7 トラブルシューティング

### エージェントが見つからない

`agent.json` ファイルが正しい場所にあることを確認してください：

```bash
ls -la .agent/{agent-name}/agent.json
```

### プロンプトが見つからない

`runner.flow.prompts.registry` が有効な `steps_registry.json` を指していること、
および `runner.flow.prompts.fallbackDir` がプロンプトディレクトリ構造と
一致していることを確認してください。

### モジュール解決エラー

Deno キャッシュをクリアして再試行してください：

```bash
deno cache --reload mod.ts
```

---

---

# 10. マイグレーションガイド: v1.12.0 → v1.13.0

このガイドでは、カスタム `agent.json` および `steps_registry.json` ファイルを
v1.12.0 の設定形式から v1.13.0 に更新する方法を説明します。

---

## 10.1 対象者

| 状況                                                     | 対応                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| カスタム `agent.json` なしでプリビルトエージェントを使用 | このガイドは不要です。プリビルトエージェントは自動的に更新されます。                  |
| カスタム `agent.json` ファイルがある                     | このガイドを読んでファイルを移行してください。                                        |
| カスタム `steps_registry.json` ファイルがある            | セクション 10.3 と 10.5 を読んでレジストリキーを更新してください。                    |
| 新規にエージェントを構築する場合                         | 移行は不要です。最初から v1.13.0 の新構造を使用してください（セクション 10.4 参照）。 |

---

## 10.2 変更内容と理由

v1.13.0 では、目的をより適切に反映するために設定キーの名前が変更されました。
「completion」という語は多義的でした（「エージェントが完了した」と 「completion
API の呼び出し」の両方を意味し得ます）。v1.13.0 では、
エージェント実行の終了判定に **verdict** を、 ステップ出力の検証に
**validation** を導入しました。

主要テーマ: すべての verdict タイプが `category:variant` の命名パターン
（例：`detect:keyword`、`count:iteration`）に従うようになり、
カテゴリからメカニズムが一目で分かるようになりました。

---

## 10.3 マイグレーションマッピング表

### 設定キーの名前変更 (`agent.json`)

| 旧パス (v1.12.0)           | 新パス (v1.13.0)        |
| -------------------------- | ----------------------- |
| `runner.completion.type`   | `runner.verdict.type`   |
| `runner.completion.config` | `runner.verdict.config` |

### 設定フィールドの名前変更

| 旧フィールド        | 新フィールド     |
| ------------------- | ---------------- |
| `completionKeyword` | `verdictKeyword` |

### Verdict Type 列挙値の名前変更

すべての verdict タイプが `category:variant` パターンに従うようになりました：

| 旧値 (v1.12.0)     | 新値 (v1.13.0)      |
| ------------------ | ------------------- |
| `externalState`    | `poll:state`        |
| `iterationBudget`  | `count:iteration`   |
| `checkBudget`      | `count:check`       |
| `keywordSignal`    | `detect:keyword`    |
| `structuredSignal` | `detect:structured` |
| `stepMachine`      | `detect:graph`      |
| `composite`        | `meta:composite`    |
| `custom`           | `meta:custom`       |

### Steps Registry の名前変更 (`steps_registry.json`)

| 旧キー (v1.12.0)       | 新キー (v1.13.0)       |
| ---------------------- | ---------------------- |
| `completionConditions` | `validationConditions` |
| `completionSteps`      | `validationSteps`      |
| `completionPatterns`   | `failurePatterns`      |

### C3L ディレクトリの名前変更

| 旧 c3 値 (v1.12.0) | 新 c3 値 (v1.13.0) |
| ------------------ | ------------------ |
| `iterate`          | `iteration`        |
| `externalState`    | `polling`          |

---

## 10.4 変更前 / 変更後の例

### `agent.json`

#### v1.12.0 (旧)

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Example agent",
  "version": "1.0.0",
  "parameters": {},
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "completion": {
      "type": "keywordSignal",
      "config": { "completionKeyword": "DONE" }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write"],
      "permissionMode": "plan"
    }
  }
}
```

#### v1.13.0 (新)

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Example agent",
  "version": "1.0.0",
  "parameters": {},
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "verdict": {
      "type": "detect:keyword",
      "config": { "verdictKeyword": "DONE" }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write"],
      "permissionMode": "plan"
    }
  }
}
```

### `steps_registry.json`

#### v1.12.0 (旧)

```json
{
  "steps": [
    {
      "name": "plan",
      "completionConditions": { "type": "allFilesWritten" },
      "completionSteps": ["implement"],
      "completionPatterns": {
        "git-dirty": { "edition": "failed", "adaptation": "git-dirty" }
      }
    }
  ]
}
```

#### v1.13.0 (新)

```json
{
  "steps": [
    {
      "name": "plan",
      "stepKind": "work",
      "validationConditions": { "type": "allFilesWritten" },
      "validationSteps": ["implement"],
      "failurePatterns": {
        "git-dirty": { "edition": "failed", "adaptation": "git-dirty" }
      }
    }
  ]
}
```

変更のポイント：

- `runner.completion` は `runner.verdict` になります。
- config オブジェクト内の `completionKeyword` は `verdictKeyword` になります。
- verdict タイプの値が camelCase 名から `category:variant` 形式に変更されます。
- Steps Registry のキー `completionConditions`、`completionSteps`、
  `completionPatterns` がそれぞれ `validationConditions`、`validationSteps`、
  `failurePatterns` になります。
- ステップにオプションの `stepKind` フィールドが追加されます（セクション 10.7
  参照）。

---

## 10.5 マイグレーション手順

1. **`runner.completion` を `runner.verdict` に更新します。**
   - `runner.completion.type` --> `runner.verdict.type`
   - `runner.completion.config` --> `runner.verdict.config`

2. **verdict タイプの値を名前変更します。** セクション 10.3
   のマッピングを使用して camelCase 名を `category:variant` 形式に変換します。

3. **設定フィールドを名前変更します。**
   - `completionKeyword` --> `verdictKeyword`（`runner.verdict.config` 内）

4. **`steps_registry.json` のキーを更新します。**
   - `completionConditions` --> `validationConditions`
   - `completionSteps` --> `validationSteps`
   - `completionPatterns` --> `failurePatterns`

5. **C3L ディレクトリを名前変更します**（カスタムプロンプトツリーがある場合）。
   - `iterate/` --> `iteration/`
   - `externalState/` --> `polling/`

6. **検証します。** 新しい `--validate` フラグを使用して、
   実行前に設定を確認します：

   ```bash
   deno task agent --agent {name} --validate
   ```

---

## 10.6 新機能

### `--validate` CLI オプション

v1.13.0 では、エージェントを実行せずに `agent.json` と `steps_registry.json`
の構造エラーをチェックする `--validate` フラグが追加されました：

```bash
deno task agent --agent my-agent --validate
```

### `stepKind` 列挙値

`steps_registry.json` の各ステップで、役割を分類する `stepKind`
を宣言できるようになりました：

| 値             | 意味                                                     |
| -------------- | -------------------------------------------------------- |
| `work`         | 出力を生成します（コード、テキスト、アーティファクト）。 |
| `verification` | 前の work ステップの出力を検証します。                   |
| `closure`      | 実行を完了します（マージ、PR、Issue の更新）。           |

### Facilitator Agent

v1.13.0 では、マルチステップパイプラインを調整する **facilitator**
エージェントが 導入されました。facilitator は `stepKind`
アノテーションを読み取って実行順序を決定し、 `failurePatterns`
によるリトライロジックを含むステップ間の遷移を処理します。

---

## 10.7 ファイル名変更（フレームワーク開発者向け）

内部モジュールを直接インポートしている場合（例：カスタム verdict ハンドラ用）、
以下のソースファイルの名前変更に注意してください：

| 旧パス (v1.12.0)         | 新パス (v1.13.0)      |
| ------------------------ | --------------------- |
| `completion-types.ts`    | `validation-types.ts` |
| `completion-manager.ts`  | `closure-manager.ts`  |
| `completion-chain.ts`    | `validation-chain.ts` |
| `agents/completion/`     | `agents/verdict/`     |
| `validators/completion/` | `validators/step/`    |

これらのパスを参照している直接インポートを更新してください。

---

## 10.8 トラブルシューティング

### "Unknown verdict type" エラー

v1.12.0 の camelCase タイプ名を使用しています。セクション 10.3
のマッピングを使用して 変換してください（例：`keywordSignal` -->
`detect:keyword`）。

### "Unknown key: runner.completion"

`runner.completion` キーはもう存在しません。`runner.verdict`
に名前変更してください。

### "Unknown key: completionConditions"

Steps Registry のキーが名前変更されました。セクション 10.3
のレジストリマッピングを 参照してください。

### C3L プロンプトが見つからない

旧 `iterate/` または `externalState/`
ディレクトリ下のプロンプトが読み込まれない場合、 ディレクトリをそれぞれ
`iteration/` と `polling/` に名前変更してください。
