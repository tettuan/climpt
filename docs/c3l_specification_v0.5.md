# C3L (Climpt 3-word Language) Specification v0.5

> **Official Name**: C3L - Climpt 3-word Language
> **Version**: 0.5
> **Status**: Official Specification
> **Purpose**: Define C3L as a three-word command language for expressing structured intent among multiple Agents, compatible with Claude Code sub-agents and equivalent agent frameworks.

---

## 0. About C3L v0.5

**C3L** (Climpt 3-word Language) is a **minimal and expressive command language** designed to serve as a shared communication medium among autonomous or semi-autonomous Agents.
It provides a uniform structure to express **intent (Action)**, **context (Target)**, and **responsibility (Agent)** with linguistic clarity and executional precision.

C3L v0.5 formalizes the role of **Agents** — corresponding directly to *Claude Code sub-agents* or equivalent autonomous modules — as first-class participants in the language.

---

## 1. Core Linguistic Model

C3L commands always consist of **three semantic words**, represented by `c1`, `c2`, and `c3`.

| Symbol | Role | Meaning | Example |
|---------|------|----------|----------|
| **c1** | **Agent-Domain** | “Who acts” — the *Agent* (speaker) and its *domain of operation* | `climpt-git`, `inspector-code` |
| **c2** | **Action** | “What is done” — an operation, transformation, or inquiry | `create-secure`, `analyze-deep` |
| **c3** | **Target** | “What is acted upon” — the target object or contextual scope | `api-service`, `stock-prices` |

Canonical structure:
```
<c1> <c2> <c3>
```

Example:
```bash
climpt-code build-robust api-service
↑c1       ↑c2           ↑c3
```

---

## 2. Agent and Domain

### 2.1 Agent Definition

The **Agent** represents the *speaker and executor* of a C3L command.
It corresponds one-to-one with a runtime entity such as a sub-agent, autonomous actor, or modular service.

```
<agent-name>-<domain>
```

#### Agent–SubAgent Correspondence

> Each C3L Agent corresponds directly to an **operational sub-agent** in the execution environment.

| Framework | Equivalent Concept | Example Mapping |
|------------|-------------------|-----------------|
| **Claude Code** | Sub-Agent | `inspector`, `builder`, `auditor`, `planner` |
| **OpenAI MCP** | Tool Agent | `meta`, `git`, `infra` |
| **LangGraph / CrewAI** | Node Agent | `code`, `data`, `test` |
| **Deno / CLI** | Process Agent | `climpt-code`, `climpt-git` |
| **Microservice Mesh** | Service Actor | `infra`, `pm`, `ops` |

Thus, **C3L functions as the shared command dialect among all agents**, ensuring a consistent linguistic interface across heterogeneous systems.

#### Default Agent

- Default agent name: **`climpt`**
- Represents the **neutral system agent** with no specialized personality.
- Example:
  ```bash
  climpt-data fetch-latest stock-prices
  ```
  → Executed by the default `climpt` agent in `data` domain.

#### Custom Agents

- Agent names can be replaced freely:
  - `inspector-git` → diagnostic sub-agent for Git operations
  - `auditor-sec` → compliance agent for security auditing
  - `builder-infra` → generative agent for infrastructure deployment

---

## 3. Word Semantics (c1–c3)

| Word | Linguistic Role | Description |
|------|-----------------|--------------|
| **c1 (Agent-Domain)** | Subject | Defines who acts (Agent) and in which domain |
| **c2 (Action)** | Verb | Defines what operation is performed |
| **c3 (Target)** | Object | Defines what the operation is applied to |

---

## 4. Grammar Definition

### 4.1 Formal Syntax

```ebnf
C3L_Command   := C1 C2 C3 Options? ;

C1            := AgentName "-" DomainName ;
C2            := Verb | Verb "-" Modifier ;
C3            := Object | Object "-" Context ;
Options       := ( "--" OptionName "=" Value )* ;

AgentName     := Identifier ;    (* e.g., climpt, inspector, auditor *)
DomainName    := Identifier ;    (* e.g., code, git, data, infra *)
```

### 4.2 Default Resolution Rules

| Case | Example | Interpretation |
|------|----------|----------------|
| Default Agent | `climpt-code build-robust api-service` | Agent = `climpt` |
| Custom Agent | `inspector-git trace-full error-log` | Agent = `inspector` |
| Specialized Execution | `auditor-sec validate-full container-policy` | Agent = `auditor` |

---

## 5. Agent Roles and Behavioral Semantics

Each Agent carries distinct behavioral intent but adheres to the same C3L grammar.

| Agent | Function | Style |
|--------|-----------|--------|
| **climpt** | Default orchestrator | Neutral, general-purpose |
| **inspector** | Diagnostic observer | Analytical, exploratory |
| **auditor** | Compliance enforcer | Strict, rule-based |
| **builder** | Constructive executor | Creative, generative |
| **curator** | Documentation maintainer | Reflective, descriptive |
| **planner** | Process coordinator | Strategic, scheduling-focused |

All Agents speak the same C3L language — their difference lies in **interpretation and purpose**, not syntax.

---

## 6. Multi-Agent Coordination

Agents may communicate and cooperate via **C3L chaining** or message passing.

```bash
climpt-data fetch-latest stock-prices | inspector-code analyze-deep trends
```

Each Agent treats a C3L command as both:
- a **linguistic utterance** (semantic intent), and
- an **executional instruction** (operational context).

This enables mixed-agent orchestration under a unified grammar.

---

## 7. Validation and Compliance

### 7.1 Structural Rules
1. Exactly **3 tokens** before options
2. First token must match `<agent>-<domain>` format
3. Each word must preserve its grammatical role
4. Hyphens allowed **within** tokens only
5. Options begin with `--` and follow standard key-value form

### 7.2 Example (Valid and Invalid)

✅ Valid:
```bash
climpt-code build-robust api-service
auditor-sec audit-full container-image
```

❌ Invalid:
```bash
climpt code create api           # missing hyphen in c1
climpt-code create api spec      # 4 tokens
```

---

## 8. Conceptual Summary

| Concept | Description |
|----------|-------------|
| **c1** | Defines the speaker and context (Agent + Domain) |
| **c2** | Defines the action (verb/intent) |
| **c3** | Defines the target (object/context) |
| **Agent** | Corresponds to a runtime sub-agent (Claude Code or equivalent) |
| **Default Agent** | `climpt` |
| **Goal** | Provide a cross-agent linguistic protocol for structured intent exchange |

---

## 9. Example Commands

```bash
# Default Agent
climpt-git merge feature-branch
climpt-data fetch-latest stock-prices

# Sub-Agent (Inspector)
inspector-code analyze-deep build-logs
inspector-git trace-full branch-history

# Compliance Agent
auditor-sec audit-full container-image

# Builder Agent
builder-infra deploy-safe production-env
```

---

## 10. Summary Principle

> **C3L treats each command as a complete utterance.**
>
> - `c1` — defines *who* speaks and acts (Agent + Domain)
> - `c2` — defines *what* is done (Action)
> - `c3` — defines *what it affects* (Target)
>
> Each Agent corresponds to a sub-agent or autonomous executor capable of interpreting these utterances.
> C3L is thus the **common language among agents**, bridging human and machine intent.

---

## 11. Governance and License

**Specification Maintainer**: Climpt Project Team
**License**: MIT
**Repository**: `github.com/[org]/climpt-c3l-spec`
**Status**: Latest Official Version (v0.5)

---

*End of C3L Specification v0.5*
