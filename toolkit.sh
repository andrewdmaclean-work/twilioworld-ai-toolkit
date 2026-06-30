#!/usr/bin/env bash
#
# toolkit.sh — TwilioWorld AI Toolkit, unified entry point.
#
# This is the only command you need:
#   ./toolkit.sh
#
# Arrow keys to navigate. Everything else is an implementation detail.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1
CONFIG_FILE="$ROOT/.toolkit/config.json"
DEFAULT_CONFIG_FILE="$ROOT/toolkit.defaults.json"
LEGACY_DEFAULT_CONFIG_FILE="$ROOT/.toolkit/defaults.json"
PI_AGENT_DIR="$ROOT/.toolkit/pi-agent"
GGUF_MIN_BYTES=1500000000

# ── Bootstrap gum (needed for the whole TUI) ─────────────────────────
if ! command -v gum >/dev/null 2>&1; then
  echo "Installing gum (needed for the UI)..."
  if command -v brew >/dev/null 2>&1; then
    brew install gum >/dev/null 2>&1 || { echo "brew install gum failed. Install manually: https://github.com/charmbracelet/gum"; exit 1; }
  else
    echo "gum not found. Install it first: https://github.com/charmbracelet/gum"
    exit 1
  fi
fi

# ── Colour helpers ────────────────────────────────────────────────────
ok()   { printf '  \033[32m✓\033[0m  %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m  %s\n' "$*"; }
warn() { printf '  \033[33m⚠\033[0m  %s\n' "$*"; }
dim()  { printf '  \033[90m·\033[0m  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
addon_enabled() {
  local key="$1"
  local source="$CONFIG_FILE"
  [[ -f "$source" ]] || source="$DEFAULT_CONFIG_FILE"
  [[ -f "$source" ]] || source="$LEGACY_DEFAULT_CONFIG_FILE"
  [[ -f "$source" ]] || return 1
  jq -e --arg key "$key" '.addons[$key] == true' "$source" >/dev/null 2>&1
}
local_model_file_ready() {
  local model="$ROOT/models/gemma4-e2b.gguf"
  [[ -f "$model" ]] || return 1
  local size
  size="$(wc -c < "$model" 2>/dev/null | tr -d ' ')" || return 1
  [[ "${size:-0}" -ge "$GGUF_MIN_BYTES" ]]
}
local_model_runtime_ready() {
  [[ -x "$ROOT/tools/llamafile" || -x "$ROOT/tools/llamafile.exe" ]]
}
local_model_ready() {
  local_model_file_ready && local_model_runtime_ready
}
local_gemma_available() {
  addon_enabled localGemma || local_model_ready
}

# ── Live status checks ────────────────────────────────────────────────
twilio_status() {
  have twilio || { bad "Twilio CLI  not installed"; return; }
  local name sid
  local prof
  prof="$(twilio profiles:list -o json 2>/dev/null | jq -r '[.[] | select(.active==true)] | first' 2>/dev/null || echo '{}')"
  name="$(printf '%s' "$prof" | jq -r '.id // empty')"
  sid="$(printf '%s' "$prof" | jq -r '.accountSid // empty')"
  if [[ -n "$sid" ]]; then
    ok "Twilio CLI  ${name} (…${sid: -4})"
  else
    bad "Twilio CLI  not logged in"
  fi
}

skills_status() {
  local n
  n="$(find "$ROOT/vendor/twilio-ai/skills" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "${n:-0}" -gt 0 ]]; then
    ok "Skills      ${n} loaded"
  else
    bad "Skills      not loaded (run Setup)"
  fi
}

model_status() {
  if [[ ! -f "$ROOT/models/gemma4-e2b.gguf" ]]; then
    # Check if any gguf is present (extraction may have gone wrong)
    local any_gguf
    any_gguf="$(find "$ROOT/models" -name "*.gguf" ! -name "gemma4-e2b-mmproj.gguf" 2>/dev/null | head -1)"
    if [[ -n "$any_gguf" ]]; then
      bad "Local model  wrong file found: $(basename "$any_gguf") — re-run Setup"
    else
      bad "Local model  not downloaded  (Setup → step 5)"
    fi
    return
  fi
  if ! local_model_file_ready; then
    local size
    size="$(wc -c < "$ROOT/models/gemma4-e2b.gguf" 2>/dev/null | tr -d ' ')"
    bad "Local model  incomplete ($((${size:-0}/1024/1024))MB < 1.5GB) — re-run Setup"
    return
  fi
  if ! local_model_runtime_ready; then
    bad "Local model  weights found, runtime missing — re-run Setup"
    return
  fi
  if curl -fsS "http://127.0.0.1:8080/v1/models" >/dev/null 2>&1; then
    ok "Local model  running on :8080"
  else
    ok "Local model  downloaded  (not running)"
  fi
}

devphone_status() {
  have twilio && twilio plugins 2>/dev/null | grep -q "plugin-dev-phone" \
    && ok "Dev Phone   installed" \
    || bad "Dev Phone   not installed"
}

opencode_status() {
  have opencode \
    && ok "OpenCode    $(opencode --version 2>/dev/null | head -1)" \
    || dim "OpenCode    not installed (optional)"
}

pi_status() {
  have pi \
    && ok "Pi          installed" \
    || dim "Pi          not installed (optional)"
}

show_status() {
  twilio_status
  skills_status
  model_status
  devphone_status
  opencode_status
  pi_status
}

# ── Menu helpers ──────────────────────────────────────────────────────
pause() { read -r -p "  Press enter to return to the menu..." _; }

header() {
  gum style \
    --border double \
    --padding "0 2" \
    --margin "1 0" \
    --border-foreground 212 \
    "TwilioWorld AI Toolkit"
}

# ── Sub-flows ─────────────────────────────────────────────────────────
run_setup() {
  bash "$ROOT/setup.sh"
  pause
}

run_agent() {
  HAS_GUM=1 bash "$ROOT/configure-agent.sh"
  pause
}

require_addon() {
  local key="$1"
  local label="$2"
  if addon_enabled "$key"; then
    return 0
  fi

  gum style --foreground 214 \
    "  $label add-on is not enabled." \
    "  Run Setup to choose add-ons for this kit."
  if gum confirm "Open Setup now?"; then
    run_setup
  else
    pause
  fi
  return 1
}

require_local_gemma() {
  if local_gemma_available; then
    return 0
  fi

  gum style --foreground 214 \
    "  Local Gemma model is not available." \
    "  Run Setup to enable/download the local model."
  if gum confirm "Open Setup now?"; then
    run_setup
  else
    pause
  fi
  return 1
}

install_pi_model_config() {
  local pi_dir="$PI_AGENT_DIR"
  mkdir -p "$pi_dir"

  cp "$ROOT/.pi/models.json" "$pi_dir/models.json" 2>/dev/null \
    && ok "Pi local model config installed" \
    || warn "Copy Pi model config manually from $ROOT/.pi/models.json"
}

write_pi_mcp_config() {
  local pi_dir="$PI_AGENT_DIR"
  local docs=false
  local execute=false
  addon_enabled docsMcp && docs=true
  if addon_enabled executeMcp; then
    if [[ -n "${TWILIO_MCP_CREDS:-}" ]]; then
      execute=true
    else
      warn "Execute MCP selected, but TWILIO_MCP_CREDS is not set — skipping execute MCP for this Pi launch."
    fi
  fi

  mkdir -p "$pi_dir"
  jq -n \
    --argjson docs "$docs" \
    --argjson execute "$execute" \
    --arg docsUrl "https://mcp.twilio.com/docs" \
    --arg pkg "@twilio-alpha/mcp@0.6.0" \
    --arg creds '${TWILIO_MCP_CREDS}' \
    '{
      mcpServers:
        ({}
        + (if $docs then {
            "twilio-docs": {
              type: "http",
              url: $docsUrl,
              lifecycle: "eager",
              directTools: true
            }
          } else {} end)
        + (if $execute then {
            "twilio-execute": {
              command: "npx",
              args: ["-y", $pkg, $creds]
            }
          } else {} end))
    }' > "$pi_dir/mcp.json"
}

