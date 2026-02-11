---
name: docs-consistency
description: Verify and fix documentation to match implementation. Use when updating docs, releasing versions, or when user mentions 'docs consistency', 'docs update', 'docs verify', 'ドキュメント更新', '最新にして', 'docsを直して'. Extracts design intent, investigates implementation, then updates docs accordingly.
allowed-tools: [Read, Edit, Grep, Glob, Bash, Write]
---

# Docs Consistency - Design-Driven Documentation

## Core Principle

```
設計意図(What/Why) → 実装調査(How) → docs修正(説明)
```

docsは実装の説明であり、設計を書き換えるものではない。

---

## Phase 1: 設計意図の明確化

### 1.1 設計ドキュメントを読む

```bash
# 設計ドキュメントの特定
ls docs/internal/
```

### 1.2 What/Whyを抽出してtmp/に書き出す

```bash
mkdir -p tmp/docs-review
```

対象機能ごとにメモを作成：

```markdown
# tmp/docs-review/{feature}-intent.md

## What（何を実現するか）
- ...

## Why（なぜそうするか）
- ...

## 設計上の制約・決定事項
- ...

## ユーザーが知るべきこと
- ...
```

**例: docs distribution**

```markdown
# tmp/docs-review/docs-distribution-intent.md

## What
- JSRからdocsをローカルにインストールする機能

## Why
- ユーザーがオフラインでドキュメント参照できる
- AI context windowにdocsを含められる
- バージョン管理されたdocsを取得できる

## 設計上の決定
- manifest.jsonで全docsを管理
- 3モード: preserve/flatten/single
- バージョンは自動検出（meta.json）

## ユーザーが知るべきこと
- インストールコマンド
- フィルタオプション（category, lang）
- 出力モードの違い
```

---

## Phase 2: 実装の調査

### 2.1 対応する実装コードを特定

```bash
# 設計と実装のマッピング
grep -r "install\|list" src/docs/ --include="*.ts" -l
```

### 2.2 実現方法を把握してメモに追記

```markdown
# tmp/docs-review/{feature}-implementation.md

## 実装ファイル
- src/docs/mod.ts
- src/docs/cli.ts
- ...

## 公開API
- install(options): Promise<Result>
- list(): Promise<Manifest>

## 実際の動作
- JSRからmeta.json取得 → 最新バージョン特定
- manifest.json取得 → エントリ一覧
- 各markdownファイルをfetch → ローカル保存

## デフォルト値
- output: "./climpt-docs"
- mode: "preserve"

## エッジケース
- ネットワークエラー時: ...
- 既存ファイル上書き: ...
```

---

## Phase 3: docs との照合

### 3.0 メモを開き差分表を準備

Phase 1/2で作成したメモを参照しながら差分表を作成する：

```bash
# 作成したメモを確認
cat tmp/docs-review/{feature}-intent.md
cat tmp/docs-review/{feature}-implementation.md
```

これらのメモから「設計/実装」列の値を差分表へ転記していく。

### 3.1 現在のdocsを確認

```bash
# 対象機能のdocs確認
grep -A 20 "Documentation" README.md
cat docs/internal/docs-distribution-design.md
```

### 3.2 差分を特定

設計意図メモ + 実装メモ と 現在のdocs を比較：

| 項目 | 設計/実装 | 現在のdocs | 差分 |
|------|-----------|------------|------|
| インストールコマンド | `dx jsr:...` | 記載あり | ✓ |
| 3モードの説明 | preserve/flatten/single | 未記載 | 要追記 |
| デフォルト出力先 | ./climpt-docs | 未記載 | 要追記 |

---

## Phase 4: docs の修正

### 4.1 修正方針

- **設計は書き換えない** - docs/internal/は設計意図の記録
- **実装の説明を更新** - README, docs/guides/は実装の説明
- **ユーザー視点で記述** - 何ができるか、どう使うか

### 4.2 修正対象の優先順位

