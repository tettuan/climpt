# 08: Meta Commands

**What:** Tests meta domain commands (name, build, create). **Why:** Meta
commands generate prompt scaffolding; broken output breaks the authoring
workflow.

## Verifies

- `name c3l-command` output contains a naming pattern (kebab-case or snake_case)
- `build frontmatter` output contains YAML delimiter `---`
- `create instruction` output contains content markers (#, instruction, or
  schema)
