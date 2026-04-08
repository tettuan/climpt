# 2. Integrity Rules

AgentBlueprint の存在意義は、以下のルールを **1つの JSON Schema で形式的に検証**
することにある。

**v2.2**: fallback システム削除 (C3L が唯一のプロンプト解決パス) を反映。R-E2
削除、R-F9 から `fallbackKey` 除去。51 ルール。

**v2.1**: 24エージェントによる検証結果 (06-evaluation.md) を反映。38 → 52
ルール。

## ルール一覧

### Category A: agent ↔ registry 間

agent セクションと registry セクションの相互参照。

| ID    | ルール                                                                                           | 検証内容                                                                                                           | Schema 表現       |
| ----- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| R-A1  | `agent.name` = `registry.agentId`                                                                | 名前の一致                                                                                                         | const / cross-ref |
| R-A2  | `agent.parameters` keys ⊇ (全 step の `uvVariables` 和集合) - `registry.runtimeUvVariables` keys | UV 変数に対応するパラメータが存在。runtime 供給変数は `registry.runtimeUvVariables` に明示宣言し、チェックから除外 | if/then + $ref    |
| R-A2b | `registry.runtimeUvVariables` の全 key が少なくとも1つの step の `uvVariables` に出現            | 宣言された runtime 変数が実際に使われている (stale 防止)                                                           | cross-ref         |
| R-A3  | `entryStepMapping` 使用時: `agent.runner.verdict.type` ∈ `registry.entryStepMapping` keys        | verdict type にエントリが存在。`entryStep` (singular) 使用時は本ルール不適用 (R-A6 で検証)                         | cross-ref         |
| R-A4  | `registry.entryStepMapping[*]` ∈ `registry.steps` keys                                           | entryStepMapping の全 value が step として存在                                                                     | cross-ref         |
| R-A5  | step の `condition` 内の `args.*` 参照が `agent.parameters` keys に存在                          | 条件式で参照するパラメータが宣言済み                                                                               | cross-ref         |
| R-A6  | `registry.entryStep` (singular) 使用時: その値 ∈ `registry.steps` keys                           | entryStep の遷移先 step が存在                                                                                     | cross-ref         |

> **Implementation note**: UV reachability validator は Channel 1 (CLI
> parameters) のみを強制する。runtime 供給変数 (Channel 2, 3) で
> `runtimeUvVariables` に宣言されたものは R-A2
> のパラメータカバレッジチェックから除外されるが、validator はそれらの runtime
> 可用性を検証しない。

### Category B: step 内部整合

各 step 定義内のフィールド間整合性。