install_pi_selected_capabilities() {
  local pi_dir="$PI_AGENT_DIR"
  mkdir -p "$pi_dir"

  if local_gemma_available; then
    install_pi_model_config
  fi

  if addon_enabled docsMcp || addon_enabled executeMcp; then
    PI_CODING_AGENT_DIR="$PI_AGENT_DIR" pi install npm:pi-mcp-adapter >/dev/null 2>&1 \
      && ok "Pi MCP adapter ready" \
      || warn "Couldn't install pi-mcp-adapter — run Configure AI agent"
  fi
  write_pi_mcp_config

  if addon_enabled twilioSkills; then
    mkdir -p "$pi_dir/skills"
    cp -r "$ROOT/vendor/twilio-ai/skills/." "$pi_dir/skills/" 2>/dev/null \
      && ok "Pi Twilio skills ready" \
      || warn "Couldn't copy Twilio skills — run Configure AI agent"
  elif [[ -d "$pi_dir/skills" ]]; then
    find "$pi_dir/skills" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  fi
}

PI_MODEL_PID=""
stop_pi_model_server() {
  if [[ -n "${PI_MODEL_PID:-}" ]]; then
    kill "$PI_MODEL_PID" >/dev/null 2>&1 || true
    PI_MODEL_PID=""
  fi
}

