# Climpt Project-Specific AI Invocation Language – Spec & Claude Code Integration v0.1

> Status: **Draft v0.1** (stabilize after field testing)
> Scope: Defines the *project-specific AI invocation language* built on `climpt` 3-words CLI, and its integration contract with CLI AI agents (e.g., Claude Code).

---

## 0. Design Goals

* **Deterministic prompt generation** from a canonical 3-words command shape.
* **Human-readable SVO/SVOO semantics**, machine-parseable grammar.
* **Stable interface** for AI agents via a *handoff prompt* template and JSON payload.
* **Composable variables** via `-i`, `-a`, `-f`, `--uv-*`, and `STDIN`.
* **Reproducibility**: canonical ordering & normalization rules.
* **Safety**: prompt-injection resistance, escaping/quoting rules.

---

## 1. Command Shape (Canonical Form)

### 1.1 3-Words Command

```
climpt-<c1> <c2> <c3> [OPTIONS] [VARIANTS] [STDIN]
```

Where:

* `<c1>` = **Category** (domain top-level)
* `<c2>` = **Verb** (action)
* `<c3>` = **Object** (target)

### 1.2 Options & Inputs (Canonical Order)

```
-i=<o1> -a=<o2> -f=<input_file> --uv-<name>=<value>... <<< "STDIN"
```

* `-i=<o1>`: **primary input type/mode** (e.g., `SQL`, `JSON`, `SCHEMA`, `TEXT`, `CSV`, `YAML`, `MD`, `CODE`)
* `-a=<o2>`: **additional mode/variant** (free-form or enum per command)
* `-f=<path>`: **file payload** path (relative/absolute)
* `--uv-<name>=<value>`: **user variable(s)**; repeatable
* `<<< "..."`: **STDIN heredoc** short free text

> **Normalization**: Parser accepts any option order but **emits** canonical order: `-i`, `-a`, `-f`, `--uv-*` (sorted by variable name), then `STDIN`.

### 1.3 Examples

```
climpt-data fetch prices -i=SQL -a=compact -f=query.sql --uv-market=JP <<< "latest month"
climpt-report generate summary -i=JSON --uv-scope=release --uv-format=md <<< "focus on risk"
climpt-code transform schema -i=SCHEMA -f=domain.yaml --uv-target=go <<< "repository pattern"
```

---

## 2. Semantics (SVO / SVOO)

* **S (Subject)**: `climpt-<c1>` (the domain category / agent role)
* **V (Verb)**: `<c2>` (action: `fetch`, `transform`, `generate`, `validate`, `render`, `deploy`, etc.)
* **O (Object)**: `<c3>` (target: `prices`, `schema`, `summary`, `chart`, etc.)
* **O' (Secondary Object)**: supplied via `-i`/`-a` or content-bearing options

Mapping intuition:

* *SVO*: `climpt-data fetch prices` → “(Data agent) fetch (prices)”
* *SVOO*: `-i=SQL -a=compact` → additional/secondary objects/constraints

---

## 3. Grammar (EBNF)

```
Command       := Executable WS Verb WS Object WS Clauses? WS Stdin? ;
Executable    := "climpt-" Category ;
Category      := Ident ;          (* c1 *)
Verb          := Ident ;          (* c2 *)
Object        := Ident ;          (* c3 *)

Clauses       := (WS Option)* (WS Var)* (WS File)? ;  (* input order free; normalized on emit *)
Option        := InputOpt | AddOpt ;
InputOpt      := "-i=" Value ;   (* primary input type/mode *)
AddOpt        := "-a=" Value ;   (* additional mode/variant *)
File          := "-f=" Path ;
Var           := "--uv-" VarName "=" Value ;
Stdin         := '<<<' WS Quoted ;

Ident         := [a-zA-Z][a-zA-Z0-9_-]* ;
VarName       := [a-zA-Z][a-zA-Z0-9_-]* ;
Path          := /[^\s]+/ ;
Value         := Quoted | Bare ;
Bare          := [^\s]+ ;
Quoted        := '"' QuotedChar* '"' ;
QuotedChar    := /[^"\\]/ | '\\"' | '\\\\' ;
WS            := /\s+/ ;
```

### 3.1 Reserved Words

* Verbs (recommended set): `fetch`, `transform`, `generate`, `validate`, `render`, `analyze`, `summarize`, `deploy`, `test`, `package`.
* Categories (recommended set): `data`, `code`, `report`, `infra`, `test`, `design`.
* Objects: domain-specific; maintain a registry per project.

### 3.2 Case & Kebab

* Prefer **lower-kebab-case** for identifiers; parser is case-sensitive by default.

---

## 4. Typing & Validation

### 4.1 Input Types (`-i`)

Enumerated baseline: `SQL | JSON | SCHEMA | TEXT | CSV | YAML | MD | CODE`.

* Projects may extend with `PROTO`, `OPENAPI`, `GRAPHQL`, `PARQUET`, etc.

### 4.2 Additional Options (`-a`)

