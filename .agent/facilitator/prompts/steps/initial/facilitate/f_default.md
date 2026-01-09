# Facilitation Action

Execute facilitation action for Issue #{{issue_number}} in Project
#{{project_number}}.

## Action Type: {{action_type}}

## Tasks

### For Status Updates

1. Review current issue state
2. Check recent activity
3. Verify accuracy of current labels
4. Update status if needed

### For Blocker Resolution

1. Identify the specific blocker
2. Determine if it can be resolved
3. Connect relevant parties if needed
4. Document resolution path

### For Priority Suggestions

1. Analyze issue importance
2. Consider dependencies
3. Evaluate effort vs. impact
4. Provide reasoning for suggestion

### For Attention Flags

1. Document why attention is needed
2. Specify what action is required
3. Identify who should take action
4. Set appropriate labels

## Output

Use appropriate action block:

```facilitate-action
{"action":"{{action_type}}","issue":{{issue_number}},"body":"Detailed description of action taken"}
```
