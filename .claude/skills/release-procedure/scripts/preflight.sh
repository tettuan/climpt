#!/usr/bin/env bash
set -euo pipefail

# Gate 0: Pre-flight チェック
# release/* ブランチ上で、clean な状態かつ develop 同期済み、前 vtag 存在を検証する。

git fetch origin

# Gate 1: release/* ブランチにいること
git branch --show-current | grep -q '^release/' || { echo "ABORT: not on release/* branch"; exit 1; }

# Gate 2: 未コミット変更がないこと
test -z "$(git status --short)" || { echo "ABORT: uncommitted changes exist"; exit 1; }

# Gate 3: ローカル develop が origin/develop と一致
test "$(git rev-parse develop 2>/dev/null)" = "$(git rev-parse origin/develop)" || { echo "ABORT: local develop diverged from origin/develop"; exit 1; }

# Gate 4: 前リリースの vtag がリモートに存在（リリース漏れ検知）
BRANCH=$(git branch --show-current)
VER=${BRANCH#release/}
PATCH=$(echo "$VER" | cut -d. -f3)
if [ "$PATCH" -gt 0 ]; then
  PREV_TAG="v$(echo "$VER" | cut -d. -f1).$(echo "$VER" | cut -d. -f2).$((PATCH - 1))"
  git ls-remote --tags origin "refs/tags/$PREV_TAG" | grep -q . || { echo "ABORT: $PREV_TAG not found on remote"; exit 1; }
fi

echo "Pre-flight: all gates passed"
