# Command Operations Specification

コマンド検索・詳細取得・実行の仕様書。MCP サーバーおよび Plugin
実装の両方がこの仕様に準拠する。

## 参照元

この仕様は以下のファイルから参照されている:

| ファイル                                                                    | 用途                                       |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| `src/mcp/similarity.ts`                                                     | MCP Server の BM25+RRF 検索・describe 実装 |
| `src/mcp/registry.ts`                                                       | MCP Server のレジストリ読み込み            |
| `plugins/climpt-agent/lib/similarity.ts`                                    | Plugin の BM25+RRF 検索・describe 実装     |
| `plugins/climpt-agent/lib/registry.ts`                                      | Plugin のレジストリ読み込み                |
| `plugins/climpt-agent/skills/delegate-climpt-agent/scripts/climpt-agent.ts` | Plugin のエントリポイント                  |

**関連ドキュメント:**

- [Registry Specification](./registry-specification.md) - レジストリ構造の定義

## 操作一覧

| Operation       | Description                        | Input                      | Output         |
| --------------- | ---------------------------------- | -------------------------- | -------------- |
| `search`        | 自然言語クエリからコマンド検索     | query, agent               | SearchResult[] |
| `searchWithRRF` | 複数クエリを RRF で統合検索        | queries[], agent           | RRFResult[]    |
| `describe`      | C3L識別子からコマンド詳細取得      | c1, c2, c3, agent          | Command[]      |
| `execute`       | コマンド実行して指示プロンプト取得 | c1, c2, c3, agent, options | string         |

## Search Operation

### 概要

自然言語クエリを受け取り、BM25
アルゴリズムを用いて最も関連性の高いコマンドを返す。

### アルゴリズム: BM25 (Best Match 25)

BM25 は Elasticsearch、Lucene
などで使用される業界標準の検索アルゴリズム。コサイン類似度と比較して以下の利点がある:

- **IDF (Inverse Document Frequency)**: "create", "get" など頻出単語の重みを低減
- **文書長正規化**: 長いドキュメントへのバイアスを補正
- **飽和関数**: 単語頻度の過度な影響を抑制

#### BM25 数式

$$
\text{score}(D, Q) = \sum_{i=1}^{n} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot (1 - b + b \cdot \frac{|D|}{\text{avgdl}})}
$$

Where:

- $f(q_i, D)$: ドキュメント D における単語 $q_i$ の出現頻度
- $|D|$: ドキュメント長（トークン数）
- $\text{avgdl}$: コーパス全体の平均ドキュメント長
- $k_1 = 1.2$: 頻度飽和パラメータ
- $b = 0.75$: 文書長正規化パラメータ

#### IDF 計算

$$
\text{IDF}(t) = \log\left(\frac{N - df(t) + 0.5}{df(t) + 0.5} + 1\right)
$$

Where:

- $N$: 総ドキュメント数
- $df(t)$: 単語 $t$ を含むドキュメント数

### トークン化

テキストを以下のルールで分割:

1. **空白分割**: スペースで単語を分離
2. **ハイフン分割**: `group-commit` → `group`, `commit`, `group-commit`
3. **アンダースコア分割**: `unstaged_changes` → `unstaged`, `changes`,
   `unstaged_changes`
4. **CamelCase 分割**: `groupCommit` → `group`, `commit`, `groupcommit`

元の複合トークンは後方互換性のため保持される。

### 検索対象テキストの構築

各コマンドに対して、以下を連結して検索対象テキストを生成:

```
searchTarget = "${c1} ${c2} ${c3} ${description}".toLowerCase()
```

### 重複排除

同じ `c1:c2:c3` の組み合わせが複数存在する場合、最初の出現のみを使用。

### 結果フォーマット

```typescript
interface SearchResult {
  c1: string; // ドメイン識別子
  c2: string; // アクション識別子
  c3: string; // ターゲット識別子
  description: string; // コマンド説明
  score: number; // BM25 スコア (0 以上、上限なし)
}
```

### スコアの解釈

BM25 スコアはコサイン類似度と異なり 0-1
に正規化されない。相対的な順位付けに使用する。

| スコア特性 | 解釈                   |
| ---------- | ---------------------- |
| 高いスコア | クエリとの関連性が高い |
| 低いスコア | クエリとの関連性が低い |
| 0          | 一致するトークンなし   |

