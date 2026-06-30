#!/usr/bin/env bash
#
# start-model.sh — run the local Gemma 4 model via llamafile.
#
#   ./start-model.sh             # combined: terminal chat + OpenAI API on :8080
#   ./start-model.sh --server    # API server only (for tools / background)
#   ./start-model.sh --chat      # terminal chat only, with Twilio system prompt
#
# Memory tuning (override via env vars):
#   CTX_SIZE  context window in tokens (default 4096 — ~1.5 GB RAM)
#             Increase for longer conversations: CTX_SIZE=8192 ./start-model.sh
#   PORT      HTTP server port (default 8080)
#
# KV cache is quantized to q4_0 by default, halving its RAM vs fp16.
#
# Notes on llamafile flags:
#   • The system prompt (-p) is only accepted in --chat mode.
#   • The default/combined and --server modes take the system prompt per-request
#     from the API caller (OpenCode, the web UI, etc.), so -p is NOT passed there.
#
# Ctrl+C stops it. No background daemon.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$ROOT/tools/llamafile"
MODEL="$ROOT/models/gemma4-e2b.gguf"
MMPROJ="$ROOT/models/gemma4-e2b-mmproj.gguf"
SYSPROMPT="$ROOT/models/system-prompt.txt"
CTX_SIZE="${CTX_SIZE:-4096}"
PORT="${PORT:-8080}"
MODE="${1:-combined}"

if [[ "$(uname -s)" == *"_NT"* || -n "${WINDIR:-}" ]]; then
  RUNTIME="$ROOT/tools/llamafile.exe"
fi

if [[ ! -x "$RUNTIME" ]]; then
  echo "✗ llamafile runtime not found at $RUNTIME"
  echo "  Run ./toolkit.sh → Setup to download it."
  exit 1
fi
if [[ ! -f "$MODEL" ]]; then
  echo "✗ Model not found at $MODEL"
  echo "  Run ./toolkit.sh → Setup to download it."
  exit 1
fi

# Refresh the Twilio source rules and optional skills index (best-effort)
if command -v node >/dev/null 2>&1; then
  node "$ROOT/build-system-prompt.js" >/dev/null 2>&1 || true
fi

# Model args valid in ALL modes (chat doesn't accept --host/--port).
# --ctx-size limits KV cache allocation; --cache-type-* quantizes the KV cache
# itself, halving its RAM vs the fp16 default with negligible quality impact.
MODEL_ARGS=(-m "$MODEL"
  --ctx-size "$CTX_SIZE"
  --cache-type-k q4_0
  --cache-type-v q4_0
)
[[ -f "$MMPROJ" ]] && MODEL_ARGS+=(--mmproj "$MMPROJ")
# Server-only network flags
SERVER_ARGS=(--host 127.0.0.1 --port "$PORT")

case "$MODE" in
  --server)
    echo "▶ Gemma 4 — API server on http://127.0.0.1:${PORT}/v1 (OpenAI-compatible)"
    echo "  Context: ${CTX_SIZE} tokens  |  KV cache: q4_0  |  Ctrl+C to stop."
    exec "$RUNTIME" --server "${MODEL_ARGS[@]}" "${SERVER_ARGS[@]}"
    ;;
  --chat)
    # --chat is the only mode that accepts a baked-in system prompt (-p).
    # It does NOT accept --host/--port.
    echo "▶ Gemma 4 — terminal chat (Twilio source rules loaded). Ctrl+C to stop."
    echo "  Context: ${CTX_SIZE} tokens  |  KV cache: q4_0"
    CHAT=("${MODEL_ARGS[@]}" --nologo)
    [[ -f "$SYSPROMPT" ]] && CHAT+=(-p "$(cat "$SYSPROMPT")")
    exec "$RUNTIME" --chat "${CHAT[@]}"
    ;;
  *)
    # Combined default: terminal chat UI + HTTP server in one process.
    # No -p here (combined mode rejects it); the chat UI / API callers set their own.
    echo "▶ Gemma 4 — terminal chat + API server on http://127.0.0.1:${PORT}/v1"
    echo "  Context: ${CTX_SIZE} tokens  |  KV cache: q4_0"
    echo "  Your tools can connect to that URL while you chat here."
    [[ -f "$MMPROJ" ]] && echo "  Image input enabled (mmproj loaded)."
    echo "  Type to chat. Ctrl+C to stop."
    echo
    exec "$RUNTIME" "${MODEL_ARGS[@]}" "${SERVER_ARGS[@]}"
    ;;
esac
