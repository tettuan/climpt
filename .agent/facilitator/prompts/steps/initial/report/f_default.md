# Generate Recommendation Report

Generate a recommendation report for Project #{{project_number}}.

## Project Information

- Title: {{project_title}}
- Report Type: {{report_type}}

## Purpose

Based on the issue assessments and agent registry, recommend the next agent to invoke with scored suggestions.

## Input

Use the following information gathered in previous steps:

1. **Agent Registry** - Available agents and their capabilities
2. **Issue Assessments** - State of each issue with required capabilities
3. **Work Logs** - Recent agent activity

## Tasks

1. **Match Issues to Capabilities**
   - For each issue with state other than `done`
   - Identify the required capability
   - Find agents with matching capabilities

2. **Score Each Recommendation**

   | Factor | Weight | Criteria |
   |--------|--------|----------|
   | State urgency | 0.4 | blocked > in_progress > incomplete |
   | Capability match | 0.3 | Exact match vs partial |
   | Issue priority | 0.2 | High > medium > low |
   | Recent activity | 0.1 | Recent work on same issue |

3. **Determine Priority**

   | Priority | Criteria |
   |----------|----------|
   | `high` | Blocker resolution, deadline, dependency chain |
   | `medium` | Normal incomplete/in_progress work |
   | `low` | Improvements, refactoring |

4. **Generate Suggestions**
   - Create multiple suggestions (2-4)
   - Order by score descending
   - Include concrete command for each

## Output

Output the recommendation:

```recommend-action
{
  "nextAgent": "{{recommended_agent}}",
  "targetIssues": [ISSUE_NUMBERS],
  "reason": "Why this agent for these issues",
  "availableAgents": ["agent1", "agent2"],
  "suggestions": [
    {
      "agent": "agent-name",
      "command": "deno task agents:run {agent} --issue {N}",
      "description": "What this will accomplish",
      "priority": "high|medium|low",
      "score": 0.0-1.0,
      "rationale": "Why this score and priority"
    }
  ]
}
```

## Example Output

```recommend-action
{
  "nextAgent": "iterator",
  "targetIssues": [123, 125],
  "reason": "#123 is in_progress, #125 is incomplete. iterator has issue-action capability.",
  "availableAgents": ["iterator", "reviewer"],
  "suggestions": [
    {
      "agent": "iterator",
      "command": "deno task agents:run iterator --issue 123",
      "description": "Continue implementation of Issue #123",
      "priority": "high",
      "score": 0.9,
      "rationale": "In-progress work should be completed first. Exact capability match."
    },
    {
      "agent": "iterator",
      "command": "deno task agents:run iterator --issue 125",
      "description": "Start implementation of Issue #125",
      "priority": "medium",
      "score": 0.6,
      "rationale": "Incomplete but no blockers. Better to finish #123 first."
    },
    {
      "agent": "reviewer",
      "command": "deno task agents:run reviewer --project {{project_number}}",
      "description": "Review completed work if any PRs pending",
      "priority": "low",
      "score": 0.3,
      "rationale": "No review_pending issues currently."
    }
  ]
}
```

## If No Action Needed

If all issues are `done`:

```recommend-action
{
  "nextAgent": "none",
  "targetIssues": [],
  "reason": "All issues are complete. No agent action needed.",
  "availableAgents": ["iterator", "reviewer"],
  "suggestions": []
}
```
