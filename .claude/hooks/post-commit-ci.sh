#!/bin/bash
# PostToolUse hook: Run CI after git commit and feed results to Claude

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // ""')

# Only run CI if this was a git commit command
if [[ $command =~ git\ commit ]]; then
  cd "$CLAUDE_PROJECT_DIR"

  # Run CI and capture output
  result=$(deno task ci 2>&1)
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    # CI passed - exit normally
    echo "✓ CI PASSED" >&2
    exit 0
  else
    # CI failed - exit 2 to feed stderr to Claude
    echo "✗ CI FAILED" >&2
    echo "" >&2
    echo "$result" >&2
    exit 2
  fi
fi

exit 0
