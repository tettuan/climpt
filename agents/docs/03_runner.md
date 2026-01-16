# Runner

Agent 実行エンジン。定義を読み、Flow ループと Completion ループの二重構造を維持
するだけに徹する。

## 役割

| What                               | Why                                                |
| ---------------------------------- | -------------------------------------------------- |
| 定義の読み込みと検証               | 変動を実行開始前に封じ、エントロピーを増やさない   |
| Flow ループの進行管理              | Steps を順序通りに進め、状態を巻き戻さない         |
| Completion ループのトリガー制御    | 完了判定をメイン処理から切り離し、責務の重力に従う |
| handoff / structured output の保持 | 次ステップと完了処理へ情報を流し、暗黙の共有を排除 |

## ループ構造

```
Flow Loop
  prompt = resolve(step, handoff)
  response = queryLLM(prompt)
  handoff = merge(handoff, extract(response))
  if completionSignal(response): trigger Completion Loop
```

```
Completion Loop
  completionPrompt = resolve(c3l.complete, response, handoff)
  completionResult = queryLLM(completionPrompt)
  validation       = runCompletionConditions(completionResult)
  if done: return success
  else:    return retryPrompt (used as next Flow prompt)
```

Runner は2つの while を書かない。Flow ループは「継続」だけを担い、Completion
ループは `completionSignal` を条件に起動される単発処理で、戻り値だけで同期する。

### Flow ループ

- **What**: `steps_registry.json` の Step を順番に実行し、`handoff` を更新する。
- **Why**: AI が得意な「連続作業」を乱さず、収束判断を後工程に委譲するため。
- **最小限の How**:
  - プロンプト参照は C3L 形式 (`c1/c2/c3 + edition`) のみ。Runner は
    docs/05_prompt_system.md に従ってファイルを読む。
  - Step の出力から `completionSignal`（structured output の `status` または
    `next_action`）を取り出す。
  - `handoff` は Step ID 名前空間で累積し、次ステップの変数として注入する。

### Completion ループ

- **What**: 完了宣言を受け取った iteration
  だけで走り、完了条件の検証と後処理を行う。
- **Why**: 完了チェックの複雑さを Flow に持ち込まず、失敗時に retryPrompt を返す
  仕組みへ収束させるため。
- **最小限の How**:
  - `steps/complete/*` の C3L プロンプトで完了指示を生成。ユーザーは docs/
    に従って プロンプトを管理できる。
  - Structured Output Schema (`outputSchemaRef`) があれば FormatValidator
    を使用し、 JSON 抽出後に CompletionValidator を走らせる。
  - 失敗時は Completion Loop が返す `pendingActions` を RetryHandler に渡し、
    次の Flow ループへ渡す C3L 指示文を構築する。

## 実行シーケンス

1. **load()**: agent.json / steps_registry.json / schemas / prompts
   を検証済み構造体に変換。
2. **init()**: PromptResolver, CompletionChain, FormatValidator, RetryHandler
   を生成。
3. **runFlow()**:
   - Step プロンプト解決 → LLM 呼び出し → structured output 抽出 → handoff
     更新。
   - `completionSignal` が無ければ次 Step へ遷移。
4. **runCompletion()** (signal ありのときだけ):
   - Completion プロンプトを C3L から解決。
   - Structured Output + completionConditions で完了状態を判断。
   - `retryPrompt` があれば Flow の次 iteration へ渡す。
5. **result()**: `success`, `reason`, `iterations` を返す。Flow
   が止まらなければ完了しない。

## 主なコンポーネント

| コンポーネント        | What                                       | Why                                    |
| --------------------- | ------------------------------------------ | -------------------------------------- |
| `PromptResolver`      | C3L 参照をローカルパスに射影し、本文を返す | プロンプトの所在を Agent から隠す      |
| `CompletionChain`     | completionSteps を解決し、検証を実行する   | Completion ループの一貫性を保つ        |
| `CompletionValidator` | `completionConditions` を評価              | 外部状態（git, test 等）の差分検出     |
| `FormatValidator`     | Structured Output を schema で検証         | LLM の出力揺らぎを Flow へ持ち込まない |
| `RetryHandler`        | failure pattern から C3L プロンプトを生成  | 失敗理由をそのまま次の指示へ反映       |

## リトライ設計

- **形式リトライ**: `responseFormat` が設定された Step
  のみ。最大試行回数を超えると warning を添えて Flow 継続。
- **完了リトライ**: Completion Loop が `pendingActions`
  を返した場合、RetryHandler が生成した プロンプトを Flow ループに注入し、目的の
  Step を再実行させる。

## 成果としての出力

Runner の `AgentResult` は 3 つだけを報告する。

```ts
interface AgentResult {
  success: boolean; // Completion Loop が allComplete を返したか
  reason: string; // Flow/Completion どちらで止まったのか（人が読むメッセージ）
  iterations: number; // Flow ループを何回まわしたか
}
```

この 3 つを正確に届けることが Runner
の最終責務であり、余計な状態や副作用を持ち込まない。
