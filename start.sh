#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# server.py reads .env itself; read the same values here so the banner and the
# reachability check tell the truth. Values are never eval'd -- they may contain
# spaces, so only these keys are pulled out as plain text.
envval() {
  [[ -f .env ]] || return 0
  sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1
}

BASE="${LLM_BASE_URL:-$(envval LLM_BASE_URL)}"
BASE="${BASE:-http://127.0.0.1:8080/v1}"
MODEL="${LLM_MODEL:-$(envval LLM_MODEL)}"
MODEL="${MODEL:-local-model}"
HOSTV="${HOST:-$(envval HOST)}"
HOSTV="${HOSTV:-127.0.0.1}"
PORTV="${PORT:-$(envval PORT)}"
PORTV="${PORTV:-3000}"

echo "DeepSeek Mix"
echo "  website : http://${HOSTV}:${PORTV}"
echo "  model   : ${MODEL} @ ${BASE}"
echo

if curl -fsS -m 4 "${BASE}/models" >/dev/null 2>&1; then
  echo "Model endpoint is awake."
else
  echo "Warning: no answer from ${BASE}."
  if [[ "${BASE}" == http://127.0.0.1:8080/v1 ]]; then
    echo "Start the local model in another terminal with:  ./start-model.sh"
  else
    echo "Check your internet connection, or see README.md for other endpoints."
  fi
fi

echo "Press Ctrl+C to stop the website."
echo
exec python3 server.py