### デフォルト結果数

`topN = 3` (上位3件を返す)

## Search with RRF (Reciprocal Rank Fusion)

### 概要

複数の検索クエリの結果を RRF
アルゴリズムで統合し、より精度の高い検索結果を返す。

C3L に沿った2つのクエリを使用:

- **query1 (action)**: アクションに焦点 (c2 に対応)
- **query2 (target)**: ターゲットに焦点 (c3 に対応)

### RRF アルゴリズム

$$
\text{score}(d) = \sum_{i=1}^{n} \frac{1}{k + \text{rank}_i(d)}
$$

Where:

- $k = 60$: スムージングパラメータ（標準値）
- $\text{rank}_i(d)$: クエリ $i$ でのドキュメント $d$ の順位（1-indexed）

### 使用例

```typescript
const results = searchWithRRF(commands, [
  "draft create write compose", // action-focused
  "specification document entry", // target-focused
], 3);
```

### RRF 結果フォーマット

```typescript
interface RRFResult {
  c1: string;
  c2: string;
  c3: string;
  description: string;
  score: number; // RRF 統合スコア
  ranks: number[]; // 各クエリでの順位 (1-indexed, -1 = not found)
}
```

### RRF の利点

- **ランク統合**: 異なる観点からの検索結果を公平に統合
- **スコア正規化不要**: 順位ベースのため、異なるスコアスケールを統一
- **ノイズ耐性**: 1つのクエリで低順位でも、他で高順位なら浮上

## Describe Operation

### 概要

C3L 識別子 (c1, c2, c3) に完全一致するコマンド定義を返す。

### アルゴリズム

```
function describeCommand(commands: Command[], c1, c2, c3): Command[] {
  return commands.filter(cmd =>
    cmd.c1 === c1 && cmd.c2 === c2 && cmd.c3 === c3
  )
}
```

### 戻り値

- 一致するコマンドが見つかった場合: `Command[]` (複数の場合あり)
- 一致しない場合: 空配列 `[]`

## Execute Operation

### 概要

指定されたコマンドを Climpt CLI 経由で実行し、指示プロンプトを取得する。

### 実行コマンド構築

```
configParam = (agent === "climpt") ? c1 : `${agent}-${c1}`

deno run \
  --allow-read --allow-write --allow-env --allow-run --allow-net \
  --no-config \
  jsr:@aidevtool/climpt \
  --config=${configParam} \
  ${c2} \
  ${c3} \
  [options...]
```

### オプションのマッピング

| Option Key    | CLI Flag               | Example        |
| ------------- | ---------------------- | -------------- |
| `edition`     | `-e` / `--edition`     | `-e=detailed`  |
| `adaptation`  | `-a` / `--adaptation`  | `-a=custom`    |
| `file`        | `-f` / `--from`        | `-f=input.md`  |
| `destination` | `-d` / `--destination` | `-d=output.md` |

### 戻り値

- 成功: stdout の内容 (指示プロンプト)
- 失敗: エラーメッセージ (stderr の内容)

## Registry Loading

### Config ファイル検索順序

1. `.agent/climpt/config/registry_config.json` (プロジェクトローカル)
2. `~/.agent/climpt/config/registry_config.json` (ユーザーホーム)

見つからない場合、デフォルト設定を使用:

```typescript
const DEFAULT_CONFIG: MCPConfig = {
  registries: {
    "climpt": ".agent/climpt/registry.json",
  },
};
```

### Registry ファイル検索順序

1. `${registryPath}` (カレントディレクトリ相対)
2. `~/${registryPath}` (ユーザーホーム相対)

## エラーハンドリング

### Search エラー

- レジストリが空の場合: 空配列を返す
- 一致なしの場合: 空配列を返す

### Describe エラー

- コマンドが見つからない場合: 空配列を返す

### Execute エラー

- コマンド実行失敗: stderr の内容をエラーとして返す
- タイムアウト: 適切なタイムアウトエラーを返す

## 実装参照

- MCP Server: `src/mcp/similarity.ts`
- Plugin: `plugins/climpt-agent/lib/similarity.ts`

両実装は同一の仕様に従い、同一の検索結果を返す。
