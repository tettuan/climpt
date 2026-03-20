#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER_FILE="${REPO_ROOT}/tmp/examples-runner/.trigger"

# --- 1. Check trigger ---
if [[ ! -f "${TRIGGER_FILE}" ]]; then
  echo "No trigger file. Run trigger.sh first."
  exit 0
fi

# Check if already running (second line starts with "started:")
if grep -q '^started:' "${TRIGGER_FILE}" 2>/dev/null; then
  echo "Already running. Skipping."
  exit 0
fi

datetime="$(head -1 "${TRIGGER_FILE}")"
echo "Trigger found: ${datetime}"

# Mark as running
echo "started:$(date '+%Y-%m-%dT%H-%M-%S')" >> "${TRIGGER_FILE}"

# --- 2. Create log directory ---
LOG_DIR="${REPO_ROOT}/tmp/logs/examples/${datetime}"
mkdir -p "${LOG_DIR}"

# --- 3. Collect run.sh scripts sorted numerically by directory name ---
run_scripts=()
while IFS= read -r script; do
  run_scripts+=("${script}")
done < <(
  find "${REPO_ROOT}/examples" -mindepth 2 -maxdepth 2 -name 'run.sh' -print0 \
    | xargs -0 -n1 bash -c 'echo "$(basename "$(dirname "$0")")|$0"' \
    | LC_ALL=C sort -t'_' -k1,1n \
    | cut -d'|' -f2
)

# --- 4-5. Execute each run.sh ---
total=0
passed=0
failed=0
skipped_json='["44_clean"]'
results_json=""

for script in "${run_scripts[@]}"; do
  dir="$(basename "$(dirname "${script}")")"

  # Skip 44_clean
  if [[ "${dir}" == "44_clean" ]]; then
    continue
  fi

  total=$((total + 1))
  log_file="${LOG_DIR}/${dir}.log"

  # Run from REPO_ROOT, capture stdout+stderr, record exit code
  exit_code=0
  (cd "${REPO_ROOT}" && bash "${script}") > "${log_file}" 2>&1 || exit_code=$?

  if [[ ${exit_code} -eq 0 ]]; then
    status="PASS"
    passed=$((passed + 1))
    echo "[PASS] ${dir}"
  else
    status="FAIL"
    failed=$((failed + 1))
    echo "[FAIL] ${dir} (exit=${exit_code})"
  fi

  # Accumulate JSON results
  entry="$(printf '{"name":"%s","exit_code":%d,"status":"%s"}' "${dir}" "${exit_code}" "${status}")"
  if [[ -z "${results_json}" ]]; then
    results_json="${entry}"
  else
    results_json="${results_json},${entry}"
  fi
done

# --- 6. Summary ---
echo ""
echo "=== Summary ==="
echo "Total:  ${total}"
echo "Passed: ${passed}"
echo "Failed: ${failed}"

# Write summary.json
cat > "${LOG_DIR}/summary.json" <<ENDJSON
{
  "datetime": "${datetime}",
  "total": ${total},
  "passed": ${passed},
  "failed": ${failed},
  "skipped": ${skipped_json},
  "results": [${results_json}]
}
ENDJSON

echo "Log directory: ${LOG_DIR}"
echo "Summary written: ${LOG_DIR}/summary.json"

# Delete trigger file (reset)
rm -f "${TRIGGER_FILE}"
