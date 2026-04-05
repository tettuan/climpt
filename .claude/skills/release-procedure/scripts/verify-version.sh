#!/usr/bin/env bash
set -euo pipefail

# バージョン一致チェック & push 済みチェック
# Task 2 post-condition および Task 5 gate で共用する。
#
# Usage:
#   verify-version.sh              # バージョン一致のみ
#   verify-version.sh --with-push  # バージョン一致 + push 済み

BRANCH=$(git branch --show-current)
VER=${BRANCH#release/}

# deno.json バージョン一致
grep -q "\"version\": \"$VER\"" deno.json || { echo "ABORT: deno.json version mismatch (expected $VER)"; exit 1; }

# src/version.ts バージョン一致
grep -q "$VER" src/version.ts || { echo "ABORT: src/version.ts version mismatch (expected $VER)"; exit 1; }

echo "Version check passed: $VER"

# --with-push: 全コミットが push 済みであること
if [[ "${1:-}" == "--with-push" ]]; then
  UNPUSHED=$(git log "origin/$BRANCH..$BRANCH" --oneline 2>/dev/null)
  test -z "$UNPUSHED" || { echo "ABORT: unpushed commits: $UNPUSHED"; exit 1; }
  echo "Push check passed: all commits pushed"
fi
