# Stale Item Check

Identify issues with no recent activity in GitHub Project #{{project_number}}.

## Parameters

- Stale threshold: {{stale_threshold_days}} days

## Tasks

1. **Find Stale Issues**
   - Issues with no updates beyond threshold
   - Issues with no comments or activity
   - Abandoned pull requests or branches

2. **Analyze Staleness**
   - Why might this issue be stale?
   - Is it blocked waiting for something?
   - Is it deprioritized?
   - Was it forgotten?

3. **Recommend Actions**
   - Should it be closed?
   - Does it need reassignment?
   - Should priority be adjusted?
   - Does it need clarification?

## Output

For each stale issue:

```facilitate-action
{"action":"stale","issue":ISSUE_NUMBER,"body":"No activity for N days. Analysis: ...","label":"stale"}
```

Include recommendation for each:

- Close (no longer relevant)
- Reprioritize (still needed but deprioritized)
- Clarify (needs more information)
- Assign (needs owner)
