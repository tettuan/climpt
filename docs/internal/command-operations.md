# Command Operations Specification

コマンド検索・詳細取得・実行の仕様書。MCP サーバーおよび Plugin 実装の両方がこの仕様に準拠する。

## 参照元

この仕様は以下のファイルから参照されている:

| ファイル | 用途 |
|----------|------|
| `src/mcp/similarity.ts` | MCP Server の類似度検索・describe 実装 |
| `src/mcp/registry.ts` | MCP Server のレジストリ読み込み |
| `climpt-plugins/plugins/climpt-agent/lib/similarity.ts` | Plugin の類似度検索・describe 実装 |
| `climpt-plugins/plugins/climpt-agent/lib/registry.ts` | Plugin のレジストリ読み込み |
| `climpt-plugins/plugins/climpt-agent/skills/delegate-climpt-agent/scripts/climpt-agent.ts` | Plugin のエントリポイント |

**関連ドキュメント:**
- [Registry Specification](./registry-specification.md) - レジストリ構造の定義

## 操作一覧

| Operation | Description | Input | Output |
|-----------|-------------|-------|--------|
| `search` | 自然言語クエリからコマンド検索 | query, agent | SearchResult[] |
| `describe` | C3L識別子からコマンド詳細取得 | c1, c2, c3, agent | Command[] |
| `execute` | コマンド実行して指示プロンプト取得 | c1, c2, c3, agent, options | string |

## Search Operation

### 概要

自然言語クエリを受け取り、コサイン類似度を用いて最も関連性の高いコマンドを返す。

### アルゴリズム: Word-based Cosine Similarity

単語レベルのコサイン類似度を使用。シンプルだが効果的な意味検索手法。

#### 手順

1. **トークン化**: クエリと検索対象を小文字化し、空白で分割
2. **語彙構築**: 両方のテキストから一意な単語リストを作成
3. **ベクトル化**: 各テキストを語彙に基づく出現頻度ベクトルに変換
4. **類似度計算**: コサイン類似度を計算

#### 擬似コード

```
function cosineSimilarity(a: string, b: string): number {
  // Step 1: Tokenize
  wordsA = a.toLowerCase().split(/\s+/)
  wordsB = b.toLowerCase().split(/\s+/)

  // Step 2: Build vocabulary
  allWords = unique(wordsA + wordsB)

  // Step 3: Create frequency vectors
  vectorA = [count of each word in wordsA]
  vectorB = [count of each word in wordsB]

  // Step 4: Calculate cosine similarity
  dotProduct = sum(vectorA[i] * vectorB[i])
  magnitudeA = sqrt(sum(vectorA[i]^2))
  magnitudeB = sqrt(sum(vectorB[i]^2))

  return dotProduct / (magnitudeA * magnitudeB)
}
```

#### 数式

$$
\text{similarity} = \frac{\vec{A} \cdot \vec{B}}{|\vec{A}| \times |\vec{B}|}
$$

Where:
- $\vec{A}$, $\vec{B}$: 単語頻度ベクトル
- $\vec{A} \cdot \vec{B}$: 内積
- $|\vec{A}|$, $|\vec{B}|$: ベクトルの大きさ (L2ノルム)

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
  c1: string;           // ドメイン識別子
  c2: string;           // アクション識別子
  c3: string;           // ターゲット識別子
  description: string;  // コマンド説明
  score: number;        // 類似度スコア (0-1)
}
```

### スコアの解釈

| Score Range | 解釈 |
|-------------|------|
| 0.8 - 1.0 | 非常に高い一致 |
| 0.5 - 0.8 | 中程度の一致 |
| 0.2 - 0.5 | 低い一致 |
| 0.0 - 0.2 | ほぼ無関係 |

### デフォルト結果数

`topN = 3` (上位3件を返す)

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

| Option Key | CLI Flag | Example |
|------------|----------|---------|
| `edition` | `-e` / `--edition` | `-e=detailed` |
| `adaptation` | `-a` / `--adaptation` | `-a=custom` |
| `file` | `-f` / `--file` | `-f=input.md` |
| `destination` | `-d` / `--destination` | `-d=output.md` |

### 戻り値

- 成功: stdout の内容 (指示プロンプト)
- 失敗: エラーメッセージ (stderr の内容)

## Registry Loading

### Config ファイル検索順序

1. `.agent/climpt/mcp/config.json` (プロジェクトローカル)
2. `~/.agent/climpt/mcp/config.json` (ユーザーホーム)

見つからない場合、デフォルト設定を使用:

```typescript
const DEFAULT_CONFIG: MCPConfig = {
  registries: {
    "climpt": ".agent/climpt/registry.json"
  }
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
