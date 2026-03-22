# Smoke Test 実行手順

## 既存テストスクリプト

```bash
# ターミナルから実行（Claude Code 内からは非推奨）
bash examples/scripts/run-test-runner-minimal.sh
```

このスクリプトは:
1. `$TMPDIR` に最小 agent 構成を自動生成
2. `run-agent.ts` を直接コール (acceptEdits, maxIterations: 1)
3. sentinel ファイルの作成で LLM 実行を検証
4. PASS / FAIL を判定

## 手動で実行する場合

```bash
# examples/ を cwd にして既存 agent を直接コール
cd examples
deno run --allow-all ../agents/scripts/run-agent.ts \
  --agent iterator --issue 999
```

## 最小 Agent 構成の要件

Smoke test 用 agent に必要なファイル:

```
.agent/{name}/
  agent.json              # permissionMode: acceptEdits, worktree: false
  steps_registry.json     # 2 steps: initial.task → closure.done
  prompts/
    system.md
    steps/initial/task/f_default.md
    steps/closure/done/f_default.md

.agent/climpt/config/
  {name}-steps-app.yml    # working_dir, app_prompt.base_dir
  {name}-steps-user.yml   # params.two.directiveType/layerType patterns
```

## user.yml の必須フォーマット

```yaml
params:
  two:
    directiveType:
      pattern: "^(initial|closure|system)$"    # c2 の許容値
    layerType:
      pattern: "^(task|done|prompt)$"          # c3 の許容値
```

`user_prompt.base_dir` 形式ではなく `params.two` 形式が必須。
これを間違えると breakdown が silent fail する。

## 検証範囲の図

```
                       Smoke Test の範囲
                  ┌─────────────────────────┐
run-all.sh ──→ run.sh ──→ │ run-agent.ts          │
                           │   ↓ loadConfiguration │
                           │   ↓ AgentRunner.run()  │
                           │   ↓ prompt resolution  │
                           │   ↓ SDK query()        │
                           │   ↓ verdict check      │
                           └─────────────────────────┘
              ↑ ここは検証外    ↑ ここを検証
```
