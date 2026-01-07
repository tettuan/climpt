---
description: |
  Use when user says 'gh project create', 'GitHub Project 作成', 'プロジェクト作成', 'create project', or discusses creating a new GitHub Project. Ensures projects have proper short description and README. (project)
---

# GitHub Project Creation Skill

## Purpose

Ensure all new GitHub Projects have proper documentation:
- Short description (required)
- README with project context and structure

## Main Project for climpt

This repository's main project:
- **URL**: https://github.com/users/tettuan/projects/36
- **Title**: Reviewer Agent Issue Actions
- **Description**: Reviewer Agent に add-comment / close-issue アクションを追加

## Project Creation Guidelines

### Required Fields

1. **Short Description** (必須)
   - 簡潔に目的を記載 (1行)
   - 例: "Reviewer Agent に add-comment / close-issue アクションを追加"

2. **README** (推奨)
   - 依存関係図（Mermaid or テキスト）
   - 実装順序
   - 関連ファイル一覧

### README Template

```markdown
## 依存関係

```
#issue1 ──┐
          ├──► #issue3 ──► #issue4
#issue2 ──┘
```

## 実装順序

1. **#issue1, #issue2** - 並行実装可能
2. **#issue3** - 依存 issue 完了後
3. **#issue4** - 最終確認

## 関連ファイル

- `path/to/file1.ts` - 説明
- `path/to/file2.ts` - 説明
```

## Usage

When creating a new GitHub Project:

```bash
# 1. Create project
gh project create --owner tettuan --title "Project Title"

# 2. Get project number from output, then edit
gh project edit <NUMBER> --owner tettuan \
  --description "Short description here" \
  --readme "README content here"
```

## Validation Checklist

- [ ] Short description is set
- [ ] README contains dependency graph (if applicable)
- [ ] README contains implementation order
- [ ] README contains related files list