| ID    | ルール                                                                                                                                                  | 検証内容                                                                                                           | Schema 表現          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------- |
| R-B1  | `step.stepId` = object key                                                                                                                              | stepId とキーの一致                                                                                                | pattern              |
| R-B2  | c2 → stepKind 対応                                                                                                                                      | c2=initial/continuation → stepKind=work or verification。c2=closure → stepKind=closure。c2=section → stepKind 不要 | if/then              |
| R-B3  | `allowedIntents` ⊆ `STEP_KIND_ALLOWED_INTENTS[stepKind]`                                                                                                | stepKind に許可された intent のみ                                                                                  | if/then              |
| R-B4  | `transitions` の intent キー = `allowedIntents`。`fallback` は非 intent 予約キーとして除外                                                              | 全 intent に transition が定義されている。fallback は intent ではない                                              | cross-ref            |
| R-B5  | direct transition: `transitions[*].target` ∈ `steps` keys ∪ {null}。conditional transition: `transitions[*].targets` の全 value ∈ `steps` keys ∪ {null} | 遷移先 step が存在 (null は terminal)。`{condition, targets}` 構造と `{target}` 構造の両方を検証                   | cross-ref            |
| R-B6  | flow step (c2 ≠ section) は `structuredGate` + `transitions` + `outputSchemaRef` 必須                                                                   | section 以外の step にフロー制御が存在                                                                             | required             |
| R-B7  | `structuredGate.intentSchemaRef` は `#/` で始まる内部 JSON Pointer                                                                                      | 外部ファイル参照でない                                                                                             | pattern              |
| R-B8  | `structuredGate.intentField` は必須                                                                                                                     | intent 抽出パスが存在                                                                                              | required             |
| R-B9  | `structuredGate.fallbackIntent` (存在時) ∈ `STEP_KIND_ALLOWED_INTENTS[stepKind]`                                                                        | fallback も許可 intent                                                                                             | if/then              |
| R-B10 | `stepKind` 明示必須 (flow step)                                                                                                                         | structuredGate がある step は stepKind を持つ                                                                      | required             |
| R-B11 | section step (c2=section) は `structuredGate`, `transitions`, `outputSchemaRef`, `stepKind` を持たない                                                  | section step にフロー制御が存在しない                                                                              | if/then (prohibited) |
| R-B12 | `transitions` の `fallback` キーは `allowedIntents` に含めてはならない                                                                                  | fallback は非 intent 予約キー。intent として宣言すると R-B3 に違反する                                             | cross-ref            |
| R-B13 | 全 step が entry point (entryStep or entryStepMapping の value) から transitions を辿って到達可能                                                       | orphaned step がない (reachability)                                                                                | runtime 検証         |
| R-B14 | `allowedIntents` に `jump` を含む場合、`structuredGate.targetField` が必須                                                                              | jump 先の抽出パスが存在                                                                                            | if/then              |
| R-B15 | `allowedIntents` に `handoff` を含む場合、`structuredGate.handoffFields` が存在 (空配列可)                                                              | handoff データの受け渡しパスが宣言されている                                                                       | if/then              |

### Category C: validator ↔ failurePattern 間

バリデーション機構の内部参照。

| ID   | ルール                                                                      | 検証内容               | Schema 表現 |
| ---- | --------------------------------------------------------------------------- | ---------------------- | ----------- |
| R-C1 | `validators[*].failurePattern` ∈ `failurePatterns` keys                     | 失敗パターンが定義済み | cross-ref   |
| R-C2 | `validationSteps[*].validationConditions[*].validator` ∈ `validators` keys  | バリデータが定義済み   | cross-ref   |
| R-C3 | direct transition の `fallback` フィールド (存在時) ∈ `steps` keys          | fallback 遷移先が存在  | cross-ref   |
| R-C4 | conditional transition の `targets` 内の全 value ∈ `steps` keys ∪ {null}    | 条件分岐先が全て存在   | cross-ref   |
| R-C5 | `validationSteps[*].onFailure.action` ∈ {retry, abort, skip}                | 有効な failure action  | enum        |
| R-C6 | `validationSteps[*].onFailure.maxAttempts` は正の整数 (action=retry 時必須) | リトライ回数の有効性   | minimum: 1  |

### Category D: step ↔ schema 間

step 定義と出力 schema の対応。

| ID   | ルール                                                                                       | 検証内容                                                      | Schema 表現  |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------ |
| R-D1 | `outputSchemaRef.file` ∈ `schemas` keys                                                      | schema ファイルが Blueprint 内に存在                          | cross-ref    |
| R-D2 | `outputSchemaRef.schema` が `schemas[file]` 内の定義に存在                                   | schema 定義が存在 (`definitions` or `$defs` or top-level key) | cross-ref    |
| R-D3 | schema の `next_action.action.enum` = `allowedIntents`                                       | intent enum が一致                                            | cross-ref    |
| R-D4 | `structuredGate.handoffFields` の各パスが `outputSchemaRef` で参照される schema 内で解決可能 | handoff データパスが schema 定義に対応                        | runtime 検証 |

### Category E: naming convention

命名規則の検証。

| ID   | ルール                                                                               | 検証内容                                                                                                    | Schema 表現       |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------- |
| R-E1 | stepId prefix ∈ {initial, continuation, closure, section, verification} が c2 と一致 | 命名と C3L パスの対応。verification step は c2=verification を持つべき (ただし既存互換で c2=initial も許容) | pattern + if/then |
| R-E3 | `c3` は `^[a-z]+(-[a-z]+)*$`                                                         | kebab-case                                                                                                  | pattern           |

