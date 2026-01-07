#!/bin/bash
# Stop hook: Run local CI checks (no network required)

cd "$CLAUDE_PROJECT_DIR"

errors=""

# 1. Format check
if ! deno fmt --check 2>&1 | grep -q "^Checked"; then
  fmt_result=$(deno fmt --check 2>&1)
  if [ $? -ne 0 ]; then
    errors="${errors}[fmt] ${fmt_result}\n"
  fi
fi

# 2. Lint check
lint_result=$(deno lint 2>&1)
if [ $? -ne 0 ]; then
  errors="${errors}[lint] ${lint_result}\n"
fi

# 3. Type check
check_result=$(deno check src/**/*.ts 2>&1)
if [ $? -ne 0 ]; then
  errors="${errors}[check] ${check_result}\n"
fi

# 4. Test
test_result=$(deno test --allow-read --allow-write --allow-env 2>&1)
if [ $? -ne 0 ]; then
  errors="${errors}[test] ${test_result}\n"
fi

if [ -z "$errors" ]; then
  echo '{}'
else
  # Escape for JSON
  escaped=$(echo -e "$errors" | head -c 500 | sed 's/"/\\"/g' | tr '\n' ' ')
  echo "{\"decision\": \"block\", \"reason\": \"CI failed: ${escaped}\"}"
fi

exit 0
