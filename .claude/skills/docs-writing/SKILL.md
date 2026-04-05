---
name: docs-writing
description: This skill should be used when structuring technical documents from principle to concrete example using a 5-level abstraction framework. Applicable when writing new documentation, adding sections to builder guides, documenting design decisions, restructuring existing docs for clarity, or deciding what level of detail a document requires. Triggers - "write docs", "add documentation", "document the design", "structure this doc", 「ドキュメントを書く」「docs追加」「新規ドキュメント」「設計を文書化」「ガイドを書く」「ドキュメント構成」
allowed-tools: Read Edit Write Grep Glob
---

# Technical Document Writing

Structure every technical document as a 5-level abstraction ladder. Each level answers a distinct reader question and connects to the levels above and below.

## The 5-Level Framework

```
Level 1  Principle          Why this design?
            ↓ therefore this is the control point
Level 2  Structure/Contract  What are the parts, and what does each guarantee?
            ↓ given these parts, how do they combine
Level 3  Rules               How do they interact? (priority, constraints, timing)
            ↓ for common use cases, which combination
Level 4  Patterns            Which combination for my case? (named, reusable)
            ↓ show me the actual config/code
Level 5  Concrete Example    Show me (copy-paste ready)
```

## Level Definitions

### Level 1: Principle

**Reader's question**: Why does this system work this way?

- State the design philosophy or invariant that governs the mechanism
- This is the "why" that makes all downstream decisions derivable
- One or two sentences, not a paragraph

**Connects downward**: "This principle means X is the control point" → leads to Structure

### Level 2: Structure / Contract

**Reader's question**: What are the parts, and what does each one do?

- Enumerate all components, fields, or interfaces
- For each: what it is, what it guarantees (if X then Y)
- Table format preferred for scanability
- Complete — no field should be discoverable only by reading source code

**Connects upward**: "These parts exist because of the principle"
**Connects downward**: "Given these parts, here is how they relate" → leads to Rules

### Level 3: Rules

**Reader's question**: How do the parts interact?

- Priority order (which overrides which)
- Timing (what happens first, what happens after)
- Merge behavior (how multiple sources combine)
- Constraints (what combinations are invalid)

**Connects upward**: "These rules govern how the Structure's parts combine"
**Connects downward**: "For typical use cases, these rules produce these patterns" → leads to Patterns

### Level 4: Patterns

**Reader's question**: Which combination solves my case?

- Named, reusable templates derived from Rules
- Each pattern: name, when to use, which parts to configure, what to omit
- Small enough to memorize, concrete enough to apply
- 3-5 patterns cover most use cases

**Connects upward**: "This pattern is a specific application of the Rules"
**Connects downward**: "Here is a working example of this pattern" → leads to Example

### Level 5: Concrete Example

**Reader's question**: Show me exactly what to write.

- Copy-paste ready configuration, code, or command
- Annotated with comments linking back to the Pattern it implements
- One example per Pattern at minimum

**Connects upward**: "This example implements Pattern X"

## Decision Process

Before writing, determine which levels are needed:

| Document type | Required levels | Optional |
|---------------|----------------|----------|
| Design doc | 1, 2, 3 | 4, 5 |
| Builder guide | 2, 3, 4, 5 | 1 |
| Reference | 2 | 3 |
| Tutorial | 4, 5 | 1, 2, 3 (briefly) |
| Troubleshooting | 3, 5 | 2 |

Not every document needs all 5 levels. But every level that appears must connect to its neighbors.

## Writing Checklist

