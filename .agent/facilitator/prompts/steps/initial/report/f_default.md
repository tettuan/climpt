# Generate Status Report

Create a {{report_type}} status report for GitHub Project #{{project_number}}.

## Project Information

- Title: {{project_title}}

## Report Sections

1. **Executive Summary**
   - Overall project health (Green/Yellow/Red)
   - Key accomplishments since last report
   - Main concerns or risks

2. **Metrics Dashboard**
   - Issue counts by status
   - Velocity (issues closed per period)
   - Blocked items count
   - Stale items count

3. **Progress Highlights**
   - Recently completed items
   - Items actively being worked on
   - Upcoming milestones

4. **Attention Items**
   - Blocked issues requiring action
   - Stale issues needing review
   - Dependencies at risk

5. **Recommendations**
   - Suggested priorities
   - Process improvements
   - Resource considerations

## Output

```status-report
{
  "type": "{{report_type}}",
  "project": {{project_number}},
  "summary": "Executive summary here",
  "metrics": {
    "open": N,
    "in_progress": N,
    "done": N,
    "blocked": N,
    "stale": N
  },
  "health": "green|yellow|red",
  "highlights": ["..."],
  "concerns": ["..."]
}
```
