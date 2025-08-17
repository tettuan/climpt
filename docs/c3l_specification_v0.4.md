# C3L (Climpt 3-word Language) Specification v0.4

> **Official Name**: C3L - Climpt 3-word Language  
> **Version**: 0.4  
> **Status**: Draft (stabilizing)  
> **Purpose**: Define the standard 3-word command language for Climpt AI invocation system with expanded functional domains

---

## 0. About C3L

**C3L** (Climpt 3-word Language) is a command language specification designed to balance:
- Strict 3-word constraint for CLI parsing
- Natural English readability
- Systematic AI agent integration
- Expressive power through compound words
- Clear classification of functional domains

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
3. **Validate** against the C3L domain-action-target matrix

---

## 3. Functional Domains (Classification by Object Nature)

CLI domains are classified by **what kind of object they operate on**.  
The standard domains are defined as follows:

### 3.1 Code & Data
| Domain | Purpose |
|--------|---------|
| `code` | Code operations |
| `data` | Data processing |
| `spec` | Requirements & specifications |

### 3.2 Infrastructure & Operations
| Domain | Purpose |
|--------|---------|
| `infra` | Infrastructure |
| `ops` | Operations & monitoring |
| `sec` | Security & compliance |

### 3.3 Project & Management
| Domain | Purpose |
|--------|---------|
| `pm` | Project management |
| `git` | Version control |
| `docs` | Documentation |
| `test` | Testing / QA |
| `debug` | Debugging & diagnostics |

### 3.4 Meta
| Domain | Purpose |
|--------|---------|
| `meta` | Meta operations |

---

## 4. Action / Target Examples by Functional Domain

### 4.1 Code & Data

| Domain | Action | Target | C3L Example |
|--------|--------|--------|-------------|
| `code` | create | api | `climpt-code create api` |
| `code` | build-robust | service | `climpt-code build-robust service` |
| `data` | fetch-latest | stock-prices | `climpt-data fetch-latest stock-prices` |
| `data` | analyze-deep | trends | `climpt-data analyze-deep trends` |
| `spec` | define | system-requirements | `climpt-spec define system-requirements` |
| `spec` | validate-strict | rule-set | `climpt-spec validate-strict rule-set` |

### 4.2 Infrastructure & Operations

| Domain | Action | Target | C3L Example |
|--------|--------|--------|-------------|
| `infra` | deploy-safe | production-app | `climpt-infra deploy-safe production-app` |
| `infra` | scale-rolling | cluster | `climpt-infra scale-rolling cluster` |
| `ops` | monitor-continuous | staging-env | `climpt-ops monitor-continuous staging-env` |
| `ops` | restart | worker-node | `climpt-ops restart worker-node` |
| `sec` | audit-full | container-image | `climpt-sec audit-full container-image` |
| `sec` | scan-quick | vulnerabilities | `climpt-sec scan-quick vulnerabilities` |

### 4.3 Project & Management

| Domain | Action | Target | C3L Example |
|--------|--------|--------|-------------|
| `pm` | track-milestone | sprint-progress | `climpt-pm track-milestone sprint-progress` |
| `pm` | plan | release | `climpt-pm plan release` |
| `git` | merge | feature-branch | `climpt-git merge feature-branch` |
| `git` | create | hotfix-branch | `climpt-git create hotfix-branch` |
| `docs` | generate | api-spec | `climpt-docs generate api-spec` |
| `docs` | update | guide | `climpt-docs update guide` |
| `test` | run | test-suite | `climpt-test run test-suite` |
| `test` | validate | coverage-report | `climpt-test validate coverage-report` |
| `debug` | trace-full | error-log | `climpt-debug trace-full error-log` |
| `debug` | inspect | system-state | `climpt-debug inspect system-state` |

### 4.4 Meta

| Domain | Action | Target | C3L Example |
|--------|--------|--------|-------------|
| `meta` | list | commands | `climpt-meta list commands` |
| `meta` | resolve | command-definition | `climpt-meta resolve command-definition` |

---

## 5. C3L Compliance Examples

### 5.1 C3L Compliant Commands

```bash
# ✅ Valid C3L v0.4
climpt-code create api
climpt-data fetch-latest stock-prices
climpt-infra deploy-safe production-app
climpt-pm plan release
climpt-sec scan-quick vulnerabilities
```

### 5.2 Non-Compliant Examples

```bash
# ❌ Not C3L compliant
climpt create api                  # Missing domain prefix
climpt-code create                 # Only 2 words
climpt-code create secure api      # 4 words (space in between)
create-api-for-service             # No climpt prefix
```

---

## 6. C3L Best Practices

### 6.1 Choose Appropriate Patterns

- **Simple operations** → Pattern A (`create api`)
- **Quality emphasis** → Pattern B (`create-secure api`)
- **Specific targets** → Pattern C (`create api-gateway`)
- **Complex operations** → Pattern D (`create-secure api-gateway`)

### 6.2 Compound Word Guidelines

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

### 6.3 Semantic Clarity

Each C3L word should have one clear role:
- **Word 1**: WHO (which agent/domain)
- **Word 2**: WHAT (what action to take)
- **Word 3**: WHERE (what to act upon)

---

## 7. C3L Roadmap

### v0.4 (Current)
- ✅ Expanded Functional Domains
- ✅ Action/Target examples by domain
- ✅ 3-word structure with compounds
- ✅ Natural English patterns

### v1.0 (Future)
- [ ] C3L validation library
- [ ] Auto-completion support
- [ ] IDE integration
- [ ] Multi-language support
- [ ] Extended C3L for complex workflows

---

## 8. C3L License & Governance

C3L is an open specification designed for the Climpt ecosystem. Contributions and extensions are welcome following the C3L principles.

**Specification Maintainer**: Climpt Project Team  
**License**: MIT  
**Repository**: github.com/[org]/climpt-c3l-spec

---

*End of C3L Specification v0.4*
