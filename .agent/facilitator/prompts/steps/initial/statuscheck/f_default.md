# Project Status Check

Check the current status of GitHub Project #{{project_number}}.

## Project Information

- Title: {{project_title}} {{#if label_info}}- Label Filter:
  {{label_info}}{{/if}}

## Observation Context

Record the observation time for delta detection:

1. **Current observation time**: Now (ISO-8601 format)
2. **Previous observation time**: {{#if previous_observation}}{{previous_observation}}{{else}}Unknown (use 7 days ago as default){{/if}}

## Tasks

1. **Establish Time Reference**
   - Record current observation timestamp
   - Determine baseline for delta detection (previous observation or 7 days)

2. **Gather Project Metrics**
   - Total issues count
   - Issues by status (Open, In Progress, Done)
   - Issues by priority/label
   - Recent activity summary

3. **Detect Changes Since Last Observation**
   - New commits since previous observation (`git log --since`)
   - Issues with activity since previous observation
   - New or closed issues

4. **Identify Health Indicators**
   - Issues with no recent updates (potential stale items)
   - Issues marked as blocked
   - Issues with unresolved dependencies
   - Items lacking clear next actions

5. **Generate Status Summary**
   - Overall project health assessment
   - Key metrics and trends
   - **Changes since last observation**
   - Items needing attention

## Output

Provide a status summary with observation context:

```status-report
{
  "type": "check",
  "project": {{project_number}},
  "observation": {
    "current": "ISO-8601-timestamp",
    "previous": "ISO-8601-timestamp-or-null",
    "deltaHours": NUMBER
  },
  "delta": {
    "newCommits": ["sha1", "sha2"],
    "changedIssues": [ISSUE_NUMBERS],
    "summary": "前回観測以降の変化の要約"
  },
  "summary": "Overall status summary",
  "metrics": {
    "open": N,
    "in_progress": N,
    "done": N,
    "blocked": N
  }
}
```

If any issues need immediate attention, use:

```facilitate-action
{"action":"attention","issue":ISSUE_NUMBER,"body":"Reason for attention needed"}
```
