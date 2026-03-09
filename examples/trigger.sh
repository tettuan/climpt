#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER_DIR="${REPO_ROOT}/tmp/examples-runner"
TRIGGER_FILE="${TRIGGER_DIR}/.trigger"

datetime="$(date '+%Y-%m-%dT%H-%M-%S')"

if [[ -f "${TRIGGER_FILE}" ]]; then
  existing="$(cat "${TRIGGER_FILE}")"
  echo "Trigger file already exists: ${existing}"
  echo "Overwriting with: ${datetime}"
fi

mkdir -p "${TRIGGER_DIR}"
echo -n "${datetime}" > "${TRIGGER_FILE}"
echo "Trigger set: ${datetime}"
