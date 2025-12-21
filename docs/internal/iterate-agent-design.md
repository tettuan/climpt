# Iterate Agent - Design Specification

**Version**: 1.0.0
**Date**: 2025-12-20
**Status**: Draft

---

## 1. Executive Summary

### 1.1 Purpose
イテレーションを繰り返しながら開発サイクルを自律的に実行するエージェントシステムの設計。GitHub の Issue/Project から要件を取得し、Climpt Skills を活用して開発タスクを継続的に実行する。

### 1.2 Key Features
- CLI 起動による永続実行モード
- GitHub Issue/Project ベースの要件駆動開発
- Climpt Skills を介した開発サイクルの自動化
- 役割ベースのシステムプロンプト切り替え
- JSONL ベースの詳細ログ記録と自動ローテーション

---

## 2. Requirements Specification

### 2.1 Functional Requirements

#### FR-1: CLI Based Execution
- **Requirement**: Terminal から Deno で起動し、Claude Agent SDK を呼び出す
- **Rationale**: Claude Code CLI からの指示ではなく、独立した自律エージェントとして動作
- **Priority**: Critical

#### FR-2: Requirement Acquisition
- **Requirement**: GitHub から Issue/Project を取得し、作業要件を抽出
- **Rationale**: 外部システムとの連携による要件駆動開発の実現
- **Priority**: High

#### FR-3: Climpt Skills Integration
- **Requirement**: delegate-climpt-agent スキルを使用してタスクを実行
- **Rationale**: 既存の Climpt インフラストラクチャを活用
- **Priority**: Critical

#### FR-4: Perpetual Execution Cycle
- **Requirement**: 1つのイテレーション（= 1つの完全な query() セッション）完了後、新しいセッションを開始して継続実行
- **Rationale**: 人間の介入なしに開発サイクルを継続。各イテレーションで Main Claude が複数のタスクを実行可能
- **Priority**: Critical

#### FR-5: Completion Criteria
- **Requirement**: Issue 番号、Project 番号、イテレーション回数による完了判定
- **Rationale**: 実行範囲の明確な制御
- **Priority**: High

#### FR-6: Role-based System Prompts
- **Requirement**: `--agent-role` パラメータによるシステムプロンプト切り替え
- **Rationale**: QA、開発者、アーキテクトなど役割に応じた振る舞いの変更
- **Priority**: Medium

### 2.2 Non-Functional Requirements

