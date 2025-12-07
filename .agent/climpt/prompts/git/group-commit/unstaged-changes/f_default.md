---
c1: climpt-git
c2: group-commit
c3: unstaged-changes
title: 意味的近さでコミットを分けて実施する
description: ファイルの変更内容の意味的な近さでグループ化し、複数回のコミットを連続実行する
usage: climpt-git group-commit unstaged-changes
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default", "detailed"]
  file: true
  stdin: false
  destination: true
---

# 指示
Gitコミットを、ファイルの変更内容の近さ単位でグループ化し、
近い単位にまとめてコミットする。

まったく異なる内容を1つのコミットへ含めることを避けつつ、
複数回のコミット処理を連続して実行することが目的である。

意味的に近いとは、

ある変更について、同じ変更に関与した
- documents
- prompts
- codes
- tests
などのファイル種類を1つのコミットにまとめることである。

一方、複数のプロンプトやcodeでも、意味的に異なる変更は分けてコミットすることである。

## 判断軸

分類:
- Migration は必ず独立させ、最初にコミットする
- Goのコードは、同じ種類の変更をまとめる（本体コードとテスト）
- docs は、同じ内容のコードと一緒でも良い
- Docker 関連は他の変更と混ぜない

順番:
依存関係順とする。依存される分類から先にコミットする

# 手順

- git status
- 変更を分類をする
- 順番を決める

2つに分けられる場合:
- git add 1
- git commit 1
- git add 2
- git commit 2 


