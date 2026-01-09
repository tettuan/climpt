# Status Check Continuation

Continue monitoring GitHub project status.

## Context

- Completed iterations: {{completed_iterations}}
- Previous status: {{previous_status}}

## Tasks

1. **Compare with Previous Status**
   - What has changed since last check?
   - Are metrics trending positively or negatively?
   - Any new blockers or resolved items?

2. **Identify New Concerns**
   - Issues that became stale
   - New blockers introduced
   - Items needing re-prioritization

3. **Update Recommendations**
   - Adjust suggestions based on progress
   - Flag persistent issues
   - Acknowledge resolved items

## Output

Provide updated status:

```status-report
{"type":"continuation","project":PROJECT_NUMBER,"summary":"Changes since last check...","metrics":{"open":N,"in_progress":N,"done":N,"blocked":N},"changes":["..."]}
```

For any new attention items:

```facilitate-action
{"action":"attention","issue":ISSUE_NUMBER,"body":"Newly identified concern"}
```
