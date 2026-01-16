# Step Flow Design

Flow ループが扱う Step の鎖を「単純だが堅牢な状態遷移」に落とし込むための設計。
What/Why を中心に記述し、How は設定例に留める。

## Why: 単方向と引き継ぎ

- Flow ループは「進む」以外をしない。Step Flow は遷移図を明文化し、戻る必要が
  ある場合でも Step 自身が `fallback` を宣言する。
- 各 Step は次の Step に渡す `handoff` を定義し、暗黙依存を排除する。
- ループに分岐ロジックや検証ロジックを埋め込まないことで、AI の局所最適化
  志向（哲学ドキュメント参照）による複雑化を防ぐ。

## What: Step の要素

| 要素         | 説明                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| `id`         | `s_<hash>` 形式で衝突しない識別子を持つ                                        |
| `prompt`     | C3L/Climpt 参照 (`c1/c2/c3/edition`) で docs に沿った管理を行う                |
| `handoff`    | `key` と説明文で構成。Runner は `uv-<id>_<key>` として StepContext に蓄積      |
| `iterations` | 同 Step 内で最低/最大実行回数を宣言（Flow ループは回数を尊重し前進だけを意識） |
| `transition` | `onPass`, `onFail`, `fallback`, `complete` など、次の Step を決定する宣言      |
| `check`      | Step 内完了のための軽量検証。Completion Loop ではなく Flow の局所判断に限定    |

## Step Flow のレイアウト

```
entryStep ──> analyze (handoff: issue_context)
               │
               ▼
             implement (handoff: plan, diff)
               │
               ▼
             review → signals completion
```

- `handoff.issue_context` は analyze の成果。implement は
  `uv-analyze_issue_context` を受け取る。
- review Step が Completion Loop へ signal を送る。Flow
  ループは完了判定をしない。

## Schema 例

```jsonc
{
  "$schema": "https://.../steps_registry.schema.json",
  "entryStep": "s_analysis",
  "steps": {
    "s_analysis": {
      "prompt": { "c1": "steps", "c2": "phase", "c3": "analyze" },
      "handoff": [{ "key": "issue_context", "description": "課題の再定義" }],
      "iterations": { "min": 1, "max": 1 },
      "check": { "onPass": { "next": "s_impl" } }
    },
    "s_impl": {
      "prompt": { "c1": "steps", "c2": "phase", "c3": "implement" },
      "handoff": [
        { "key": "plan", "description": "実装戦略" },
        { "key": "diff", "description": "適用する変更" }
      ],
      "iterations": { "min": 1, "max": 5 },
      "check": {
        "responseFormat": { "result": "ok|ng" },
        "onPass": { "next": "s_review" },
        "onFail": { "retry": true, "maxRetries": 2 }
      }
    },
    "s_review": {
      "prompt": { "c1": "steps", "c2": "phase", "c3": "review" },
      "handoff": [{ "key": "release_notes", "description": "成果の説明" }],
      "check": {
        "onPass": { "complete": true },
        "onFail": { "fallback": "s_impl" }
      }
    }
  }
}
```

## Prompt 呼び出しルール

- すべての Step とチェック用プロンプトは C3L 形式で参照する。
- Runner は docs/05_prompt_system.md
  の規則に従い、`prompts/<c1>/<c2>/<c3>/f_<edition>.md` を読み込むのみ。
- ユーザーは docs/ 以下を編集するだけで Step の内容を差し替えられる。Flow ループ
  はパスの実体を知らず、管理の負荷が上がらない。

## handoff の契約

| ルール                     | 理由                                   |
| -------------------------- | -------------------------------------- |
| Step ごとにキーを宣言する  | 暗黙共有をやめ、再利用可能性を高める   |
| 名前空間は `uv-<id>_<key>` | Key 衝突を防ぎ、参照元を即時に追跡可能 |
| Completion でも読み取る    | 最終報告で必要な情報を欠かさないため   |

## Flow ループでの使われ方

```ts
const step = registry.getStep(currentStepId);
const prompt = resolver.resolve(step.prompt, handoff.toPromptVars(step.id));
const response = sdk.complete(prompt);
const extracted = parser.extract(response, step.responseFormat);
handoff.merge(step.id, extracted.handoff);
```

ここでの `How` は最小限。Runner は Step が宣言したルール以外は知らず、Flow
ループが複雑になる余地を残さない。

## 完了との関係

- Step Flow は Completion Loop
  へ「完了シグナル」「handoff」「エビデンス」を渡す役目のみ。
- 完了処理が必要な場合でも Flow 側にロジックを書かず、Completion Loop に C3L
  プロンプトと schema で任せる。

Step Flow Design は、二重ループの中の Flow 部分を視覚化した契約であり、機能美
を壊さないための最小限の図面である。
