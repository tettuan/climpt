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
Flow Loop (単一の while)
  step    = resolveNextStep(intent, transitions)    // Step 遷移 (Flow の責務)
  prompt  = resolve(step, handoff)
  response = queryLLM(prompt)
  intent, handoff = extractFromGate(response)       // Step 完了の判定材料

  if intent == "closing":                           // completionSignal 検出
    verdict = runClosureLoop(response, handoff)      // Completion Loop 起動
    if verdict.done: return success                 // Agent 完了
    else: prompt = verdict.retryPrompt; continue    // Flow 継続
  else:
    continue                                        // 次の Step へ (Step 完了)
```

```
Completion Loop
  closurePrompt = resolve(c3l.closure, response, handoff)
  closureResult = queryLLM(closurePrompt)
  validation    = runValidationConditions(closureResult)
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
    design/07_prompt_system.md に従ってファイルを読む。
  - Step 開始前に `outputSchemaRef` を読み込み、SDK の
    `formatted: { type: "json_schema", schema }` へ渡す。Pointer
    解決に失敗したらその場で iteration を中止し、2 連続失敗で run 全体を
    `FAILED_SCHEMA_RESOLUTION` として停止する。
  - Step の出力から intent を抽出する。`closing` intent が Completion Loop の
    唯一のトリガーである（design/02_core_architecture.md「Completion Signal
    の定義」参照）。 intent routing による Step 遷移は Flow の責務であり、Agent
    完了の判定には関与しない。
  - `handoff` は Step ID 名前空間で累積し、次ステップの変数として注入する。

#### Step kind と許可制御

- **What**: Runner は `stepKind` に応じて `allowedTools` / `permissionMode`
  を再構成し、Work/Verification では副作用ツールを自動的に除去、Closure のみ
  再付与する。
- **Why**: 「Issue を閉じないで」と指示する代わりに、物理的な権限で境界を保証。
  Flow は intent と handoff だけを見ればよい。
- **Implication**: `steps_registry.json` に stepKind を定義すれば即機能する。
  定義が欠ければ loader がエラーにするため、設定漏れでも複雑性は増えない。

### Completion ループ

- **What**: 完了宣言を受け取った iteration
  だけで走り、完了条件の検証と後処理を行う。
- **Why**: 完了チェックの複雑さを Flow に持ち込まず、失敗時に retryPrompt を返す
  仕組みへ収束させるため。
- **最小限の How**:
  - Completion Loop は四段構成（Pre-flight State Validation → Closure Prompt →
    Format Validation → Verdict）で動作する
    （design/02_core_architecture.md「Completion Loop の四段構成」参照）。 Flow
    ループは Verdict の戻り値だけを受け取り、Agent の完了または継続を決定する。
    Completion Loop の内部処理を Flow が代行することはない。
  - `steps/complete/*` の C3L プロンプトで完了指示を生成。ユーザーは docs/
    に従ってプロンプトを管理できる。
  - Structured Output Schema (`outputSchemaRef`) は SDK の outputFormat
    に渡され、JSON 抽出後に StepValidator を走らせる。
  - 失敗時は Completion Loop が返す `pendingActions` を RetryHandler に渡し、
    次の Flow ループへ渡す C3L 指示文を構築する。

## 実行シーケンス

1. **load()**: agent.json / steps_registry.json / schemas / prompts
   を検証済み構造体に変換。
2. **init()**: PromptResolver, ValidationChain, RetryHandler を生成。
   (FormatValidator は SDK outputFormat に委譲)
3. **runFlow()**:
   - Step プロンプト解決 → LLM 呼び出し → structured output 抽出 → handoff
     更新。
   - `completionSignal` が無ければ次 Step へ遷移。
4. **runClosure()** (signal ありのときだけ):
   - Closure プロンプトを C3L から解決。
   - Structured Output + validationConditions で完了状態を判断。
   - `retryPrompt` があれば Flow の次 iteration へ渡す。
5. **result()**: `success`, `reason`, `iterations` を返す。Flow
   が止まらなければ完了しない。

## 主なコンポーネント

| コンポーネント    | What                                                   | Why                                  |
| ----------------- | ------------------------------------------------------ | ------------------------------------ |
| `PromptResolver`  | C3L 参照をローカルパスに射影し、本文を返す             | プロンプトの所在を Agent から隠す    |
| `ValidationChain` | validationSteps を解決し、Phase 1 の状態検証を実行する | LLM 呼び出し前に外部状態を gate する |
| `StepValidator`   | `validationConditions` を評価 (Phase 1)                | 外部状態（git, test 等）の差分検出   |
| `FormatValidator` | Phase 3 で構造化出力を outputSchema に対して検証       | LLM 出力のフォーマット準拠を保証     |
| `RetryHandler`    | failure pattern から C3L プロンプトを生成              | 失敗理由をそのまま次の指示へ反映     |

## GitHubRead MCP ツール

Runner は Agent の GitHub 読み取りアクセスを MCP ツール経由で提供する。

| 項目         | 詳細                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| ツール名     | `mcp__github__github_read` (`GITHUB_READ_TOOL_NAME`)                    |
| 作成方法     | SDK の `createSdkMcpServer()` で MCP サーバーを生成し、`query()` に渡す |
| allowedTools | Runner が全ステップの `allowedTools` に自動追加                         |
| 実行場所     | ホストプロセス（サンドボックス外）                                      |
| 内部実装     | MCP ツールハンドラが `Deno.Command("gh")` を実行                        |

**設計意図**: サンドボックスの `DEFAULT_TRUSTED_DOMAINS`
（`agents/runner/sandbox-defaults.ts`）から GitHub ドメインを除外し、Agent が
Bash ツール経由で `gh` コマンドを直接実行することをネットワーク層で遮断する。
代わりに、MCP ツールがホストプロセスで `gh` コマンドを実行することで、
TLS/Keychain アクセスの問題を回避しつつ、読み取り専用のアクセスを提供する。

GitHub 書き込みは Boundary Hook（closure step）が担う。

参照: `agents/runner/github-read-tool.ts`, `agents/runner/sandbox-defaults.ts`

## リトライ設計

- **形式リトライ**: SDK の outputFormat 機能に委譲。SDK が schema 検証を行い、
  検証エラー時は SDK レベルでリトライされる。
- **完了リトライ**: Completion Loop が `pendingActions`
  を返した場合、RetryHandler が生成した プロンプトを Flow ループに注入し、目的の
  Step を再実行させる。

## 成果としての出力

Runner の `AgentResult` はコア 3 フィールドと SDK メトリクスを報告する。

```ts
interface AgentResult {
  success: boolean; // Completion Loop が done を返したか
  reason: string; // Flow/Completion どちらで止まったのか（人が読むメッセージ）
  iterations: number; // Flow ループを何回まわしたか

  // SDK メトリクス（SDK result メッセージから取得）
  totalCostUsd?: number; // 累積コスト（USD）
  numTurns?: number; // SDK ターン数
  durationMs?: number; // 実行時間（ミリ秒）
}
```

コア 3 フィールドを正確に届けることが Runner の最終責務であり、
余計な状態や副作用を持ち込まない。SDK メトリクスは result メッセージに
含まれる場合のみ伝搬され、ログとコンソール出力の両方に記録される。