### Category F: フィールド型・存在・enum

基本的な型制約と必須フィールド。

| ID    | ルール                                                                                                  | 検証内容                       | Schema 表現                 |
| ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------- |
| R-F1  | `agent.name` は `^[a-z][a-z0-9-]*$`                                                                     | kebab-case                     | pattern                     |
| R-F2  | `agent.version` は `^\d+\.\d+\.\d+$`                                                                    | semver                         | pattern                     |
| R-F3  | `agent.runner.verdict.type` ∈ VerdictType enum (8値)                                                    | 有効な verdict type            | enum                        |
| R-F4  | `agent.runner.boundaries.permissionMode` ∈ {default, plan, acceptEdits, bypassPermissions}              | 有効な permission mode         | enum                        |
| R-F5  | `agent.parameters[*].type` ∈ {string, number, boolean, array}                                           | パラメータ型が有効             | enum                        |
| R-F6  | `agent.parameters[*].cli` は `^--[a-z][a-z0-9-]*$`                                                      | CLI flag 形式                  | pattern                     |
| R-F7  | `step.uvVariables` は array                                                                             | 型制約                         | type: array                 |
| R-F8  | `step.usesStdin` は boolean                                                                             | 型制約                         | type: boolean               |
| R-F9  | `step.name`, `step.c2`, `step.c3`, `step.edition` は非空文字列                                          | 必須フィールド                 | minLength: 1                |
| R-F10 | `outputSchemaRef` は `file` (string) + `schema` (string)                                                | 構造制約                       | properties                  |
| R-F11 | `entryStep` XOR `entryStepMapping` (少なくとも一方必須)                                                 | エントリポイント存在           | oneOf                       |
| R-F12 | verdict config は type に応じた必須フィールドを持つ (下表参照)                                          | strategy-dependent validation  | if/then discriminated union |
| R-F13 | `step.model` (存在時) ∈ {sonnet, opus, haiku}                                                           | 有効なモデル名                 | enum                        |
| R-F14 | `structuredGate.targetMode` (存在時) ∈ {explicit, dynamic, conditional}                                 | 有効な target mode             | enum                        |
| R-F15 | `meta:composite` verdict の `config.conditions[*].type` ∈ VerdictType (meta:composite 自身を除く)       | 再帰防止 + 有効な verdict type | enum                        |
| R-F16 | `agent.parameters[*].validation` のキー ∈ {min, max, pattern, enum}                                     | 有効な validation キーワード   | enum                        |
| R-F17 | `agent.parameters[*].required` は boolean                                                               | 型制約                         | type: boolean               |
| R-F18 | `agent.runner.logging.format` (存在時) ∈ {jsonl, text}                                                  | 有効なログ形式                 | enum                        |
| R-F19 | `agent.runner.integrations.github.defaultClosureAction` (存在時) ∈ {close, label-only, label-and-close} | 有効な closure action          | enum                        |
| R-F20 | `step.priority` (存在時) は正の整数                                                                     | 優先度の有効性                 | type: integer, minimum: 1   |

## R-F12: Verdict Config 必須フィールド一覧

| VerdictType         | 必須フィールド                                  | 任意フィールド                              |
| ------------------- | ----------------------------------------------- | ------------------------------------------- |
| `poll:state`        | maxIterations                                   | resourceType, targetState, issueParam, type |
| `count:iteration`   | maxIterations                                   | iterationParam                              |
| `count:check`       | maxChecks                                       | counterParam                                |
| `detect:keyword`    | verdictKeyword                                  | maxIterations                               |
| `detect:structured` | signalType                                      | requiredFields, maxIterations               |
| `detect:graph`      | registryPath, entryStep                         | maxIterations                               |
| `meta:composite`    | operator ∈ {and, or, first}, conditions (array) | maxIterations                               |
| `meta:custom`       | handlerPath                                     | maxIterations                               |

