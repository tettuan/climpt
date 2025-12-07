---
c1: climpt-code
c2: review
c3: pull-request
title: PRコードレビュー実行
description: Pull Requestの変更内容をレビューし、改善提案やバグの指摘を行う
usage: climpt-code review pull-request
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
    - detailed
  file: true
  stdin: false
  destination: false
---

# PRコードレビュー

## 目的
Pull Requestの変更内容を確認し、コード品質の向上に貢献する。

## 入力
- PRの差分ファイル（-f オプション）

## 出力
- レビューコメント
- 改善提案
- 潜在的なバグや問題点の指摘

## レビュー観点
1. コードの可読性
2. パフォーマンス
3. セキュリティ
4. テストカバレッジ
5. 設計パターンの適切さ
