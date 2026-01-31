# Project-Specific AI Invocation Language Specification

## 1. Purpose
This specification defines a project-specific CLI invocation language that receives input from CLI AI agents like Claude Code and provides consistent syntax, grammar, and parameter specifications for appropriate processing.

---

## 2. Grammar Specification (n1)

### 2.1 Command Structure
```
<base-command> <subcommand> [options] [--parameter=value] <<< "inline prompt"
```

- **Base command**: Project-specific CLI tool name (e.g., `climpt-data`)
- **Subcommand**: Action to perform on target (e.g., `fetch`, `analyze`, `render`)
- **Options**: Short/long forms (e.g., `-e=SQL`, `--uv-market=JP`)
- **Parameters**: Execution mode, target scope, output format, etc.
- **Inline prompt**: Natural language instruction for AI agent to interpret

### 2.2 Syntax Rules
- Arguments are space-delimited
- Parameters use `--key=value` format
- Inline prompts are enclosed in `<<< "..."`
- UTF-8 encoding required for input
- Reserved words cannot be used as subcommands (e.g., `help`, `version`)

---

## 3. Claude Code Integration Specification (n2)

### 3.1 AI Agent Input Mode
- Claude Code receives the inline prompt portion and processes natural language to convert to appropriate SQL, scripts, or API calls
- AI agent directly outputs **commands compliant with grammar specification**

### 3.2 Expected Flow
1. User inputs natural language to CLI (inline prompt)
2. CLI sends the string to Claude Code
3. Claude Code generates commands or code according to specification
4. CLI executes

---

## 4. Project-Specific AI Invocation Language (n3)

- Base commands follow project-specific naming conventions
- Subcommands are named based on **domain analysis results**
- Parameter keys are short and consistent (e.g., `-i`, `-a`, `-f`)
- Language specification is **extensible** (anticipating future feature additions)

---

## 5. Parameter Specification (n7)

| Parameter        | Type   | Required | Description                    | Example             |
|------------------|--------|----------|--------------------------------|---------------------|
| `-e`, `--edition`| ENUM   | Yes      | Input format (SQL, CSV, JSON)  | `-e=SQL`            |
| `-a`, `--agg`    | ENUM   | No       | Aggregation mode (full, compact)| `-a=compact`       |
| `-f`, `--from`   | PATH   | No       | Input file path                | `-f=query.sql`      |
| `--uv-market`    | ENUM   | No       | Market code                    | `--uv-market=JP`    |
| `--dry-run`      | BOOL   | No       | Syntax check without execution | `--dry-run`         |

---

## 6. Sample Commands (n6)

```
# Fetch latest month's stock prices from JP market
climpt-data fetch prices -e=SQL -a=compact -f=query.sql --uv-market=JP <<< "latest month"

# Analyze 2023 data for specific stock
climpt-data analyze trends -e=CSV --symbol=7203 <<< "analyze year 2023"

# Output generated chart in PNG format
climpt-data render chart --format=png <<< "daily close prices"
```

---

## 7. Procedure for Deriving Invocation Language from Domain Analysis

1. **Identify Domain Boundaries**
   - Identify project's business scope (e.g., stock price retrieval, analysis, visualization)
2. **Extract Use Cases**
   - List main processes users execute
   - Create subcommand candidates in verb form (e.g., fetch, analyze, render)
3. **Define Entities**
   - Clarify data structures (e.g., prices, trends, orders)
4. **Determine Command Naming Rules**
   - Standardize to `<verb> <entity>` format
5. **Parameter Mapping**
   - Define variable elements needed for each use case as parameters
   - Set type, required/optional, and default values
6. **Determine AI Interpretation Scope**
   - Separate parts for AI interpretation (natural language) from CLI interpretation (parameters)
7. **Prototype Validation**
   - Load specification into Claude Code and verify it works correctly with sample prompts
8. **Create Final Specification**
   - Integrate grammar spec (n1), integration spec (n2), language spec (n3), parameter spec (n7), and attach samples (n6)

---

## 8. Version Management
- Managed in `vMAJOR.MINOR.PATCH` format
- Update MINOR for new features, MAJOR for backward-incompatible changes
- Documentation stored as `docs/cli-language.md` in repository
