# Blocker Check

Identify and analyze blockers in GitHub Project #{{project_number}}.

## Known Blocked Issues

{{blocked_issues}}

## Tasks

1. **Analyze Each Blocker**
   - What is blocking progress?
   - Is it a dependency, resource, or decision blocker?
   - How long has it been blocked?

2. **Identify Dependencies**
   - Which issues depend on blocked items?
   - What is the cascade effect?
   - Are there circular dependencies?

3. **Recommend Resolutions**
   - Can the blocker be unblocked without external input?
   - Who needs to be consulted?
   - What information is missing?

## Output

For each blocker identified:

```facilitate-action
{"action":"blocker","issue":ISSUE_NUMBER,"body":"Analysis and recommendation","depends_on":[DEPENDENT_ISSUE_NUMBERS]}
```

If a blocker needs external clearance:

```facilitate-action
{"action":"attention","issue":ISSUE_NUMBER,"body":"Needs decision from stakeholder","label":"need clearance"}
```