node_supports_pi() {
  have node || return 1
  node -e '
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && (minor > 19 || (minor === 19 && patch >= 0))) ? 0 : 1);
  ' >/dev/null 2>&1
}

run_pi() {
  require_addon builtInPi "Built-in Pi agent" || return
  require_local_gemma || return

  if ! node_supports_pi; then
    gum style --foreground 214 \
      "  Pi requires Node >= 22.19.0." \
      "  Current Node: $(node --version 2>/dev/null || echo "not installed")" \
      "  Switch with: nvm use 22"
    pause
    return
  fi

  if ! have pi; then
    gum style --foreground 214 "  Pi is not installed yet."
    if gum confirm "Open agent configuration now?"; then
      run_agent
      return
    else
      pause
      return
    fi
  fi

  install_pi_selected_capabilities

  if [[ ! -f "$ROOT/models/gemma4-e2b.gguf" ]]; then
    gum style --foreground 214 \
      "  Local Gemma model is not downloaded." \
      "  Run Setup first to download it, or use Configure AI agent for a cloud model."
    pause
    return
  fi

  if ! curl -fsS "http://127.0.0.1:8080/v1/models" >/dev/null 2>&1; then
    if gum confirm "Start the local Gemma service for Pi now?"; then
      local log_file="$ROOT/models/pi-server.log"
      gum style --foreground 35 "  Starting local Gemma service on http://127.0.0.1:8080/v1"
      bash "$ROOT/start-model.sh" --server >"$log_file" 2>&1 &
      PI_MODEL_PID=$!
      trap stop_pi_model_server INT TERM EXIT
      sleep 3

      if curl -fsS "http://127.0.0.1:8080/v1/models" >/dev/null 2>&1; then
        ok "Local Gemma service ready"
      else
        warn "Local Gemma service did not respond yet. Log: $log_file"
      fi
    else
      pause
      return
    fi
  fi

  gum style --foreground 35 \
    "  Opening Pi on the kit's local Gemma service." \
    "  Selected add-ons are attached silently."
  echo ""
  PI_ARGS=(--provider llamafile --model gemma4-e2b --append-system-prompt "$ROOT/.pi/routing-prompt.md" --no-skills)
  if addon_enabled twilioSkills; then
    PI_ARGS+=(--skill "$PI_AGENT_DIR/skills")
  fi
  PI_CODING_AGENT_DIR="$PI_AGENT_DIR" pi "${PI_ARGS[@]}"
  stop_pi_model_server
  trap - INT TERM EXIT
  pause
}

run_chat() {
  require_local_gemma || return

  if [[ ! -f "$ROOT/models/gemma4-e2b.gguf" ]]; then
    gum style --foreground 214 \
      "  Model not downloaded yet." \
      "  Run Setup first to download it (~2.5GB)."
    pause
    return
  fi
  if addon_enabled twilioSkills; then
    gum style --foreground 35 \
      "  Launching local Gemma chat with Twilio Skills loaded." \
      "  Ctrl+C to stop."
    USE_SKILLS=1
  else
    gum style --foreground 35 \
      "  Launching local Gemma chat without Twilio Skills." \
      "  Ctrl+C to stop."
    USE_SKILLS=0
  fi
  echo ""
  TOOLKIT_USE_SKILLS="$USE_SKILLS" bash "$ROOT/start-model.sh" --chat
  pause
}

