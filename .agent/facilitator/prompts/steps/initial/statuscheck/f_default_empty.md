# Project Status Check - No Issues Found

Check GitHub Project #{{project_number}} which currently has no issues matching
the filter criteria.

## Project Information

- Title: {{project_title}} {{#if label_info}}- Label Filter:
  {{label_info}}{{/if}}

## Tasks

1. **Verify Project Configuration**
   - Confirm project exists and is accessible
   - Check if label filter is too restrictive
   - Verify project permissions

2. **Assess Situation**
   - Is this a new project with no issues yet?
   - Have all issues been completed?
   - Is the filter excluding all items?

3. **Recommend Actions**
   - Suggest next steps for project setup
   - Identify if issues need to be created
   - Recommend label adjustments if needed

## Output

```status-report
{"type":"empty","project":{{project_number}},"summary":"No issues found matching criteria","metrics":{"open":0,"in_progress":0,"done":0,"blocked":0}}
```
