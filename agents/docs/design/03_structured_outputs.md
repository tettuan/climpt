# Completion Loop と Structured Output

Flow ループから切り離された完了サブループは、Structured Output を軸に
「仕事を終わらせたか」を判断する。ここでは **What/Why** を中心に設計を記述し、
How は必要最小限だけ残す。

## 目的

| What                                           | Why                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| 完了宣言の検証                                 | Flow ループから判断ロジックを排除し、複雑性の重力に従う            |
| 残作業の明文化                                 | 削除できるタスクを浮かび上がらせ、再実行の指示を一本化する         |
| Structured Output + 追加検証の連携             | LLM の揺らぎを受け止めつつ、git/test など客観的状態を照合する      |
| 完了プロンプトを C3L / docs ベースで管理させる | プロンプトの所在と意味をユーザーに開放し、変更のエネルギーを下げる |

## 触媒: completionSignal

Flow ループは Step が返す Structured Output から `completionSignal`
を検出したときだけ Completion Loop を呼び出す。

```
completionSignal(response) =
  response.status == "completed" OR
  response.next_action?.action == "closing"
```

これ以外のケースでは Flow は継続し、Completion Loop は存在を主張しない。

## Completion Loop の構成

1. **Prompt Resolution**
   - C3L (`steps/closure/<domain>/f_<edition>.md`)
     から完了指示用プロンプトを読み込む。
   - design/02_prompt_system.md 同様のルールで解決するため、ユーザーは Step
     プロンプトと同じリズムで管理できる。

2. **Structured Output 取込み**
   - `.agent/<agent>/schemas/*.schema.json` の該当セクションで JSON Schema
     を定義。
   - SDK の `outputFormat` 機能が schema 検証を担う（SDK 委譲）。 検証済み値が
     Completion Loop へ渡される。

3. **Completion Conditions**
   - `steps_registry.json` の `completionSteps.<id>.completionConditions[]`
     で宣言。
   - 各 validator (git clean, type check, tests, lint 等) は `Why: エビデンス`
     に対応づけられており、未達時は `pattern` と `params` を返す。

4. **Decision & Retry**
   - `allComplete = true` の場合、Completion Loop は `success` を Flow へ返す。
   - `false` の場合、`pendingActions` から RetryHandler が C3L (`steps/retry/*`)
     を解決し、 Flow の次 iteration で使う `retryPrompt` を生成する。

## データモデル

```jsonc
{
  "completionSteps": {
    "closure.issue": {
      "prompt": { "c1": "steps", "c2": "closure", "c3": "issue" },
      "outputSchemaRef": {
        "file": "issue.schema.json",
        "schema": "closure.issue"
      },
      "completionConditions": [
        { "validator": "git-clean" },
        { "validator": "type-check" }
      ],
      "onFail": { "retry": true, "maxAttempts": 2 }
    }
  }
}
```

- **What**: completion step と schema を紐づけ、構造化レスポンスを期待する。
- **Why**: docs に並ぶ完了チェックリストをそのままコードへ反映するため。
- **How (最小限)**: Runner は `PromptResolver` と `CompletionChain` を通じて
  プロンプト → Structured Output → validator 実行 → retryPrompt
  の順に進めるだけである。

## retryPrompt の扱い

```
if (!allComplete) {
  pendingRetryPrompt = completionLoop.buildRetryPrompt(pendingActions)
  FlowLoop.nextPrompt = pendingRetryPrompt
}
```

Flow ループが再開するとき、`pendingRetryPrompt` があれば最優先で使用する。
これにより「完了判定の再実行」が Flow を分断せずに済む。

## なぜ Structured Output なのか

- **重力**: 完了判定に必要な情報を 1 つのオブジェクトに凝集させる。
- **収束**: 同じ Schema を繰り返し使うほど信頼度が上がる。
- **エントロピー**:
  判定材料がテキストに散らばらないため、時間と共に複雑性が上がらない。

## 実装ノート

| 領域                     | 状況     | Why                                                       |
| ------------------------ | -------- | --------------------------------------------------------- |
| Structured Output Schema | 運用中   | 完了宣言を明示的に検証する唯一のソース                    |
| FormatValidator          | SDK 委譲 | SDK の outputFormat 機能に委譲。Runner 側での再検証は不要 |
| CompletionConditions     | 安定     | git/type/lint/test 等はここで宣言し、Flow から切り離す    |
| RetryPrompts             | 運用中   | `steps/retry/*` を C3L で管理し、手作業リトライを排除     |

Completion Loop は「完璧な終了体験」を作るための最小構成であり、余計な判断を
Flow に流さないことだけを約束する。Structured Output
はその約束を支える骨格である。