## 遷移 (Transition) の2つの構造

### Direct transition

```json
{ "target": "step-id" }
{ "target": null }
```

### Direct transition with fallback

```json
{ "target": "step-id", "fallback": "fallback-step-id" }
```

### Conditional transition

```json
{
  "condition": "output.field.name",
  "targets": {
    "value1": "step-a",
    "value2": "step-b",
    "default": "step-c"
  }
}
```

R-B5 は3つの構造全てを検証する。

## JSON Schema で表現できる/できないルール

| 分類                                               | ルール数 | 備考                                                                               |
| -------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| **完全に表現可能** (pattern, enum, required, type) | 29       | F群全部、E3、B1, B7-B12, C5-C6 等                                                  |
| **部分的に表現可能** (if/then, cross-ref)          | 16       | A2-A6, B2-B5, B14-B15, C1-C4, D1-D3, E1 等                                         |
| **runtime 検証が必要**                             | 5        | B13 (reachability), D4 (handoffFields path), A5 (condition expression), R-F12 一部 |

Blueprint の構造的利点: **agent.json と registry と schemas
を1ファイルに統合することで、ファイル間参照が JSON 内参照に変わる。**
これにより、元々ファイル存在確認だった検証が JSON Schema の cross-ref
で検証可能になる。

## STEP_KIND_ALLOWED_INTENTS (参照用)

```
work:         [next, repeat, jump, handoff]
verification: [next, repeat, jump, escalate]
closure:      [closing, repeat]
```

## VerdictType enum (参照用)

```
poll:state, count:iteration, count:check,
detect:keyword, detect:structured, detect:graph,
meta:composite, meta:custom
```

## PermissionMode enum (参照用)

```
default, plan, acceptEdits, bypassPermissions
```

## Model enum (参照用)

```
sonnet, opus, haiku
```

## ClosureAction enum (参照用)

```
close, label-only, label-and-close
```

## FailureAction enum (参照用)

```
retry, abort, skip
```

## TargetMode enum (参照用)

```
explicit, dynamic, conditional
```

## LogFormat enum (参照用)

```
jsonl, text
```

## ParameterType enum (参照用)

```
string, number, boolean, array
```

## 変更履歴

### v2.1 → v2.2 (fallback システム削除)

**背景**: fallback システムが完全に削除され、C3L
が唯一のプロンプト解決パスとなった。 `path-validator.ts` は全 step の C3L
プロンプトファイル存在を検証し (欠落時 ERROR)、 `template-uv-validator.ts` は
C3L ファイル欠落時に警告を出す。

**削除 (1件)**:

- R-E2: `fallbackKey` = `{c2}_{c3}` 命名規則 — fallback システム廃止により不要

**修正 (1件)**:

- R-F9: 必須非空文字列フィールドから `step.fallbackKey` を除去

**合計**: 52 → 51 ルール

### v2.0 → v2.1 (24エージェント検証後)

**修正 (5件)**:

- R-A3: `entryStep` 使用時の除外条件を追加
- R-B2: verification stepKind と section c2 を追加
- R-B4: fallback を非 intent 予約キーとして除外
- R-B5: conditional transition `{condition, targets}` 構造を追加
- R-E1: verification を有効な c2/prefix に追加

**追加 (14件)**:

- R-A5 (condition の args.* 参照), R-A6 (entryStep singular)
- R-B11 (section step 制約), R-B12 (fallback 予約キー), R-B13 (reachability),
  R-B14 (jump → targetField), R-B15 (handoff → handoffFields)
- R-C5 (onFailure.action enum), R-C6 (maxAttempts 正整数)
- R-D4 (handoffFields schema パス)
- R-F13 (step.model enum), R-F14 (targetMode enum), R-F15 (composite conditions
  type), R-F16 (parameter.validation keys), R-F17 (required boolean), R-F18
  (logFormat enum), R-F19 (closureAction enum), R-F20 (priority 正整数)

**合計**: 38 → 52 ルール (v2.2 で R-E2 削除により 51 ルール)
