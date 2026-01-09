# Project Status Check

Check the current status of GitHub Project #{{project_number}}.

## Project Information

- Title: {{project_title}} {{#if label_info}}- Label Filter:
  {{label_info}}{{/if}}

## Tasks

1. **Gather Project Metrics**
   - Total issues count
   - Issues by status (Open, In Progress, Done)
   - Issues by priority/label
   - Recent activity summary

2. **Identify Health Indicators**
   - Issues with no recent updates (potential stale items)
   - Issues marked as blocked
   - Issues with unresolved dependencies
   - Items lacking clear next actions

3. **Generate Status Summary**
   - Overall project health assessment
   - Key metrics and trends
   - Items needing attention

## Output

Provide a status summary using:

```status-report
{"type":"check","project":{{project_number}},"summary":"...","metrics":{"open":N,"in_progress":N,"done":N,"blocked":N}}
```

If any issues need immediate attention, use:

```facilitate-action
{"action":"attention","issue":ISSUE_NUMBER,"body":"Reason for attention needed"}
```
