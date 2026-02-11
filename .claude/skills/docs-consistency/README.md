# docs-consistency skill

実装とドキュメントの整合性を検証するスキル。

## 他のスキルとの関係

| Skill | Purpose | When |
|-------|---------|------|
| `docs-consistency` | 検証・確認 | リリース前、定期確認 |
| `update-docs` | 文書作成・更新 | 機能追加・変更時 |
| `update-changelog` | CHANGELOG更新 | 機能完了時 |

**フロー:**
```
機能実装 → update-docs → docs-consistency → release-procedure
```

## コンポーネント

```
docs-consistency/
├── SKILL.md              # メイン指示（概要、チェックリスト）
├── IMPLEMENTATION-CHECK.md  # 詳細検証ガイド
├── README.md             # このファイル
└── scripts/
    └── verify-docs.ts    # 自動検証スクリプト
```

## 使用方法

### 自動検証

```bash
# 全チェック
deno task verify-docs

# 個別チェック
deno task verify-docs cli
deno task verify-docs readme
deno task verify-docs manifest
deno task verify-docs agents
```

### 手動確認

1. SKILL.mdのチェックリストをコピー
2. 各項目を順番に確認
3. 問題があれば修正

## 検出される問題の例

- README.md/README.ja.mdの構造不一致
- manifest.jsonのバージョン不一致
- docs/guides/en と docs/guides/ja のファイル数不一致
- CLI --helpに記載されているがREADMEにない項目

## リリース前の必須手順

```bash
# 1. ドキュメント整合性確認
deno task verify-docs

# 2. マニフェスト再生成（バージョン更新後）
deno task generate-docs-manifest

# 3. 再確認
deno task verify-docs manifest
```
