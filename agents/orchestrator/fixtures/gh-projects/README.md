# GH Projects v2 Fixtures

Canned stdout captured from real GitHub Projects v2 CLI responses. Used by
`github-client-project_test.ts` to test `GhCliClient` project methods without
network access.

## Files

| File                               | gh command                          | Used by                                                  |
| ---------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `project-item-add.json`            | `gh project item-add`               | `addIssueToProject`                                      |
| `project-item-list.json`           | `gh project item-list`              | `listProjectItems`, `getProjectItemIdForIssue`           |
| `project-item-list-empty.json`     | `gh project item-list` (empty)      | `listProjectItems` (empty case)                          |
| `project-list.json`                | `gh project list`                   | `listUserProjects`                                       |
| `project-view.json`                | `gh project view`                   | `getProject`, `createProjectFieldOption` (resolveNodeId) |
| `project-field-list.json`          | `gh project field-list`             | `getProjectFields`                                       |
| `issue-view-projects.jsonl`        | `gh issue view --json projectItems` | `getIssueProjects`                                       |
| `graphql-create-field-option.json` | `gh api graphql` (mutation)         | `createProjectFieldOption`                               |

## Node ID conventions

- Project IDs: `PVT_` prefix (e.g. `PVT_kwDOABC123`)
- Project item IDs: `PVTI_` prefix (e.g. `PVTI_lADOABC123DEF456`)
- Field IDs: `PVTF_` prefix
- Field option IDs: `PVTSSFO_` prefix