#### NFR-1: Logging
- **Requirement**: tmp/logs/agents/{name}/*.jsonl 形式でログ保存、最大 100 ファイル自動ローテーション
- **Rationale**: デバッグ性とストレージ管理の両立
- **Priority**: High

#### NFR-2: Error Handling
- **Requirement**: Sub-agent エラー時の適切なリトライとログ記録
- **Rationale**: 長時間実行における堅牢性
- **Priority**: High

#### NFR-3: Context Management
- **Requirement**: Main Claude と Sub-agent のコンテキスト分離
- **Rationale**: メモリ効率とタスク集中度の向上
- **Priority**: High

---

## 3. System Architecture

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Terminal (CLI Entry)                   │
│                deno task iterate-agent run              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Iterate Agent (agent.ts)                   │
│  - CLI Argument Parsing                                 │
│  - Configuration Loading                                │
│  - Logger Initialization                                │
│  - Main Loop Management                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Calls Claude Agent SDK
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Main Claude (SDK Instance)                 │
│  - System Prompt: Role-based instructions               │
│  - Allowed Tools: Skill, Read, Write, Bash, etc.        │
│  - Settings Sources: project, user                      │
│  - Permission Mode: acceptEdits (for automation)        │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Uses Skill tool
                     ▼
┌─────────────────────────────────────────────────────────┐
│        Climpt Agent Skill (delegate-climpt-agent)       │
│  - Receives task description from Main Claude           │
│  - Spawns isolated sub-agent                            │
│  - Returns AI-generated summary                         │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Spawns sub-agent
                     ▼
┌─────────────────────────────────────────────────────────┐
│            Sub-agent (climpt-agent.ts)                  │
│  - Executes specific task in isolation                  │
│  - Uses Climpt commands via registry                    │
│  - Logs to JSONL (tmp/logs/climpt-agents/)              │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
1. CLI Start
   └─> Parse arguments (--issue, --project, --iterate-max, --name)
   └─> Load agent configuration
   └─> Initialize logger

2. Initial Setup (Once)
   └─> GitHub API: Fetch Issue/Project requirements
   └─> Build initial prompt with requirements
   └─> Build system prompt

3. Iteration Loop (Each iteration = one complete query() session)
   ┌─> Start new query() session
   │   └─> Send current prompt to Main Claude
   │
   ├─> Main Claude Session Processing
   │   ├─> Analyze requirements/context
   │   ├─> Invoke Skill: delegate-climpt-agent (potentially multiple times)
   │   │   └─> Sub-agent executes task
   │   │   └─> Returns AI-generated summary
   │   └─> Session completes naturally
   │
   ├─> Iteration Complete
   │   └─> Increment iteration count
   │
   ├─> Check Completion Criteria
   │   ├─> Issue mode: Check if Issue is CLOSED
   │   ├─> Project mode: Check if all items are Done/Closed
   │   ├─> Iterate mode: Check if iteration count >= iterateMax
   │   └─> If complete: Exit loop
   │
   └─> Prepare Next Iteration
       ├─> Build continuation prompt
       └─> Repeat from step 3

4. Logging
   └─> All Main Claude messages → tmp/logs/agents/{agent-name}/session-{timestamp}.jsonl
   └─> Sub-agent logs → tmp/logs/climpt-agents/ (existing)
```

---

## 4. CLI Interface Design

### 4.1 Command Syntax

```bash
deno task iterate-agent run [OPTIONS]
```

### 4.2 Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--issue` | number | No | - | GitHub Issue 番号を指定。完了条件: Issue がクローズされたら終了 |
| `--project` | number | No | - | GitHub Project 番号を指定。完了条件: Project のすべてのタスク完了で終了 |
| `--iterate-max` | number | No | Infinity | Skill 呼び出し回数の上限。この回数に達したら終了 |
| `--agent-role` | string | No | `product-developer` | エージェントの役割。システムプロンプトとログ名に影響 |

### 4.3 Agent Roles

#### Predefined Roles

| Role | Description | System Prompt Focus |
|------|-------------|---------------------|
| `product-developer` | プロダクト開発者 (デフォルト) | 機能実装、バグ修正、コード品質 |
| `qa-engineer` | QA エンジニア | テスト作成、品質検証、バグ検出 |
| `architect` | アーキテクト | 設計レビュー、技術選定、リファクタリング |
| `devops-engineer` | DevOps エンジニア | CI/CD、デプロイ、インフラ管理 |
| `tech-writer` | テクニカルライター | ドキュメント作成、README 更新 |

### 4.4 Usage Examples

```bash
# Example 1: Issue ベースの開発 (Issue #123 完了まで)
deno task iterate-agent run --issue 123

# Example 2: Project ベースの開発 (Project #5 完了まで)
deno task iterate-agent run --project 5

# Example 3: QA エンジニアとして 10 イテレーション実行
deno task iterate-agent run --agent-role qa-engineer --iterate-max 10

# Example 4: アーキテクトとして Issue #456 に取り組む
deno task iterate-agent run --issue 456 --agent-role architect
```

---

## 5. System Prompt Design

### 5.1 Base System Prompt Template

すべてのロールで共通のベースプロンプト:

```markdown
# Role
You are an autonomous ${ROLE_NAME} working on continuous product development.

# Objective
${ROLE_OBJECTIVE}

# Working Mode
- You are running in a perpetual execution cycle
- Use the **delegate-climpt-agent** Skill to execute development tasks
- After each task completion, ask Climpt for the next logical task via the Skill
- Your goal is to make continuous progress on ${COMPLETION_CRITERIA}

# Task Execution Workflow
1. Receive current requirements/context
2. Invoke **delegate-climpt-agent** Skill with task description
3. Review the AI-generated summary from the sub-agent
4. Evaluate progress against completion criteria
5. If incomplete, ask Climpt (via Skill) what to do next
6. Repeat the cycle

# Completion Criteria
${COMPLETION_CRITERIA_DETAIL}

# Guidelines
- Be autonomous: Make decisions without waiting for human approval
- Be thorough: Ensure each task is properly completed before moving on
- Be organized: Maintain clear context of what has been done
- Be communicative: Provide clear status updates in your responses
${ROLE_SPECIFIC_GUIDELINES}
```

### 5.2 Role-Specific Prompts

<Note>
以下のプロンプトは **サンプル** です。実際のプロンプトは `iterate-agent/prompts/{role}.md` ファイルで定義され、プロジェクトの要件に応じて自由にカスタマイズできます。
</Note>

#### 5.2.1 Product Developer (Sample)

```markdown
## Role Objective
Implement features, fix bugs, and maintain code quality for the product.

## Role-Specific Guidelines
- Prioritize functionality and code maintainability
- Follow the project's coding standards and patterns
- Write clear commit messages
- Ensure changes don't break existing functionality
- Consider edge cases and error handling
```

#### 5.2.2 QA Engineer (Sample)

```markdown
## Role Objective
Ensure product quality through comprehensive testing and validation.

## Role-Specific Guidelines
- Create thorough test cases covering happy paths and edge cases
- Validate bug fixes with appropriate test coverage
- Review code changes from a quality perspective
- Document test results and findings
- Report issues clearly with reproduction steps
```

#### 5.2.3 Architect (Sample)

```markdown
## Role Objective
Maintain architectural integrity, design systems, and guide technical decisions.

## Role-Specific Guidelines
- Evaluate architectural implications of changes
- Ensure consistency with existing design patterns
- Identify opportunities for refactoring and improvement
- Document architectural decisions and rationale
- Consider scalability, maintainability, and performance
```

#### 5.2.4 DevOps Engineer (Sample)

```markdown
## Role Objective
Maintain deployment pipelines, infrastructure, and operational excellence.

## Role-Specific Guidelines
- Focus on automation, reliability, and monitoring
- Ensure CI/CD pipelines are robust and efficient
- Optimize build and deployment processes
- Implement infrastructure as code best practices
- Monitor for operational issues and improvements
```

#### 5.2.5 Tech Writer (Sample)

```markdown
## Role Objective
Create and maintain clear, comprehensive documentation for the project.

## Role-Specific Guidelines
- Ensure documentation is accurate and up-to-date
- Write for the target audience (developers, users, etc.)
- Include code examples where appropriate
- Maintain consistency in terminology and formatting
- Update docs when code changes impact user-facing behavior
```

---

## 6. Configuration Management

### 6.1 Configuration File Structure

Location: `iterate-agent/config.json` (プロジェクトルート直下)

```json
{
  "version": "1.0.0",
  "roles": {
    "product-developer": {
      "systemPromptTemplate": "iterate-agent/prompts/product-developer.md",
      "allowedTools": ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      "permissionMode": "acceptEdits"
    },
    "qa-engineer": {
      "systemPromptTemplate": "iterate-agent/prompts/qa-engineer.md",
      "allowedTools": ["Skill", "Read", "Write", "Bash", "Glob", "Grep"],
      "permissionMode": "acceptEdits"
    },
    "architect": {
      "systemPromptTemplate": "iterate-agent/prompts/architect.md",
      "allowedTools": ["Skill", "Read", "Glob", "Grep"],
      "permissionMode": "default"
    },
    "devops-engineer": {
      "systemPromptTemplate": "iterate-agent/prompts/devops-engineer.md",
      "allowedTools": ["Skill", "Read", "Write", "Bash", "Glob", "Grep"],
      "permissionMode": "acceptEdits"
    },
    "tech-writer": {
      "systemPromptTemplate": "iterate-agent/prompts/tech-writer.md",
      "allowedTools": ["Skill", "Read", "Write", "Edit", "Glob", "Grep"],
      "permissionMode": "acceptEdits"
    }
  },
  "github": {
    "tokenEnvVar": "GITHUB_TOKEN",
    "apiVersion": "2022-11-28"
  },
  "logging": {
    "directory": "tmp/logs/agents",
    "maxFiles": 100,
    "format": "jsonl"
  }
}
```

**Permission Mode 設定値**: `permissionMode` は Claude Agent SDK の値と同じものを指定可能です。有効な値:
- `"default"`: 標準の権限チェック
- `"plan"`: プランニングモード（読み取り専用ツールのみ）
- `"acceptEdits"`: ファイル編集を自動承認（自律エージェント推奨）
- `"bypassPermissions"`: すべての権限チェックをバイパス（注意して使用）

### 6.2 Registry Configuration Reuse

Iterate Agent は、既存のレジストリ設定 (`.agent/climpt/config/registry_config.json`) を共有:

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json"
  }
}
```

これにより、Climpt Skills と同じコマンドレジストリを使用可能。

---

## 7. Logging Specification

### 7.1 Log Format (JSONL)

各ログエントリは以下の JSON 構造:

```typescript
interface LogEntry {
  timestamp: string;           // ISO 8601 format
  level: "info" | "error" | "debug" | "assistant" | "user" | "system" | "result";
  message: string;
  metadata?: {
    role?: string;             // Agent role
    iterationCount?: number;   // Current iteration
    taskId?: string;           // Current task ID
    skillInvocation?: {        // Skill call details
      skillName: string;
      taskDescription: string;
      result: string;
    };
    completionCheck?: {        // Completion criteria check
      type: "issue" | "project" | "iterate";
      current: number;
      target: number;
      complete: boolean;
    };
    error?: {                  // Error details
      name: string;
      message: string;
      stack?: string;
    };
    [key: string]: unknown;    // Additional metadata
  };
}
```

### 7.2 Log File Naming

```
tmp/logs/agents/{agent-role}/session-{timestamp}.jsonl
```

Examples:
- `tmp/logs/agents/product-developer/session-2025-12-20T10-30-00-000Z.jsonl`
- `tmp/logs/agents/qa-engineer/session-2025-12-20T11-15-30-500Z.jsonl`

### 7.3 Log Rotation

- **Max files per role**: 100
- **Rotation strategy**: Delete oldest file when count exceeds 100
- **Sort criteria**: File modification time (mtime)

### 7.4 Log Levels

| Level | Usage |
|-------|-------|
| `info` | General execution flow (startup, iteration start/end, etc.) |
| `debug` | Detailed execution info (GitHub API calls, config loading, etc.) |
| `assistant` | Main Claude's assistant messages |
| `user` | Messages sent to Main Claude |
| `system` | SDK system messages (session init, errors, etc.) |
| `result` | Task completion results, iteration summaries |
| `error` | Errors and exceptions |

---

## 8. Iteration Flow

### 8.1 Main Loop Pseudocode

```typescript
async function autonomousAgentLoop(options: AgentOptions): Promise<void> {
  const { issue, project, iterateMax, agentName } = options;

  // 1. Initialize
  const logger = await initializeLogger(agentName);
  const config = await loadConfig();
  const agentConfig = await getAgentConfig(config, agentName);
  const systemPrompt = await buildSystemPrompt(agentConfig, { issue, project, iterateMax });

  let iterationCount = 0;
  let isComplete = false;

  // 2. Fetch initial requirements
  const initialRequirements = await fetchRequirements({ issue, project });
  let currentPrompt = buildInitialPrompt(initialRequirements);

  // 3. Main iteration loop: each iteration = one complete query() session
  while (!isComplete && iterationCount < iterateMax) {
    await logger.write("info", `Starting iteration ${iterationCount + 1}`);

    // 4. Start new SDK session for this iteration
    const queryIterator = query({
      prompt: currentPrompt,
      options: {
        cwd: Deno.cwd(),
        settingSources: ["project", "user"],
        allowedTools: agentConfig.allowedTools,
        permissionMode: agentConfig.permissionMode,
        systemPrompt: systemPrompt
      }
    });

    // 5. Process all SDK messages in this session
    for await (const message of queryIterator) {
      await handleSDKMessage(message, logger);

      // Log Skill invocations but don't count them as iterations
      if (isSkillInvocation(message)) {
        await logger.write("debug", "Skill invoked within iteration");
      }
    }

    // 6. Session completed = iteration completed
    iterationCount++;
    await logger.write("info", `Iteration ${iterationCount} completed`);

    // 7. Check completion criteria
    isComplete = await checkCompletionCriteria({
      issue,
      project,
      iterateMax,
      iterationCount
    });

    if (isComplete) {
      await logger.write("result", "Completion criteria met", {
        completionCheck: { type: getCompletionType(), complete: true }
      });
      break;
    }

    // 8. Check iteration limit
    if (iterationCount >= iterateMax) {
      await logger.write("info", "Maximum iterations reached");
      break;
    }

    // 9. Prepare prompt for next iteration
    currentPrompt = buildContinuationPrompt(options, iterationCount);
  }

  // 10. Cleanup
  await logger.write("info", "Iterate agent loop completed", {
    totalIterations: iterationCount,
    completionReason: isComplete ? "criteria_met" : "max_iterations"
  });
  await logger.close();
}
```

### 8.2 Iteration Count Logic

**Definition**: 1 iteration = 1 complete `query()` session from start to finish

**Key Points**:
- Each iteration starts a new `query()` session with a fresh prompt
- Multiple Skill invocations can occur within a single iteration
- Iteration count increments only when the entire session completes
- Next iteration begins with a continuation prompt

**Example**:
```
Iteration 1:
  - Start new query() session
  - Main Claude analyzes requirements
  - Main Claude invokes Skill multiple times (commit, test, etc.)
  - Session completes
  - Iteration count → 1

Iteration 2:
  - Start new query() session with continuation prompt
  - Main Claude continues work
  - Main Claude invokes Skill multiple times
  - Session completes
  - Iteration count → 2

...
```

---

## 9. GitHub Integration

<Note>
GitHub とのやり取りは `gh` CLI コマンドを使用します。`gh` は GitHub の公式 CLI ツールで、GITHUB_TOKEN 環境変数から自動的に認証情報を読み取ります。
</Note>

### 9.1 Requirements Fetching

#### 9.1.1 Issue-based

```typescript
async function fetchIssueRequirements(issueNumber: number): Promise<string> {
  // gh issue view コマンドで Issue 情報を JSON 形式で取得
  const command = new Deno.Command("gh", {
    args: [
      "issue",
      "view",
      issueNumber.toString(),
      "--json", "number,title,body,labels,state,comments"
    ],
    stdout: "piped",
    stderr: "piped"
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`gh issue view failed: ${errorText}`);
  }

  const issue = JSON.parse(new TextDecoder().decode(stdout));

  return `
# Issue #${issue.number}: ${issue.title}

## Description
${issue.body || "(No description)"}

## Labels
${issue.labels.map((l: any) => l.name).join(", ") || "(None)"}

## Current State
State: ${issue.state}
Comments: ${issue.comments?.length || 0}
  `.trim();
}
```

#### 9.1.2 Project-based

```typescript
async function fetchProjectRequirements(projectNumber: number): Promise<string> {
  // gh project view コマンドでプロジェクト情報を取得
  const command = new Deno.Command("gh", {
    args: [
      "project",
      "view",
      projectNumber.toString(),
      "--format", "json"
    ],
    stdout: "piped",
    stderr: "piped"
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`gh project view failed: ${errorText}`);
  }

  const project = JSON.parse(new TextDecoder().decode(stdout));

  // プロジェクトのアイテムをフォーマット
  const items = project.items || [];
  const itemsList = items.map((item: any) =>
    `- [${item.status || "No status"}] #${item.content?.number || "N/A"}: ${item.content?.title || "Untitled"}`
  ).join("\n");

  return `
# Project #${projectNumber}: ${project.title || "Untitled"}

## Description
${project.description || "(No description)"}

## Items
${itemsList || "(No items)"}

## Status
Total items: ${items.length}
  `.trim();
}
```

### 9.2 Completion Checking

#### 9.2.1 Issue Completion

```typescript
async function isIssueComplete(issueNumber: number): Promise<boolean> {
  const command = new Deno.Command("gh", {
    args: [
      "issue",
      "view",
      issueNumber.toString(),
      "--json", "state"
    ],
    stdout: "piped",
    stderr: "piped"
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`gh issue view failed: ${errorText}`);
  }

  const issue = JSON.parse(new TextDecoder().decode(stdout));
  return issue.state === "CLOSED";
}
```

#### 9.2.2 Project Completion

```typescript
async function isProjectComplete(projectNumber: number): Promise<boolean> {
  const command = new Deno.Command("gh", {
    args: [
      "project",
      "view",
      projectNumber.toString(),
      "--format", "json"
    ],
    stdout: "piped",
    stderr: "piped"
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`gh project view failed: ${errorText}`);
  }

  const project = JSON.parse(new TextDecoder().decode(stdout));
  const items = project.items || [];

  // すべてのアイテムが完了（クローズ）しているかチェック
  return items.every((item: any) =>
    item.content?.state === "CLOSED" || item.status === "Done"
  );
}
```

---

## 10. Error Handling

### 10.1 Error Categories

| Category | Examples | Handling Strategy |
|----------|----------|-------------------|
| SDK Errors | Network timeout, API rate limit | Retry with exponential backoff |
| Skill Errors | Sub-agent failure, invalid response | Log error, ask Main Claude for alternative approach |
| GitHub API Errors | 404, 401, rate limit | Log error, exit gracefully with error message |
| Configuration Errors | Missing role config, invalid JSON | Exit immediately with clear error message |

### 10.2 Retry Logic

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, attempt);
      await logger.write("debug", `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}
```

---

## 11. File Structure

```
iterate-agent/                           # プロジェクトルート直下に配置
├── config.json                          # Main configuration
├── prompts/
│   ├── product-developer.md             # Role-specific system prompt (カスタマイズ可能)
│   ├── qa-engineer.md
│   ├── architect.md
│   ├── devops-engineer.md
│   └── tech-writer.md
├── scripts/
│   ├── agent.ts                         # Main entry point
│   ├── cli.ts                           # CLI argument parsing
│   ├── config.ts                        # Configuration loader
│   ├── github.ts                        # GitHub API integration (gh CLI 使用)
│   ├── logger.ts                        # JSONL logger
│   ├── prompts.ts                       # System prompt builder
│   └── types.ts                         # TypeScript type definitions
└── README.md                            # Usage documentation

tmp/logs/iterate-agent/
├── product-developer/
│   ├── session-2025-12-20T10-00-00-000Z.jsonl
│   └── session-2025-12-20T11-00-00-000Z.jsonl
└── qa-engineer/
    └── session-2025-12-20T12-00-00-000Z.jsonl
```

---

## 12. Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
- [ ] CLI argument parsing (cli.ts)
- [ ] Configuration management (config.ts)
- [ ] JSONL logger with rotation (logger.ts)
- [ ] Basic agent.ts skeleton

### Phase 2: SDK Integration (Week 1-2)
- [ ] SDK session management
- [ ] System prompt generation
- [ ] Iteration tracking
- [ ] Message handling

### Phase 3: GitHub Integration (Week 2)
- [ ] Issue fetching
- [ ] Project fetching
- [ ] Completion criteria checking
- [ ] API error handling

### Phase 4: Role System (Week 2-3)
- [ ] Role configuration loading
- [ ] System prompt templates
- [ ] Role-specific prompts for all 5 roles
- [ ] Role validation

### Phase 5: Testing & Documentation (Week 3)
- [ ] Unit tests for core modules
- [ ] Integration tests
- [ ] User documentation
- [ ] Example workflows

---

## 13. Testing Strategy

### 13.1 Unit Tests

| Module | Test Cases |
|--------|------------|
| `cli.ts` | Argument parsing, validation, defaults |
| `config.ts` | Config loading, role lookup, template resolution |
| `logger.ts` | Log writing, JSONL format, rotation |
| `prompts.ts` | Prompt building, variable substitution |
| `github.ts` | Issue fetching (mocked), project fetching (mocked) |

### 13.2 Integration Tests

1. **End-to-End Test with Issue**:
   - Mock GitHub API responses
   - Start agent with `--issue 123 --iterate-max 2`
   - Verify 2 skill invocations occur
   - Verify completion criteria is checked
   - Verify logs are written

2. **Role Switching Test**:
   - Run agent with each role
   - Verify correct system prompt is loaded
   - Verify allowed tools match configuration

3. **Error Recovery Test**:
   - Simulate GitHub API failure
   - Verify retry logic
   - Verify graceful error handling

---

## 14. Security Considerations

### 14.1 GitHub Token Management
- **Requirement**: GITHUB_TOKEN 環境変数から取得
- **Validation**: 起動時にトークンの存在を確認
- **Scope**: `repo`, `project` スコープが必要

### 14.2 Permission Mode
- **Default**: `acceptEdits` (file edits auto-approved)
- **Risk**: 自律エージェントは人間の承認なしでファイルを変更可能
- **Mitigation**: 重要な操作（git push, npm publish など）は Climpt Skills で明示的に制御

### 14.3 Tool Restrictions by Role
- **Architect**: Read-only tools (no Write, Edit)
- **Others**: Full access with `acceptEdits` mode

---

## 15. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Iteration Success Rate | > 90% | (Successful iterations / Total iterations) × 100 |
| Mean Time to Task Completion | < 5 minutes | Average time from skill invocation to completion |
| Error Recovery Rate | > 95% | (Recovered errors / Total errors) × 100 |
| Log Completeness | 100% | All iterations logged without data loss |

---

## 16. Future Enhancements

1. **Multi-agent Collaboration**: 複数のロールを同時実行し、協調作業を実現
2. **Learning from History**: 過去のログを分析して、効率的なタスク実行パターンを学習
3. **Human-in-the-Loop**: 重要な決定ポイントで人間の承認を求めるモード
4. **Dashboard**: Web UI でエージェントの実行状態をリアルタイム監視
5. **Cost Tracking**: API コストの追跡と予算管理

---

## 17. References

### 17.1 Internal Documentation
- [Claude Agent SDK Overview](../docs/reference/claude-agent-sdk-overview.md)
- [Subagents in the SDK](../docs/reference/sdk/subagents.md)
- [Agent Skills in the SDK](../docs/reference/sdk/skills.md)
- [Streaming vs Single Mode](../docs/reference/sdk/streaming-vs-single-mode.md)
- [Handling Permissions](../docs/reference/sdk/permissions.md)

### 17.2 External Resources
- [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [GitHub CLI (`gh`) Documentation](https://cli.github.com/manual/)
- [GitHub CLI (`gh`) API Reference](https://cli.github.com/manual/gh)

---

## Appendix A: Initial Prompt Templates

### A.1 Issue-based Initial Prompt

```markdown
You are starting work on GitHub Issue #${ISSUE_NUMBER}.

## Issue Details
${ISSUE_CONTENT}

## Your Mission
1. Use the **delegate-climpt-agent** Skill to implement the required changes
2. After each task, evaluate progress toward closing this issue
3. Continue until the issue requirements are fully satisfied
4. The issue will be checked periodically; when it's closed, you're done

Start by analyzing the issue requirements and planning your first task.
```

### A.2 Project-based Initial Prompt

```markdown
You are working on GitHub Project #${PROJECT_NUMBER}.

## Project Overview
${PROJECT_CONTENT}

## Your Mission
1. Use the **delegate-climpt-agent** Skill to work through project tasks
2. Focus on making continuous progress across all project items
3. After each task, ask Climpt what to do next
4. Continue until all project items are complete

Start by reviewing the project board and selecting the first task to tackle.
```

### A.3 Iterate-only Initial Prompt

```markdown
You are running in autonomous development mode for ${ITERATE_MAX} iterations.

## Your Mission
1. Use the **delegate-climpt-agent** Skill to execute development tasks
2. After each task, ask Climpt for the next logical task via the Skill
3. Focus on ${ROLE_OBJECTIVE}
4. Make continuous progress on improving the codebase

You have ${ITERATE_MAX} iterations to make meaningful contributions.
Start by assessing the current state of the project and identifying high-value tasks.
```

### A.4 Continuation Prompt (Issue-based)

```markdown
You have completed ${N} iteration(s) working on GitHub Issue #${ISSUE_NUMBER}.

## Next Steps
1. Continue working toward closing Issue #${ISSUE_NUMBER}
2. Use the **delegate-climpt-agent** Skill to implement the next required task
3. When complete, the issue will be checked; if closed, you're done

Continue making progress on the issue requirements.
```

### A.5 Continuation Prompt (Project-based)

```markdown
You have completed ${N} iteration(s) working on GitHub Project #${PROJECT_NUMBER}.

## Next Steps
1. Continue working on completing Project #${PROJECT_NUMBER}
2. Use the **delegate-climpt-agent** Skill to tackle the next project task
3. When complete, the project status will be checked; if all items are done, you're done

Continue making progress across project items.
```

### A.6 Continuation Prompt (Iterate-only)

```markdown
You have completed ${N} iteration(s). You have ${REMAINING} iteration(s) remaining.

## Next Steps
1. Use the **delegate-climpt-agent** Skill to execute the next development task
2. Continue making meaningful contributions to the codebase

Assess the current state and identify the next high-value task to tackle.
```

---

## Appendix B: Example Session Log

```jsonl
{"timestamp":"2025-12-20T10:00:00.000Z","level":"info","message":"Iterate agent started","metadata":{"role":"product-developer","issue":123,"iterateMax":10}}
{"timestamp":"2025-12-20T10:00:01.234Z","level":"debug","message":"Fetching GitHub issue #123"}
{"timestamp":"2025-12-20T10:00:02.456Z","level":"info","message":"Issue fetched: Fix login bug","metadata":{"issueTitle":"Fix login bug","issueState":"open"}}
{"timestamp":"2025-12-20T10:00:03.789Z","level":"info","message":"Starting iteration 1"}
{"timestamp":"2025-12-20T10:00:05.123Z","level":"user","message":"Analyze the login bug described in issue #123 and fix it"}
{"timestamp":"2025-12-20T10:00:10.456Z","level":"assistant","message":"I'll investigate the login bug. Let me use the delegate-climpt-agent skill to examine the authentication code..."}
{"timestamp":"2025-12-20T10:02:30.789Z","level":"info","message":"Skill invoked: delegate-climpt-agent","metadata":{"skillInvocation":{"skillName":"delegate-climpt-agent","taskDescription":"investigate and fix login authentication bug"}}}
{"timestamp":"2025-12-20T10:02:30.790Z","level":"info","message":"Iteration count: 1"}
{"timestamp":"2025-12-20T10:03:45.123Z","level":"assistant","message":"## Summary\n### Accomplished\nFixed login bug by correcting session validation logic...\n### Next Steps\nTest the fix with various user scenarios"}
{"timestamp":"2025-12-20T10:03:46.456Z","level":"info","message":"Checking completion criteria","metadata":{"completionCheck":{"type":"issue","current":1,"target":123,"complete":false}}}
{"timestamp":"2025-12-20T10:03:47.789Z","level":"info","message":"Starting iteration 2"}
...
```

---

**Document Status**: Ready for Implementation Review
**Next Steps**: Review with stakeholders, refine based on feedback, begin Phase 1 implementation
