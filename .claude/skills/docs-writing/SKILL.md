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

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Dead-level abstracting | Entire doc stays at one level (all principle, or all example) | Add the missing levels between |
| Level skipping | Jumps from Principle to Example with no Structure/Rules | Insert the intermediate levels |
| Orphan level | A level that doesn't reference its neighbors | Add "because" (up) and "therefore" (down) connectors |
| Implicit structure | Parts discoverable only by reading source code | Move to Level 2 and enumerate explicitly |
| Example without pattern | Concrete config with no reusable template | Extract the pattern, name it, then show the example as an instance |

## Theoretical Basis

This framework synthesizes three established models:

- **Roger Martin's Knowledge Funnel**: Mystery → Heuristic → Algorithm (Levels 1 → 3-4 → 5)
- **DITA (IBM)**: Concept → Task → Reference (Levels 1-2 → 4-5 → 2-3)
- **Hayakawa's Abstraction Ladder** (1939): Effective communication requires moving between abstraction levels; staying at one level ("dead-level abstracting") disengages readers

For detailed theoretical foundations, see [references/framework-theory.md](references/framework-theory.md).