* Either free-form or verb/object-specific enums, e.g.,

  * `fetch prices -a=compact|full|ohlcv`
  * `generate summary -a=daily|weekly|release`

### 4.3 Variables (`--uv-*`)

* Names: `^[a-z][a-z0-9_-]*$`
* Values: quoted for spaces or special chars
* Collisions: last one wins during parse; normalized output **deduplicates by name**.

### 4.4 File (`-f`)

* Resolve vs CWD; forbid directory traversal if configured (see §9 Security).

### 4.5 Compatibility Matrix (excerpt)

```
Category  Verb        Object    -i         -a            Required
--------- ----------  --------  ---------- ------------- --------
data      fetch       prices    SQL|JSON   compact|full  -i
report    generate    summary   JSON|TEXT  daily|weekly  (none)
code      transform   schema    SCHEMA     go|ts|rust    -i
```

---

## 5. Canonical Emission & Normalization

* Option order: `-i`, `-a`, `-f`, then sorted `--uv-*` (by `name` ASC).
* Quoting: prefer **double quotes**; escape `"` and `\` inside.
* Whitespace: collapse multiple spaces to single in emission.
* Idempotence: `emit(parse(cmd)) == canonical(cmd)`.

---

## 6. AST & JSON Schema

### 6.1 AST (logical model)

```json
{
  "version": "0.1",
  "c1": "data",
  "c2": "fetch",
  "c3": "prices",
  "options": { "i": "SQL", "a": "compact", "f": "query.sql" },
  "uv": { "market": "JP" },
  "stdin": "latest month"
}
```

### 6.2 JSON Schema (draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.org/climpt-language.schema.json",
  "title": "Climpt Invocation AST",
  "type": "object",
  "required": ["version", "c1", "c2", "c3"],
  "properties": {
    "version": {"type": "string", "const": "0.1"},
    "c1": {"type": "string", "pattern": "^[a-z][a-z0-9_-]*$"},
    "c2": {"type": "string", "pattern": "^[a-z][a-z0-9_-]*$"},
    "c3": {"type": "string", "pattern": "^[a-z][a-z0-9_-]*$"},
    "options": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "i": {"type": "string"},
        "a": {"type": "string"},
        "f": {"type": "string"}
      }
    },
    "uv": {
      "type": "object",
      "patternProperties": {
        "^[a-z][a-z0-9_-]*$": {"type": ["string", "number", "boolean"]}
      },
      "additionalProperties": false
    },
    "stdin": {"type": ["string", "null" ]}
  }
}
```

---

## 7. Prompt Generation (Handoff to AI Agent)

### 7.1 Canonical Prompt Template

```
[CLIMPT v0.1 HANDOFF]
C1: <c1>
C2: <c2>
C3: <c3>
I:  <options.i>
A:  <options.a>
F:  <options.f>
UV: <uv as key=value, comma-separated, sorted>
STDIN: <stdin or "">

# ROLE
You are the <c1> agent performing action <c2> on <c3>.

# INTENT
Execute the task precisely as specified by SVO/SVOO semantics above.

# INPUTS
- Primary Input (-i): <options.i>
- Additional (-a): <options.a>
- File (-f): <resolved file content or a summary directive>
- Variables (--uv-*): <expanded list>
- Inline (STDIN): <stdin>

# CONSTRAINTS
- Follow canonical ordering and normalization rules.
- Do not deviate beyond the specified scope.
- If information is missing, produce a minimal placeholder and report which field is missing.

# OUTPUT CONTRACT
- Provide the requested artifact; if code or data, ensure it is syntactically valid.
- Include a brief header `[[CLIMPT-RESULT v0.1]]` and machine-readable footer `[[/CLIMPT-RESULT]]`.

# STEPS (SUGGESTED)
1) Interpret SVO/SVOO intent.
2) Validate inputs against compatibility matrix.
3) Resolve variables and file content.
4) Produce the artifact.
5) Emit summary with key decisions.
```

> **Note**: For large `-f`, pass *file path only* and ask the agent to request chunks or summaries to mitigate token limits.

### 7.2 Emission Modes

* **stdout**: print the handoff prompt (default)
* **--emit=json**: print the AST (JSON) for programmatic use
* **--emit=both**: print prompt then `\n---\n` then JSON

---

## 8. Integration with Claude Code (CLI Agent)

### 8.1 Pipe Handoff (simple)

```bash
PROMPT=$(climpt-data fetch prices -i=SQL -a=compact -f=query.sql --uv-market=JP <<< "latest month")
claude-code --prompt "$PROMPT"
```

### 8.2 Direct Pipe

```bash
climpt-data fetch prices -i=SQL -a=compact -f=query.sql --uv-market=JP \
  <<< "latest month" | claude-code --prompt -
```

### 8.3 File Handoff

```bash
climpt-data fetch prices -i=SQL -a=compact -f=query.sql --uv-market=JP \
  <<< "latest month" > .climpt/handoff/2025-08-14T12-00Z.txt
claude-code --prompt-file .climpt/handoff/2025-08-14T12-00Z.txt
```