1. **README.md** - 最初に読まれる、必須
2. **README.ja.md** - 同期必須
3. **docs/guides/** - 詳細な使い方
4. **--help** - CLI使用時に参照

### 4.3 修正実行

```bash
# 実装の説明を追記/修正
# 設計意図(Why)を反映した説明文
```

メモ（intent.md / implementation.md）は文案の素材として活用する：
- 差分表の「設計/実装」列からdocs修正文を起草
- PR descriptionの背景説明に流用

### 4.4 メモの保存方針

修正完了後のtmp/docs-review/の扱い：

| 状況 | 対処 |
|------|------|
| 単純な修正で価値が低い | `rm -rf tmp/docs-review/` で削除 |
| PR説明の補足に有用 | PRにリンク or 内容を引用 |
| 設計判断の記録として残す | `docs/internal/changes/` へ昇格 |

---

## Phase 5: 形式チェック

修正後、形式的な整合性を確認：

```bash
# 全体チェック
deno task verify-docs

# 個別チェック
deno task verify-docs readme   # README.md/ja 同期
deno task verify-docs manifest # manifest.json バージョン
```

### 必須確認項目

| 項目 | コマンド/確認方法 |
|------|-------------------|
| README sections一致 | `verify-docs readme` |
| コードブロック数一致 | 自動 |
| manifest.jsonバージョン | `verify-docs manifest` |
| 多言語ガイド同期 | `verify-docs` (all) |

### manifest.json 更新

docsファイル追加/削除時：

```bash
deno task generate-docs-manifest
```

---

## Phase 6: 英語版の確保

### 命名規則

| パターン | 言語 |
|----------|------|
| `*.md` | 英語版（必須） |
| `*.ja.md` | 日本語版（任意） |

### 日本語タイトルのファイル検出

```bash
deno task verify-docs
# "Naming Convention" チェックで検出
```

### 対処フロー

1. **リネーム**: 日本語のみのファイルを `.ja.md` に変更
   ```bash
   mv docs/foo.md docs/foo.ja.md
   ```

2. **英語版作成**: `.ja.md` を翻訳して `.md` を作成
   - タイトル（H1）を英訳
   - セクション見出しを英訳
   - 本文を英訳（コード例はそのまま）

3. **manifest再生成**:
   ```bash
   deno task generate-docs-manifest
   ```

### 翻訳のポイント

- 技術用語・コード・コマンドは原文維持
- 説明文のみ自然な英語に
- 構造（見出しレベル、リスト形式）は維持

---

## Docs Distribution (配布対象)

manifest.json に含まれる = JSR経由でインストール可能なドキュメント。

### 配布対象

| ディレクトリ | 内容 |
|--------------|------|
| `docs/guides/en/` | 英語ガイド |
| `docs/internal/` | 設計ドキュメント |
| `docs/*.md` | トップレベルのドキュメント |

### 配布除外

| ディレクトリ | 理由 |
|--------------|------|
| `docs/guides/ja/` | 日本語版は任意 |
| `docs/reference/` | 外部参照資料（SDK docs等） |
| `*.ja.md` | 日本語版は配布対象外 |

---

## Quick Reference

### ファイル分類

| ファイル種別 | 役割 | 修正対象？ |
|--------------|------|-----------|
| docs/internal/ | 設計意図の記録 | No（読むだけ） |
| docs/reference/ | 外部参照資料 | No（配布対象外） |
| README.md | 実装の説明 | Yes |
| docs/guides/ | 詳細な使い方 | Yes |
| --help | CLI説明 | Yes |
| tmp/docs-review/ | 作業用メモ | 完了後削除 or PR添付 |

### チェックリスト

```
Phase 1: 設計意図
- [ ] docs/internal/ を読んだ
- [ ] tmp/docs-review/{feature}-intent.md 作成
- [ ] What/Why 明確化

Phase 2: 実装調査
- [ ] 実装ファイル特定
- [ ] tmp/docs-review/{feature}-implementation.md 作成
- [ ] 公開API、デフォルト値、動作把握

Phase 3: 照合
- [ ] 現在のdocs確認
- [ ] 差分リスト作成

Phase 4: 修正
- [ ] README.md 更新
- [ ] README.ja.md 同期
- [ ] 必要に応じてdocs/guides/更新

Phase 5: 形式チェック
- [ ] deno task verify-docs 実行
- [ ] 全チェック pass
- [ ] manifest.json 更新（必要時）

Phase 6: メモの後処理
- [ ] intent/implementation メモの内容をdocs修正に反映した
- [ ] tmp/docs-review/ を削除 or docs/internal/changes/ へ昇格
```

---

## References

- [SEMANTIC-CHECK.md](SEMANTIC-CHECK.md) - 意味的整合性の詳細
- [IMPLEMENTATION-CHECK.md](IMPLEMENTATION-CHECK.md) - 形式的チェック（補助）
- `scripts/verify-docs.ts` - 自動チェック（補助）
