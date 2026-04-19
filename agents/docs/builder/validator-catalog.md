# Validator Catalog

`validationSteps` の `preflightConditions` / `postLLMConditions` に配線する
validator の契約を定義する。

---

## Rules

### R-V1. Phase 宣言は必須

全ての `validators[name]` は `phase: "preflight" | "postllm"`
を宣言する。未宣言の validator を `validationSteps` の任意の slot に配線するのは
load-time error。

### R-V2. Phase と Slot は一致しなければならない

| Slot                  | 要求される `validator.phase` |
| --------------------- | ---------------------------- |
| `preflightConditions` | `"preflight"`                |
| `postLLMConditions`   | `"postllm"`                  |

不一致は load-time error (`EXPECTED_PHASE` による強制)。

### R-V3. Preflight は純粋述語

- LLM 呼び出し **前** に評価される
- 失敗すると **即時 abort** する（retry しない）
- 戻り値: `{ valid: boolean; reason?: string }` のみ
- `retryPrompt` / `action` は型システムで禁止

**理由**: pre-flight で retry prompt を生成しても、処理は LLM に到達せず prompt
が破棄される。self-gating retry の無限ループを型レベルで禁止する。

### R-V4. PostLLM は LLM-driven remediation

- LLM 呼び出し **後** に評価される
- 失敗すると `onFailure.action` (`retry` / `abort` / `skip`) に従う
- 戻り値: `{ valid: boolean; retryPrompt?: string; action?: FailureAction }`
- retry counter が適用され、`onFailure.maxAttempts` で打ち切る

### R-V5. Legacy field `validationConditions` は拒否

`validationSteps[stepId].validationConditions` は load-time
に明示的にエラーとなる。後方互換性は無い。

---

## Configuration Shape

### Validator definition

```json
{
  "validators": {
    "git-clean": {
      "type": "command",
      "phase": "postllm",
      "command": "git status --porcelain",
      "successWhen": "empty",
      "failurePattern": "git-dirty",
      "extractParams": { "changedFiles": "stdout" }
    }
  }
}
```

### ValidationStep slot 配線

```json
{
  "validationSteps": {
    "closure.issue": {
      "stepId": "closure.issue",
      "name": "Issue Closure Validation",
      "c2": "closure",
      "c3": "issue",
      "preflightConditions": [],
      "postLLMConditions": [
        { "validator": "git-clean" },
        { "validator": "type-check" }
      ],
      "onFailure": { "action": "retry", "maxAttempts": 2 }
    }
  }
}
```

---

## Decision Matrix

validator を書く前に、これが何をしたいかで phase を決める。

| 目的                                                   | Phase       | 例                                      |
| ------------------------------------------------------ | ----------- | --------------------------------------- |
| LLM 呼び出しの前提条件を検査（満たないなら実行しない） | `preflight` | `env-var-check`, `repo-initialized`     |
| LLM の出力結果を検証（失敗時に LLM に修正依頼）        | `postllm`   | `git-clean`, `type-check`, `tests-pass` |

**判定基準**: 「失敗時に LLM に指示を出すか？」

- Yes → `postllm`（retry prompt で LLM に修正依頼）
- No → `preflight`（abort して運用者に差し戻す）

---

## Common Pitfall

### Anti-pattern: Pre-flight で状態を修正依頼

```
preflightConditions: [{ validator: "git-clean" }]  // 悪い例
```

pre-flight で `git-clean` が失敗しても LLM は呼び出されないので `retryPrompt`
は捨てられる。`maxAttempts` を消費し続けて abort に至るだけ。

**修正**: mutating work step の後に
`postLLMConditions: [{ validator: "git-clean" }]` を置き、LLM に commit
するよう指示する。

---

## Load-time Enforcement

`agents/config/registry-validator.ts` が次を検査する:

1. `validationConditions` (legacy) は使用禁止
2. validator が `phase` を宣言しているか
3. slot と `phase` が一致しているか
4. 参照される validator が `validators` に存在するか

いずれかに違反すると `AgentDefinitionError` を throw し、runner は起動しない。

---

## 関連ドキュメント

| ドキュメント                                                     | 内容                               |
| ---------------------------------------------------------------- | ---------------------------------- |
| [09_closure_output_contract.md](./09_closure_output_contract.md) | Closure step の出力契約            |
| [reference/steps_registry.yaml](./reference/steps_registry.yaml) | `steps_registry.json` 全フィールド |