run_server() {
  require_local_gemma || return

  if [[ ! -f "$ROOT/models/gemma4-e2b.gguf" ]]; then
    gum style --foreground 214 "  Model not downloaded yet. Run Setup first."
    pause
    return
  fi
  if curl -fsS "http://127.0.0.1:8080/v1/models" >/dev/null 2>&1; then
    gum style --foreground 35 "  ✓  Server already running at http://127.0.0.1:8080/v1"
    pause
    return
  fi
  gum style --foreground 35 \
    "  Starting Gemma server (no chat UI) on http://127.0.0.1:8080/v1" \
    "  For tools only. Ctrl+C to stop."
  echo ""
  bash "$ROOT/start-model.sh" --server
  pause
}

run_devphone() {
  require_addon devPhone "Dev Phone" || return

  if ! have twilio; then
    gum style --foreground 160 "  ✗  Twilio CLI not installed. Run Setup first."
    pause
    return
  fi
  gum style --foreground 214 \
    "  ⚠  Dev Phone OVERWRITES a number's webhooks." \
    "  Use a spare number — never a production one."
  if gum confirm "Continue?"; then
    twilio dev-phone
  fi
}

show_full_status() {
  echo ""
  show_status
  echo ""
  pause
}

# ── Main menu loop ────────────────────────────────────────────────────
while true; do
  clear
  header
  echo ""
  show_status
  echo ""

  # Build menu items — labels reflect current state
  MODEL_FILE="$ROOT/models/gemma4-e2b.gguf"
  MODEL_RUNNING=0
  curl -fsS "http://127.0.0.1:8080/v1/models" >/dev/null 2>&1 && MODEL_RUNNING=1

  ITEM_CHAT="Chat with local model        (terminal + API on :8080)"
  local_gemma_available || ITEM_CHAT="Chat with local model        (enable/download in Setup)"
  [[ ! -f "$MODEL_FILE" ]] && ITEM_CHAT="Chat with local model        (download in Setup first)"

  ITEM_SERVER="Local model server only      (for tools / background)"
  local_gemma_available || ITEM_SERVER="Local model server only      (enable/download in Setup)"
  [[ $MODEL_RUNNING -eq 1 ]] && ITEM_SERVER="Local model server           ✓ running on :8080"

  ITEM_PI="Open Pi agent               (selected add-ons)"
  addon_enabled builtInPi || ITEM_PI="Open Pi agent               (enable Built-in Pi in Setup)"
  local_gemma_available || ITEM_PI="Open Pi agent               (enable/download Local Gemma in Setup)"
  have pi || ITEM_PI="Open Pi agent               (install Pi first)"
  node_supports_pi || ITEM_PI="Open Pi agent               (needs Node 22.19+)"

  ITEM_DEVPHONE="Dev Phone — browser soft phone"
  addon_enabled devPhone || ITEM_DEVPHONE="Dev Phone — browser soft phone (enable in Setup)"

  CHOICE="$(gum choose \
    --header "  What do you want to do?" \
    --selected.foreground 212 \
    "Setup — configure this machine" \
    "Configure AI agent (OpenCode, Pi, Cursor…)" \
    "$ITEM_PI" \
    "$ITEM_CHAT" \
    "$ITEM_SERVER" \
    "$ITEM_DEVPHONE" \
    "Exit")" || exit 0

  case "$CHOICE" in
    "Setup"*)              run_setup    ;;
    "Configure AI agent"*) run_agent    ;;
    "Open Pi agent"*)      run_pi       ;;
    "Chat with local"*)    run_chat     ;;
    "Local model"*)        run_server   ;;
    "Dev Phone"*)          run_devphone ;;
    "Exit"|"")             echo "Bye!"; exit 0 ;;
  esac
done
