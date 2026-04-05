# Framework Theory

Theoretical foundations for the 5-level abstraction framework.

## Roger Martin's Knowledge Funnel

From "The Design of Business" (2009). Three stages of knowledge refinement:

| Stage | Description | Maps to Level |
|-------|-------------|---------------|
| Mystery | Unexplored territory, open questions | Level 1 (Principle) |
| Heuristic | Rule of thumb, incomplete but useful | Levels 3-4 (Rules, Patterns) |
| Algorithm | Precise, repeatable procedure | Level 5 (Concrete Example) |

Key insight: Value is created by moving knowledge from Mystery to Algorithm. Documentation should mirror this progression.

## DITA Concept-Task-Reference (IBM, 2001)

Darwin Information Typing Architecture defines three information types:

| Type | Reader's question | Maps to Level |
|------|-------------------|---------------|
| Concept | What is it? Why does it matter? | Levels 1-2 |
| Task | How do I do it? | Levels 4-5 |
| Reference | What are the exact facts? | Levels 2-3 |

Key insight: Group by subject, order as Concept → Task → Reference within each subject.

## Hayakawa's Abstraction Ladder (1939)

S.I. Hayakawa's "Language in Action" proposes that language operates on a continuous ladder from concrete to abstract.

Core principle: **Dead-level abstracting** — staying at a single abstraction level — disengages readers:
- Too abstract: vague, unactionable
- Too concrete: overwhelming, not generalizable

Effective communication moves **up and down** the ladder:
- Ascending (ask "Why?"): from specific instance to general principle
- Descending (ask "How?"): from principle to example

## Bret Victor's Extension (2011)

"Up and Down the Ladder of Abstraction" argues that **fluency in moving between abstraction levels is the essential skill of system designers**. Understanding emerges from systematically alternating between concrete instances and abstract parameter spaces.

## C4 Model (Simon Brown)

Four-level architecture documentation:

| Level | Scope | Maps to |
|-------|-------|---------|
| Context | System in environment | Level 1 |
| Container | Deployable units | Level 2 |
| Component | Internal structure | Level 3 |
| Code | Implementation detail | Level 5 |

## Progressive Disclosure (Jakob Nielsen, 1995)

- Present essential information initially; reveal detail on demand
- Maximum two disclosure levels for usability
- Navigation to deeper levels requires strong information scent

Applied to documentation: entry point is abstract (Level 1-2), reader drills into concrete detail (Level 4-5) as needed.

## Synthesis

No single framework spans the full 5-level ladder. The framework used in this skill combines:

| Level | Primary source | Secondary source |
|-------|---------------|-----------------|
| 1 Principle | Martin (Mystery) | Hayakawa (top rungs) |
| 2 Structure/Contract | DITA (Reference) | C4 (Container) |
| 3 Rules | Martin (Heuristic) | C4 (Component) |
| 4 Patterns | Martin (Heuristic, named) | DITA (Task) |
| 5 Concrete Example | Martin (Algorithm) | Hayakawa (bottom rungs) |

The connecting tissue between levels (the "because" upward and "therefore" downward) comes from Hayakawa's core insight: never stay at one level.
