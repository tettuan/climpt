# Option Scoring Rule

2 個以上の実装案・設計案を比較する場面では、必ず `/option-scoring` skill を先に実行し、その出力 (matrix + recommendation) を提示してから判断を下すこと。

## 適用条件

- 「Option A / Option B」「案1 / 案2」等、2 個以上の候補を並べる前
- 可逆性が低い決定 (schema, CLI shape, persistence format, public API, workflow 定義) の候補比較
- ユーザーが trade-off 分析・適合度評価を明示要求したとき

## 必須手順

1. 比較を口頭で始める前に `/option-scoring` skill を実行する
2. Fixed spine (全域性 / Core-first / No backward-compat / Fallback / Reviewer precision) に加え、関連 design doc から derived axes を 2–3 個引用する
3. matrix で weighted total と fit % を提示し、DQ (w=2 で score 0) は明示する
4. 最高 fit % (non-DQ) を recommendation として単一理由で宣言する
5. 上位 2 案が 5pp 以内なら near-tie と明示し、tie-breaker 軸を名指す

## Skip 条件

- 選択肢が 1 つしかない場合
- 局所命名 (変数名等) のように設計影響が無い場合
- ユーザーが明示的に「スコアせず列挙だけ」と指示した場合

## Quick Check

- [ ] Derived axes に doc citation (file §section) を付けたか
- [ ] Weight が default から外れる場合、根拠を 1 行で書いたか
- [ ] ✗/△ 毎に 1 行 rationale を添えたか
- [ ] Reversal condition を明記したか
