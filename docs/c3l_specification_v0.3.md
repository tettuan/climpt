# C3L (Climpt 3-word Language) Specification v0.3

> **Official Name**: C3L - Climpt 3-word Language\
> **Version**: 0.3\
> **Status**: Draft (stabilizing)\
> **Purpose**: Define the standard 3-word command language for Climpt AI
> invocation system

---

## 0. About C3L

**C3L** (Climpt 3-word Language) is a command language specification designed to
balance:

- Strict 3-word constraint for CLI parsing
- Natural English readability
- Systematic AI agent integration
- Expressive power through compound words

---

## 1. C3L Core Principles

### 1.1 The Three Words

Every C3L command consists of exactly **3 space-separated tokens**:

```
climpt-<domain> <action-phrase> <target-context>
```

1. **Word 1**: Domain/Agent (prefixed with `climpt-`)
2. **Word 2**: Action (verb or verb-modifier)
3. **Word 3**: Target (object or object-context)

### 1.2 Compound Word Strategy

Hyphens within words allow complex concepts while maintaining 3-token structure:

```bash
# Simple C3L
climpt-code create api

# Compound C3L
climpt-code create-secure api-gateway
```

---

## 2. C3L Grammar

### 2.1 Formal Definition

```ebnf
C3L_Command   := Domain Action Target Options? ;

(* The 3 Words *)
Domain        := "climpt-" DomainName ;
Action        := SimpleAction | CompoundAction ;
Target        := SimpleTarget | CompoundTarget ;

(* Compound Structure *)
CompoundAction := Verb "-" ActionModifier ;
CompoundTarget := Object "-" TargetModifier ;
```

### 2.2 C3L Parsing Rules

1. **Split by spaces** → Must have exactly 3 tokens (before options)
2. **Preserve hyphens** within each token
3. **Validate** against C3L domain-action-target matrix

---

## 3. C3L Patterns

### Pattern A: Simple C3L

```bash
climpt-code create api
climpt-data fetch prices
climpt-git merge branch
```

### Pattern B: Action-Modified C3L

```bash
climpt-code create-secure api
climpt-code build-robust service
climpt-data fetch-latest prices
```

### Pattern C: Target-Modified C3L

```bash
climpt-code create api-service
climpt-infra deploy staging-app
climpt-data analyze price-trends
```

### Pattern D: Full-Compound C3L (Recommended)

```bash
climpt-code create-secure api-service
climpt-infra deploy-safe staging-env
climpt-data fetch-historical stock-prices
```

---

## 4. C3L Domains

Standard C3L domains:

| Domain  | Purpose         | Example                                   |
| ------- | --------------- | ----------------------------------------- |
| `code`  | Code operations | `climpt-code build-robust api-service`    |
| `data`  | Data processing | `climpt-data analyze-deep price-trends`   |
| `infra` | Infrastructure  | `climpt-infra deploy-safe production-app` |
| `docs`  | Documentation   | `climpt-docs generate-full api-spec`      |
| `git`   | Version control | `climpt-git create-feature branch`        |
| `test`  | Testing/QA      | `climpt-test validate-strict design-spec` |
| `meta`  | Meta operations | `climpt-meta list-all commands`           |

---

## 5. C3L Action Verbs

Core C3L verbs and their modifiers:

| Base Verb  | Modifiers                      | C3L Examples      |
| ---------- | ------------------------------ | ----------------- |
| `create`   | `-new`, `-secure`, `-empty`    | `create-secure`   |
| `build`    | `-robust`, `-fast`, `-minimal` | `build-robust`    |
| `analyze`  | `-deep`, `-quick`, `-full`     | `analyze-deep`    |
| `deploy`   | `-safe`, `-rolling`, `-canary` | `deploy-safe`     |
| `fetch`    | `-latest`, `-all`, `-cached`   | `fetch-latest`    |
| `validate` | `-strict`, `-basic`, `-full`   | `validate-strict` |

---

## 6. C3L Target Objects

Common C3L target patterns:

| Base Object | Modifiers                           | C3L Examples     |
| ----------- | ----------------------------------- | ---------------- |
| `api`       | `-service`, `-gateway`, `-spec`     | `api-gateway`    |
| `data`      | `-model`, `-pipeline`, `-schema`    | `data-pipeline`  |
| `env`       | `-staging`, `-production`, `-local` | `staging-env`    |
| `test`      | `-suite`, `-coverage`, `-report`    | `test-suite`     |
| `branch`    | `-feature`, `-hotfix`, `-release`   | `feature-branch` |

