# Issue State Judgment

Judge the state of each issue in Project #{{project_number}}.

## Purpose

Determine the current state of each issue based on evidence, **evaluate freshness**, and **detect state changes**.

## Input

Use information gathered from:
- Agent work logs (`tmp/logs/agents/`)
- Git commits (`git log`)
- Issue status and comments (`gh issue view`)
- PR status (`gh pr list`)
- **Observation context** (current and previous observation times)
- **Delta information** (changes since last observation)

## State Definitions

| State | Identifier | Criteria |
|-------|------------|----------|
| **Done** | `done` | Has commit AND (merged OR review approved) |
| **Review Pending** | `review_pending` | Has commit AND PR created AND not merged |
| **In Progress** | `in_progress` | Has work log AND not completed |
| **Incomplete** | `incomplete` | No commit AND no blocker |
| **Blocked** | `blocked` | Depends on non-done issue OR external blocker |
| **Unknown** | `unknown` | Cannot determine from available evidence |

## Freshness Classification

Evaluate how recent the activity is to determine judgment confidence:

| Freshness | Condition | Confidence | Meaning |
|-----------|-----------|------------|---------|
| `active` | Activity within 24 hours | high | State judgment is highly reliable |
| `recent` | Activity within 7 days | medium | State is likely correct but may have changed |
| `stale` | No activity for 7+ days | low | State may not reflect reality |

## Judgment Flow

```
For each Issue:
  1. Check for changes since last observation
     ├→ Yes → freshness = active or recent, confidence = high/medium
     └→ No → freshness = stale, confidence = low

  2. Check for commits → Yes → Check for PR
     └→ No → Check for work logs

  3. If PR exists → Check merge status
     ├→ Merged → state = done
     └→ Not merged → state = review_pending

  4. If work logs exist → Check if recent
     ├→ Recent logs → state = in_progress
     └→ Old logs only → state = in_progress (stale)

  5. If no activity → Check for blockers
     ├→ Has blockers → state = blocked
     └→ No blockers → state = incomplete

  6. If none match → state = unknown

  7. Compare with previous state (if known)
     ├→ Changed → stateChange.changed = true
     └→ Same → stateChange.changed = false
```

## Tasks

1. **For each issue**, determine:
   - Current state (one of the 6 states)
   - Evidence supporting the judgment
   - **Freshness** (active/recent/stale based on last activity)
   - **State change** (compared to previous observation if known)
   - **Confidence** (high/medium/low based on freshness)
   - Required capability for resolution (if applicable)

2. **Document findings** with specific evidence and timestamps

## Output

Output each issue assessment with freshness and state change:

```issue-assessment
{
  "issue": {{issue_number}},
  "state": "done|review_pending|in_progress|incomplete|blocked|unknown",
  "evidence": ["evidence-1", "evidence-2"],
  "freshness": {
    "lastActivity": "ISO-8601-timestamp",
    "hoursSinceActivity": NUMBER,
    "classification": "active|recent|stale"
  },
  "stateChange": {
    "changed": true|false,
    "previousState": "previous-state-or-null",
    "reason": "Why state changed or remained same"
  },
  "confidence": "high|medium|low",
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

## Example Output

```issue-assessment
{
  "issue": 204,
  "state": "in_progress",
  "evidence": ["commit 86cfbd8 (2026-01-09)", "work log session-abc"],
  "freshness": {
    "lastActivity": "2026-01-09T23:18:44Z",
    "hoursSinceActivity": 2,
    "classification": "active"
  },
  "stateChange": {
    "changed": false,
    "previousState": "in_progress",
    "reason": "New commits added, work continues"
  },
  "confidence": "high",
  "recommendation": "Continue implementation with iterator agent",
  "requiredCapability": "issue-action"
}
```
