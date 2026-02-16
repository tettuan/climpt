---
name: implement-logger
description: Use when adding BreakdownLogger to test files, designing KEY names, or planning logger placement. Guides concern-based KEY naming, placement rules, and validation. Trigger words - "implement logger", "add logger", "ロガー追加", "KEY naming", "KEY設計", "ログ配置".
allowed-tools: [Read, Glob, Grep, Bash, Task]
---

# Implement Logger

テスト失敗時に「何の判断が間違ったか」を即座に特定するため、concern-based KEY でロガーを配置する。

## Debugging Concerns Map

| KEY | 問い | テストファイル |
|-----|------|---------------|
| `config` | 定義は正しく読まれたか？ | `loader_test.ts` |
| `factory` | どの実装が選ばれたか？ | `builder_test.ts` |
| `flow` | どの step に解決されたか？ | `flow-orchestrator_test.ts` |
| `gate` | AI 出力からどの intent を抽出したか？ | `step-gate-interpreter_test.ts` |
| `transition` | intent からどの step に飛んだか？ | `workflow-router_test.ts` |
| `schema` | スキーマは解決できたか？ | `structured-output_test.ts` |
| `completion` | 出力は完了条件を満たしたか？ | `completion-manager_test.ts` |
| `error` | どのカテゴリに分類されたか？ | `error-classifier_test.ts` |
| `iteration` | ループのどこで止まったか？ | `runner_test.ts` |
| `integration` | E2E フロー全体は？ | `dry-run-integration_test.ts` |

## KEY 命名規約

ファイル名でなく判断の concern で命名する（`"gate"` not `"step-gate-interpreter"`）。

### 旧→新 KEY 移行表

| 旧 | 新 | 理由 |
|----|-----|------|
| `builder` | `factory` | 「何を build」→「どの実装が選ばれた」|
| `loader` | `config` | 「何を load」→「設定は正しい」|
| `agent-runner` | `iteration` | 「runner のどこ」→「ループのどこ」|
| `step-gate-interpreter` | `gate` | 短縮 + concern 名 |
| `workflow-router` | `transition` | 短縮 + concern 名 |
| `error-classifier` | `error` | 短縮 + concern 名 |
| `structured-output` | `schema` | 「出力形式」→「スキーマ検証」|

### デリミタ制約

`LOG_KEY` は `,` `:` `/` で分割して OR フィルタするため、KEY 名にこれらを含めてはならない。

```bash
LOG_KEY=flow/gate/transition  # → ["flow","gate","transition"] の OR
```

### グルーピング例

```bash
LOG_KEY=flow/gate/transition  # ルーティング全体
LOG_KEY=schema/completion     # 検証全体
LOG_KEY=factory/config        # DI + 設定
LOG_LEVEL=debug               # 全 concern（LOG_KEY 未設定）
```

### 制約

lowercase kebab-case のみ。汎用名 (`util`,`helper`) 禁止。1 ファイル 1 KEY。一時キーは `fix-<issue>` prefix で作成し調査後削除。

## KEY Discovery

新規 KEY 作成前に重複を検索する。

```bash
grep -rn 'new BreakdownLogger(' --include='*.ts' agents/ | grep -oP '"[^"]*"' | sort -u
```

既存 KEY がカバーするなら再利用、広すぎるなら分割、該当なしなら Concerns Map に照らして命名する。

## 配置ルール P1-P4

判断の境界点（入力→処理→出力）にロガーを置き、何が起きたかを追跡可能にする。

**P1**: import 直後に 1 ファイル 1 KEY で宣言する。

```typescript
import { BreakdownLogger } from "@tettuan/breakdownlogger";
const logger = new BreakdownLogger("gate");
```

**P2**: 判断入力 — 関数呼び出し前に引数を記録する。
**P3**: 判断結果 — 関数呼び出し後に返却値を記録する。
**P4**: Assertion 文脈 — 複数フィールド検証前に全体像を記録する。

```typescript
logger.debug("gate input", { aiOutput });           // P2
const intent = interpreter.interpret(aiOutput);
logger.debug("gate result", { intent });             // P3
logger.debug("schema validation", { valid, errors, fieldCount }); // P4
```

## カテゴリ別ログパターン

各 concern で入力と結果の対を記録する。

| KEY | 入力ログ | 結果ログ |
|-----|---------|---------|
| `factory` | `"factory resolve", { requestedType }` | `"factory resolved", { resolvedImpl }` |
| `gate` | `"gate input", { rawOutput }` | `"gate extracted", { intent, confidence }` |
| `transition` | `"transition input", { currentStep, intent }` | `"transition resolved", { nextStep }` |
| `schema` | `"schema resolve", { schemaId }` | `"schema found", { found: !!schema }` |
| `completion` | `"completion check", { criteria }` | `"completion result", { met, missing }` |
| `error` | `"error input", { errorType, message }` | `"error classified", { category, retryable }` |
| `iteration` | `"iteration start", { attempt, max }` | `"iteration end", { attempt, outcome }` |

## Writing Style

`LOG_LENGTH` は末尾から切り詰めるので、concern + 動作を先頭 40 字に置く。メッセージ = 何が起きたか、data = 証拠。

```typescript
// Good: "gate extracted intent=proceed"
// Bad:  "processing the AI output to determine what the gate should do"
```

## Validation

```bash
deno run --allow-read jsr:@tettuan/breakdownlogger/validate ./agents
```

## Checklist

```
- [ ] 既存 KEY 検索済み — 重複なし
- [ ] KEY 名は Concerns Map 準拠、デリミタ文字なし
- [ ] 1 ファイル 1 KEY（P1）
- [ ] P2/P3: 判断の入力と結果にロガー配置
- [ ] P4: 複雑な assertion 前に文脈記録
- [ ] メッセージ先頭 40 字に重要情報、data で証拠
- [ ] 循環参照オブジェクトなし
- [ ] validate で本番混入なし確認
- [ ] 調査完了した fix-* ロガーは削除済み
```

## Anti-patterns

| パターン | 問題 |
|---------|------|
| タイトループ内 | 出力洪水でシグナルが埋没 |
| 全行の後 | ナレーションになる |
| `data` パラム無し | 根本原因が見えない |
| ファイル名を KEY に | 「何の判断？」に答えない |
| KEY にデリミタ文字 | フィルタリングが壊れる |

## Execution Policy

KEY 設計はメインで判断し、ロガー追加は `general-purpose` sub agent、validate は `Bash` sub agent に委譲する。

## Related Skills

- **`test-investigation`** (`/breakdown-logger`): ロガー実装後の調査・デバッグワークフロー