### 8.4 Result Capture Contract

* Claude Code should wrap outputs with markers:

```
[[CLIMPT-RESULT v0.1]]
...payload...
[[/CLIMPT-RESULT]]
```

* `climpt` may provide a `--capture` helper to extract the payload.

### 8.5 Environment Conventions

* `CLIMPT_PROJECT_ROOT` — base path resolution
* `CLIMPT_EMIT` — `prompt|json|both`
* `CLIMPT_STRICT` — `0|1` to enable strict validation
* `CLIMPT_MAX_FILE_BYTES` — cap for `-f` ingestion

### 8.6 Exit Codes

* `0` success (prompt emitted)
* `2` parse error (see §10)
* `3` validation error
* `4` file IO error

---

## 9. Security & Prompt-Injection Mitigations

* **Quoting/escaping**: enforce double-quoted strings; escape `"` and `\`.
* **File gating**: forbid `..` path segments if `CLIMPT_STRICT=1`.
* **Redaction**: mask sensitive UV keys (e.g., `token`, `apikey`) in prompt headers.
* **Size limits**: enforce `CLIMPT_MAX_FILE_BYTES`.
* **Echo discipline**: never echo raw secrets to stdout; prefer placeholders.
* **Agent guardrails**: constraints block instructs agents to respect scope and request missing fields rather than hallucinating.

---

## 10. Errors & Diagnostics (Catalog)

```
E100 ParseError        unrecognized token near <...>
E110 MissingC1C2C3     command must be 3-words
E120 InvalidIdent      identifier does not match ^[a-z][a-z0-9_-]*$
E130 OptionCollision   duplicate option; last-wins normalization applied
E200 ValidationError   incompatible -i/-a for <c1>/<c2>/<c3>
E300 FileNotFound      cannot resolve -f path
E310 FileTooLarge      exceeds CLIMPT_MAX_FILE_BYTES
E900 InternalError     unexpected condition; please report
```

* **Diagnostic Tips**: emit canonical suggestion when possible: `Did you mean: <canonical form>`.

---

## 11. Test Vectors (Parsing & Canonicalization)

### 11.1 Valid

```
IN : climpt-data fetch prices -i=SQL -a=compact -f=query.sql --uv-market=JP <<< "latest month"
OUT: climpt-data fetch prices -i=SQL -a=compact -f=query.sql --uv-market=JP <<< "latest month"
AST: { c1:"data", c2:"fetch", c3:"prices", options:{i:"SQL",a:"compact",f:"query.sql"}, uv:{market:"JP"}, stdin:"latest month" }
```

```
IN : climpt-report generate summary --uv-scope=release -i=JSON <<< "focus on risk"
OUT: climpt-report generate summary -i=JSON --uv-scope=release <<< "focus on risk"
```

### 11.2 Invalid

```
IN : climpt-data prices fetch
ERR: E110 MissingC1C2C3 (verb/object order invalid)
```

```
IN : climpt-data fetch prices -i=
ERR: E100 ParseError (empty value)
```

---

## 12. Domain Registry (Example Seeds)

```
Category: data
  Verbs  : fetch|transform|validate|analyze
  Objects: prices|symbols|metadata|ohlcv

Category: report
  Verbs  : generate|render|summarize
  Objects: summary|release-notes|risk-log

Category: code
  Verbs  : transform|generate|validate|package
  Objects: schema|client|server|tests
```

---

## 13. Tooling Roadmap

* **Parser/Emitter**: Deno/TypeScript module in `@aidevtool/climpt-language`
* **CLI wrappers**: `.deno/bin/climpt-<c1>` shims auto-dispatching to core
* **Shell completion**: generate zsh/bash completions from the domain registry
* **Linter**: `climpt lint` to enforce canonicalization and matrix validation
* **Formatter**: `climpt fmt` to re-emit canonical command

---

## 14. Make/CI Integration (Examples)

```Makefile
fetch-prices:
	climpt-data fetch prices -i=SQL -a=compact -f=query.sql --uv-market=$(MARKET) <<< "latest month" \
	| claude-code --prompt -
```

```yaml
# GitHub Actions (excerpt)
- name: Generate release summary
  run: |
    climpt-report generate summary -i=JSON --uv-scope=release \
      -f=out/report.json <<< "concise" | claude-code --prompt - > SUMMARY.md
```

---

## 15. Versioning & Compatibility

* Language version in AST: `version: "0.1"`
* Handoff markers: `[[CLIMPT-RESULT v0.1]]` / `[[/CLIMPT-RESULT]]`
* Backward-compatible additions only within `0.x`; breaking changes bump minor.

---

## 16. Quick Reference

* **Shape**: `climpt-<c1> <c2> <c3> -i=<o1> -a=<o2> -f=<file> --uv-<k>=<v>... <<< "stdin"`
* **Best practice**: keep `STDIN` short; use `-f` for large payloads; use UVs for knobs.
* **Security**: quote everything; never pass secrets verbatim.

---

*End of Spec v0.1*