---

## 7. C3L Compliance Examples

### 7.1 C3L Compliant Commands

```bash
# ✅ Valid C3L v0.3
climpt-code create api                    # Pattern A
climpt-code create-secure api             # Pattern B
climpt-code create api-service            # Pattern C
climpt-code create-secure api-service     # Pattern D
```

### 7.2 Non-Compliant Examples

```bash
# ❌ Not C3L compliant
climpt create api                         # Missing domain prefix
climpt-code create                        # Only 2 words
climpt-code create secure api             # 4 words (space in between)
create-api-for-service                    # No climpt prefix
```

---

## 8. C3L Implementation

### 8.1 C3L Parser Interface

```python
def parse_c3l(command: str) -> C3LCommand:
    """Parse a C3L-compliant command string"""
    tokens = command.split()
    
    if len(tokens) < 3:
        raise C3LError("C3L requires exactly 3 words")
    
    return C3LCommand(
        domain=tokens[0],
        action=tokens[1],
        target=tokens[2],
        options=tokens[3:]
    )
```

### 8.2 C3L Validator

```python
def validate_c3l(cmd: C3LCommand) -> bool:
    """Validate command against C3L specification"""
    # Check domain format
    if not cmd.domain.startswith("climpt-"):
        return False
    
    # Check against C3L matrix
    domain = cmd.domain[7:]
    if domain not in C3L_DOMAINS:
        return False
    
    # Validate action-target combination
    return is_valid_combination(domain, cmd.action, cmd.target)
```

---

## 9. C3L Migration Guide

### 9.1 From Pre-C3L to C3L v0.3

| Pre-C3L                          | C3L v0.3                           | Improvement     |
| -------------------------------- | ---------------------------------- | --------------- |
| `climpt-diagnose diagnose stack` | `climpt-debug analyze stack-trace` | No repetition   |
| `climpt-setup list climpt`       | `climpt-meta list commands`        | Natural reading |
| `climpt-verify verify design`    | `climpt-test validate design-spec` | Clear action    |

### 9.2 C3L Conversion Tool

```bash
# Convert old format to C3L
climpt-meta convert-to-c3l "climpt-diagnose diagnose stack"
# Output: climpt-debug analyze stack-trace

# Validate C3L compliance
climpt-meta validate-c3l "climpt-code create-secure api-gateway"
# Output: ✅ Valid C3L v0.3 command
```

---

## 10. C3L Best Practices

### 10.1 Choose Appropriate Patterns

- **Simple operations** → Pattern A (`create api`)
- **Quality emphasis** → Pattern B (`create-secure api`)
- **Specific targets** → Pattern C (`create api-gateway`)
- **Complex operations** → Pattern D (`create-secure api-gateway`)

### 10.2 Compound Word Guidelines

✅ **Good C3L compounds**:

- 2-3 parts maximum
- Clear semantic relationship
- Common English phrases

❌ **Avoid over-compounding**:

```bash
# Bad: Too complex
climpt-code create-super-secure-scalable api-gateway-service-v2

# Good: Use options for additional attributes
climpt-code create-secure api-gateway --version=2 --scalable
```

### 10.3 Semantic Clarity

Each C3L word should have one clear role:

- **Word 1**: WHO (which agent/domain)
- **Word 2**: WHAT (what action to take)
- **Word 3**: WHERE (what to act upon)

---

## 11. C3L Roadmap

### v0.3 (Current)

- ✅ 3-word structure with compounds
- ✅ Natural English patterns
- ✅ Migration from legacy format

### v0.4 (Planned)

- [ ] C3L validation library
- [ ] Auto-completion support
- [ ] IDE integration

### v1.0 (Future)

- [ ] C3L certification program
- [ ] Multi-language support
- [ ] Extended C3L for complex workflows

---

## 12. C3L License & Governance

C3L is an open specification designed for the Climpt ecosystem. Contributions
and extensions are welcome following the C3L principles.

**Specification Maintainer**: Climpt Project Team\
**License**: MIT\
**Repository**: github.com/[org]/climpt-c3l-spec

---

_End of C3L Specification v0.3_
