# Semantic Consistency Verification

形式的な一致ではなく、設計・実装・説明の意味的整合性を確認する。

## 三角形の整合性

```
        設計
       /    \
      /      \
   実装 ──── 説明
```

| 関係 | 確認内容 |
|------|----------|
| 設計→実装 | 設計通りに実装されているか |
| 実装→説明 | 実装が正しく説明されているか |
| 設計→説明 | 設計意図がユーザーに伝わるか |

---

## 1. 設計 → 実装の整合性

### docs/internal/ と src/ の対応

| 設計ドキュメント | 実装 | 確認ポイント |
|------------------|------|--------------|
| `docs-distribution-design.md` | `src/docs/` | APIシグネチャ一致 |
| `iterator-agent-design.md` | `agents/iterator/` | フロー一致 |
| `prompt-architecture.md` | `src/cli.ts` | 変数置換ロジック |

### チェック方法

```bash
# 設計で定義されたAPI
grep -E "^(export|async|function)" docs/internal/docs-distribution-design.md

# 実装のexport
grep "^export" src/docs/mod.ts
```

**確認項目:**
- [ ] 設計で定義した関数が実装に存在する
- [ ] 引数と戻り値の型が一致する
- [ ] 設計のフローが実装されている

---

## 2. 実装 → 説明の整合性

### Export と API ドキュメント

```bash
# mod.ts のexport一覧
grep "^export" mod.ts

# README/docs で説明されているか
grep -l "searchCommands\|describeCommand" docs/ README.md
```

**確認項目:**
- [ ] public exportがすべてドキュメント化されている
- [ ] 関数の引数説明が正確
- [ ] 戻り値の型・形式が正確
- [ ] エラーケースが説明されている

### デフォルト値の整合性

```bash
# 実装のデフォルト値
grep -E "= (true|false|\"[^\"]+\"|[0-9]+)" src/docs/types.ts

# ドキュメントのデフォルト値
grep -i "default" docs/internal/docs-distribution-design.md README.md
```

### CLI オプションの動作説明

| オプション | 実装での動作 | 説明との整合 |
|------------|--------------|--------------|
| `--from` | ファイルパス指定 | README説明と一致？ |
| `--mode` | preserve/flatten/single | 各モードの動作説明？ |
| `--lang` | フィルタリング | 複数指定時の動作？ |

---

## 3. 設計 → 説明の整合性

### 設計意図がユーザーに伝わるか

| 設計の決定 | ユーザー向け説明 | 確認 |
|------------|------------------|------|
| なぜJSRから取得？ | README「オンデマンド」 | 利点が伝わるか |
| なぜ3モード？ | 各モードの使い分け | ユースケース明示？ |
| なぜmanifest.json？ | 省略（内部実装） | 適切に隠蔽？ |

### 制約・制限の明示

設計で決めた制限がユーザーに伝わっているか：

```bash
# 設計の制限事項
grep -i "制限\|注意\|limitation\|warning" docs/internal/*.md

# ユーザー向けの注意事項
grep -i "note\|warning\|注意" README.md docs/guides/
```

---

## 4. 具体的なチェックリスト

### Docs Distribution モジュール

```
設計: docs/internal/docs-distribution-design.md
実装: src/docs/
説明: README.md § Documentation
```

**設計→実装:**
- [ ] `install()` 関数のシグネチャ一致
- [ ] `list()` 関数のシグネチャ一致
- [ ] 3モード (preserve/flatten/single) 実装済み
- [ ] フィルタオプション (category/lang) 実装済み

**実装→説明:**
- [ ] CLI使用例が実際に動作する
- [ ] オプション説明が実動作と一致
- [ ] エラー時の挙動が説明されている

**設計→説明:**
- [ ] 「オンデマンド取得」の利点が伝わる
- [ ] バージョン自動検出が説明されている

### Agent モジュール

```
設計: docs/internal/iterator-agent-design.md
実装: agents/
説明: README.md § Agents, agents/README.md
```

**設計→実装:**
- [ ] completionType が全種類実装済み
- [ ] ステップフローが設計通り
- [ ] ログ出力形式が設計通り

**実装→説明:**
- [ ] agent.json の全プロパティが説明済み
- [ ] 各completionTypeの動作が説明済み
- [ ] エラー時のリカバリーが説明済み

---

## 5. 不整合の典型パターン

### パターン1: 実装が先行

```
実装: 新機能を追加
設計: 未記載
説明: 未記載
```

**対処:** 設計ドキュメントを更新し、説明を追加

### パターン2: 説明が古い

```
設計: 新仕様
実装: 新仕様
説明: 旧仕様のまま
```

**対処:** README/docsを更新

### パターン3: 設計と実装の乖離

```
設計: Aの方法で実装
実装: Bの方法で実装（改良）
説明: Aの説明のまま
```

**対処:** 設計ドキュメントを実装に合わせて更新、説明も更新

---

## 6. 検証の優先順位

1. **ユーザー影響大**: CLI/API の動作説明
2. **混乱を招く**: デフォルト値、オプションの組み合わせ
3. **信頼性**: エラーメッセージ、制限事項
4. **内部整合**: 設計ドキュメントと実装

---

## 7. 自動化できない確認

以下は人間/AIによるレビューが必要：

- 説明が初心者にも理解できるか
- 例示が実際のユースケースを反映しているか
- 設計意図が正しく伝わるか
- 省略すべき内部詳細と公開すべき情報の判断
