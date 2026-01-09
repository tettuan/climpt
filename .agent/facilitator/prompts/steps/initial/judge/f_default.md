# Issue State Judgment

Judge the state of each issue in Project #{{project_number}}.

## Purpose

Determine the current state of each issue based on evidence.

## Input

Use information gathered from:
- Agent work logs (`tmp/logs/agents/`)
- Git commits (`git log`)
- Issue status and comments (`gh issue view`)
- PR status (`gh pr list`)

## State Definitions

| State | Identifier | Criteria |
|-------|------------|----------|
| **Done** | `done` | Has commit AND (merged OR review approved) |
| **Review Pending** | `review_pending` | Has commit AND PR created AND not merged |
| **In Progress** | `in_progress` | Has work log AND not completed |
| **Incomplete** | `incomplete` | No commit AND no blocker |
| **Blocked** | `blocked` | Depends on non-done issue OR external blocker |
| **Unknown** | `unknown` | Cannot determine from available evidence |

## Judgment Flow

```
For each Issue:
  1. Check for commits → Yes → Check for PR
     └→ No → Check for work logs

  2. If PR exists → Check merge status
     ├→ Merged → state = done
     └→ Not merged → state = review_pending

  3. If work logs exist → state = in_progress

  4. If no activity → Check for blockers
     ├→ Has blockers → state = blocked
     └→ No blockers → state = incomplete

  5. If none match → state = unknown
```

## Tasks

1. **For each issue**, determine:
   - Current state (one of the 6 states)
   - Evidence supporting the judgment
   - Required capability for resolution (if applicable)

2. **Document findings** with specific evidence

## Output

Output each issue assessment:

```issue-assessment
{
  "issue": {{issue_number}},
  "state": "done|review_pending|in_progress|incomplete|blocked|unknown",
  "evidence": ["evidence-1", "evidence-2"],
  "recommendation": "What should happen next",
  "requiredCapability": "capability-name-if-applicable"
}
```

## State to Capability Mapping

| State | Required Capability |
|-------|---------------------|
| `review_pending` | `review-action` |
| `in_progress` | `issue-action` |
| `incomplete` | `issue-action` |
| `blocked` | Depends on blocker type |
| `unknown` | None (facilitator continues) |
| `done` | None |
