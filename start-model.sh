#!/usr/bin/env bash
set -euo pipefail

SERVER="${LLAMA_SERVER:-/tmp/opencode/llama.cpp-master/build/bin/llama-server}"
CTX="${CTX:-4096}"
PORT="${LLAMA_PORT:-8080}"

if [[ ! -x "$SERVER" ]]; then
  echo "llama-server not found at: $SERVER"
  echo "Build it first (see README.md), or set LLAMA_SERVER=/path/to/llama-server."
  exit 1
fi

if [[ -n "${LLM_MODEL_PATH:-}" ]]; then
  MODEL="$LLM_MODEL_PATH"
else
  MODEL="$(find "$HOME/models" -maxdepth 1 -type f -name '*.gguf' -printf '%s %p\n' 2>/dev/null \
    | sort -rn | head -n 1 | cut -d' ' -f2- || true)"
fi

if [[ -z "${MODEL:-}" || ! -f "$MODEL" ]]; then
  echo "No .gguf model found in $HOME/models."
  echo "Download one (see README.md) or set LLM_MODEL_PATH=/path/to/model.gguf."
  exit 1
fi

SIZE="$(du -h "$MODEL" | cut -f1)"
echo "Model : $MODEL ($SIZE)"
echo "Server: http://127.0.0.1:$PORT"
echo "If it says 'failed to load model', the file may still be downloading."
echo

ARGS=(
  -m "$MODEL"
  --host 127.0.0.1
  --port "$PORT"
  -c "$CTX"
)

if [[ -n "${SYSTEM_PROMPT_FILE:-}" ]]; then
  ARGS+=(--system-prompt "$(cat "$SYSTEM_PROMPT_FILE")")
fi

exec "$SERVER" "${ARGS[@]}"