1. **Identify the entry level** — What does the reader already know?
2. **Write Level 2 first** — Structure/Contract is the backbone; everything else derives from it
3. **Derive Level 3 from Level 2** — Rules are relationships between parts, not new information
4. **Name patterns at Level 4** — If you can't name it, it's not reusable enough
5. **Verify connections** — Each level must reference its neighbor (up: "because", down: "therefore")
6. **Check completeness** — Can a reader derive any Level 5 example from Levels 2+3+4 alone?
7. **Cross-document verification** — Run V1-V4 checks against related documents (see below)

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Dead-level abstracting | Entire doc stays at one level (all principle, or all example) | Add the missing levels between |
| Level skipping | Jumps from Principle to Example with no Structure/Rules | Insert the intermediate levels |
| Orphan level | A level that doesn't reference its neighbors | Add "because" (up) and "therefore" (down) connectors |
| Implicit structure | Parts discoverable only by reading source code | Move to Level 2 and enumerate explicitly |
| Example without pattern | Concrete config with no reusable template | Extract the pattern, name it, then show the example as an instance |

## Cross-Document Verification

ドキュメント作成・更新後に、関連ドキュメントとの整合性を検証する。

### V1: 同一概念の重複検出

同じ概念が複数ファイルに記述されている場合、**権威ある1箇所** (source of truth)
を定め、他はリンクで参照する。

検証手順:
1. 作成したドキュメントの Level 2 (Structure/Contract) のフィールド名・用語を抽出
2. 同ディレクトリの他ドキュメントを grep し、同一フィールド/用語の記述を検出
3. 重複を発見したら: source of truth を決定 → 他方をリンクに置換

判定基準:

| 重複パターン | source of truth | 他方の対応 |
|-------------|----------------|-----------|
| 同一フィールドの動作説明 | そのフィールドが属する contract ドキュメント | 1行リンク + 要約のみ |
| config リファレンス (型、デフォルト値) | agent definition ドキュメント | リンクで参照 |
| 設計原則の引用 | design ドキュメント | 引用として明示 |

### V2: Level 間の矛盾検出

同一ドキュメント内で、上位 Level の記述と下位 Level の記述が矛盾していないか検証する。

検証手順:
1. Level 2 の保証 (if X then Y) を列挙
2. Level 5 の各例が Level 2 の保証に違反していないか照合
3. Level 3 のルールが Level 4 のパターンに反映されているか確認

矛盾の典型例:

| 矛盾 | 症状 | 修正方向 |
|------|------|---------|
| Level 2 の保証を Level 5 の例が破っている | 例が「動かない設定」を示す | 例を修正 (Level 2 が権威) |
| Level 3 のルールが Level 4 のパターンに欠落 | パターンが不完全で、読者がルール違反する設定を書く | パターンにルールを反映 |
| Level 1 の原則と Level 3 のルールが矛盾 | ルールが原則から導出不可能 | ルールの根拠を再検証し、原則かルールを修正 |

### V3: ドキュメント間のリンク整合性

リンク先が存在し、参照関係が双方向であることを検証する。

検証手順:
1. 作成したドキュメントから外部リンク (`[text](./other.md)`) を抽出
2. リンク先ファイルが存在するか確認
3. リンク先の「関連ドキュメント」セクションに逆リンクがあるか確認
4. 逆リンクがなければ追加

### V4: 用語の一貫性

同じ概念に複数の名前を使っていないか検証する。

検証手順:
1. 作成したドキュメントの key terms (Level 2 のフィールド名、Level 4 のパターン名) を抽出
2. 関連ドキュメントで同じ概念に別の名前が使われていないか grep
3. 不一致があれば統一する (新しいドキュメントを既存の用語に合わせる)

## Theoretical Basis

This framework synthesizes three established models:

- **Roger Martin's Knowledge Funnel**: Mystery → Heuristic → Algorithm (Levels 1 → 3-4 → 5)
- **DITA (IBM)**: Concept → Task → Reference (Levels 1-2 → 4-5 → 2-3)
- **Hayakawa's Abstraction Ladder** (1939): Effective communication requires moving between abstraction levels; staying at one level ("dead-level abstracting") disengages readers

For detailed theoretical foundations, see [references/framework-theory.md](references/framework-theory.md).
