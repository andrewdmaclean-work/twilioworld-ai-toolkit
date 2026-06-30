#!/usr/bin/env bash
#
# configure-agent.sh — pick an AI agent and wire it to the Twilio kit.
#
# Called by setup.sh (step 4) and directly from the toolkit menu.
# Reads optional env vars:
#   TWILIO_MCP_CREDS   — "ACxxx/SKxxx:secret" to print in agent guidance
#   HAS_GUM            — 1 if gum is available (for nicer UI)

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$ROOT/.toolkit/config.json"
DEFAULT_CONFIG_FILE="$ROOT/toolkit.defaults.json"
LEGACY_DEFAULT_CONFIG_FILE="$ROOT/.toolkit/defaults.json"
GGUF_MIN_BYTES=1500000000

TWILIO_MCP_PKG="@twilio-alpha/mcp@0.6.0"
DOCS_MCP_URL="https://mcp.twilio.com/docs"
MCP_CREDS="${TWILIO_MCP_CREDS:-}"
HAS_GUM="${HAS_GUM:-0}"
command -v gum >/dev/null 2>&1 && HAS_GUM=1

say()  { printf '%s\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m⚠\033[0m  %s\n' "$*"; }
err()  { printf '   \033[31m✗\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
local_model_ready() {
  local model="$ROOT/models/gemma4-e2b.gguf"
  [[ -f "$model" ]] || return 1
  local size
  size="$(wc -c < "$model" 2>/dev/null | tr -d ' ')" || return 1
  [[ "${size:-0}" -ge "$GGUF_MIN_BYTES" ]] || return 1
  [[ -x "$ROOT/tools/llamafile" || -x "$ROOT/tools/llamafile.exe" ]]
}
local_gemma_available() {
  addon_enabled localGemma || local_model_ready
}
addon_enabled() {
  local key="$1"
  local source="$CONFIG_FILE"
  have jq || return 1
  [[ -f "$source" ]] || source="$DEFAULT_CONFIG_FILE"
  [[ -f "$source" ]] || source="$LEGACY_DEFAULT_CONFIG_FILE"
  [[ -f "$source" ]] || return 1
  jq -e --arg key "$key" '.addons[$key] == true' "$source" >/dev/null 2>&1
}
addon_json_bool() {
  addon_enabled "$1" && printf 'true' || printf 'false'
}
header() {
  if [[ $HAS_GUM -eq 1 ]]; then
    gum style --border double --padding "0 2" --margin "1 0" --border-foreground 212 "$*"
  else printf '\n=== %s ===\n' "$*"; fi
}
confirm() {
  if [[ $HAS_GUM -eq 1 ]]; then gum confirm "$1"
  else read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; fi
}
choose() {
  local prompt="$1"; shift
  if [[ $HAS_GUM -eq 1 ]]; then gum choose --header "$prompt" "$@"
  else say "$prompt" >&2; select o in "$@"; do [[ -n "$o" ]] && { echo "$o"; return; }; done; fi
}

print_execute_oneliner() {
  if [[ -n "$MCP_CREDS" ]]; then
    say "       npx -y ${TWILIO_MCP_PKG} \"${MCP_CREDS}\""
  else
    say "       npx -y ${TWILIO_MCP_PKG} \"ACxxx/SKxxx:secret\"   (add your creds)"
  fi
}

configure_opencode_mcp_selection() {
  if ! have jq; then
    warn "jq not found — opencode.json MCP toggles were not updated."
    return
  fi

  local docs execute tmp
  docs="$(addon_json_bool docsMcp)"
  execute="$(addon_json_bool executeMcp)"
  tmp="$(mktemp)"
  jq \
    --argjson docs "$docs" \
    --argjson execute "$execute" \
    '.mcp["twilio-docs"].enabled = $docs | .mcp["twilio-execute"].enabled = $execute' \
    "$ROOT/opencode.json" > "$tmp" \
    && mv "$tmp" "$ROOT/opencode.json" \
    && ok "opencode.json MCP toggles match selected add-ons" \
    || { rm -f "$tmp"; warn "Could not update opencode.json MCP toggles."; }
}

write_pi_mcp_config() {
  local pi_dir="$1"
  local docs=false
  local execute=false
  addon_enabled docsMcp && docs=true
  if addon_enabled executeMcp; then
    if [[ -n "$MCP_CREDS" ]]; then
      execute=true
    else
      warn "Execute MCP selected, but TWILIO_MCP_CREDS is not set — skipping execute MCP config."
    fi
  fi

  [[ "$docs" == "true" || "$execute" == "true" ]] || return 0

  if ! have jq; then
    warn "jq not found — copy MCP config manually from $ROOT/.pi/mcp.json"
    return 0
  fi

  mkdir -p "$pi_dir"
  jq -n \
    --argjson docs "$docs" \
    --argjson execute "$execute" \
    --arg pkg "$TWILIO_MCP_PKG" \
    --arg creds '${TWILIO_MCP_CREDS}' \
    --arg docsUrl "$DOCS_MCP_URL" \
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

AGENT="$(choose "Which AI agent are you using?" \
  "OpenCode" "Pi (lightweight TUI)" "Claude Code" "Cursor" "Codex" "Other / Bring my own")"
ok "Selected: $AGENT"

case "$AGENT" in
  "OpenCode")
    configure_opencode_mcp_selection
    if have opencode; then
      ok "OpenCode already installed ($(opencode --version 2>/dev/null | head -1))"
    else
      warn "OpenCode not found."
      if confirm "Install OpenCode now?"; then
        if have brew; then
          brew install anomalyco/tap/opencode && ok "OpenCode installed via brew" \
            || err "brew install failed — try: npm install -g opencode-ai"
        elif have npm; then
          npm install -g opencode-ai && ok "OpenCode installed via npm" \
            || err "Install failed — see https://opencode.ai/docs"
        else
          err "No brew or npm found. Install manually: https://opencode.ai/docs"
        fi
      else
        warn "Skipped. Install later: https://opencode.ai/docs"
      fi
    fi
    ok "opencode.json in this repo pre-configures both MCP servers."
    say ""
    say "   Launch from this directory:"
    say "       cd $ROOT && opencode"
    say ""
    warn "Pick a real model for OpenCode — run /connect inside OpenCode and choose"
    warn "Anthropic, OpenAI, or OpenCode Zen for serious agent work."
    say  ""
    say  "   The local Gemma E2B model has tool calling ENABLED, but it's a 2B edge"
    say  "   model — it works best with only a FEW tools attached. Pointing it at the"
    say  "   full Twilio docs MCP (large tool surface) can make it slow or stall."
    if [[ -n "$MCP_CREDS" ]]; then
      say ""
      say "   To enable the Execute MCP, launch with your creds:"
      say "       TWILIO_MCP_CREDS=\"${MCP_CREDS}\" opencode"
      ok "opencode.json already has twilio-execute.enabled = true (set from your add-on selection)."
    fi
    ;;
  "Pi"*)
    # Pi requires Node >= 22.19.0 — Node 18/20 crash it with a regex flag error.
    NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    NODE_OK=1
    if [[ "${NODE_MAJOR:-0}" -lt 22 ]]; then
      warn "Pi requires Node >= 22.19.0 — you're on $(node --version 2>/dev/null)."
      warn "Run 'nvm use 22' first, then re-run 'Configure AI agent' for Pi."
      if ! confirm "Continue anyway (Pi will not work until you switch to Node 22+)?"; then
        warn "Skipping Pi. Switch to Node 22 and re-run Configure AI agent from the menu."
        NODE_OK=0
      fi
    fi
    if [[ $NODE_OK -eq 1 ]]; then
      PI_OK=0
      if have pi; then
        ok "Pi already installed"; PI_OK=1
      else
        warn "Pi not found."
        if confirm "Install Pi now?"; then
          if have npm; then
            npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
              && { ok "Pi installed via npm"; PI_OK=1; } \
              || err "npm install failed — see https://pi.dev/docs/latest"
          elif have curl; then
            curl -fsSL https://pi.dev/install.sh | sh \
              && { ok "Pi installed via install script"; PI_OK=1; } \
              || err "install script failed — see https://pi.dev"
          else
            err "No npm or curl found. Install Pi manually: https://pi.dev"
          fi
        else
          warn "Skipped Pi install."
        fi
      fi
      if [[ $PI_OK -eq 1 ]]; then
        # Use the same repo-local dir as the toolkit menu (PI_CODING_AGENT_DIR overrides Pi's default ~/.pi/agent)
        PI_DIR="$ROOT/.toolkit/pi-agent"
        mkdir -p "$PI_DIR/skills"
        if addon_enabled docsMcp || addon_enabled executeMcp; then
          PI_CODING_AGENT_DIR="$PI_DIR" pi install npm:pi-mcp-adapter >/dev/null 2>&1 \
            && ok "pi-mcp-adapter installed" \
            || warn "Couldn't auto-install pi-mcp-adapter — run: PI_CODING_AGENT_DIR=\"$PI_DIR\" pi install npm:pi-mcp-adapter"
          write_pi_mcp_config "$PI_DIR"
          ok "Selected Twilio MCP config installed to $PI_DIR/mcp.json"
        else
          warn "No MCP add-on selected — skipping Pi MCP setup."
        fi
        if local_gemma_available; then
          cp "$ROOT/.pi/models.json" "$PI_DIR/models.json" 2>/dev/null \
            && ok "Local Gemma model config installed to $PI_DIR/models.json" \
            || warn "Copy it manually from $ROOT/.pi/models.json"
        else
          warn "Local Gemma add-on not selected — skipping Pi local model config."
        fi
        if addon_enabled twilioSkills; then
          cp -r "$ROOT/vendor/twilio-ai/skills/." "$PI_DIR/skills/" 2>/dev/null \
            && ok "Twilio skills installed to $PI_DIR/skills/" \
            || warn "Run: cp -r $ROOT/vendor/twilio-ai/skills/. $PI_DIR/skills/"
        else
          warn "Twilio Skills add-on not selected — skipping Pi skills install."
        fi
      fi
      say ""
      say "   Launch Pi via the menu (recommended — sets up capabilities automatically):"
      say "       ./toolkit.sh  →  Open Pi agent"
      say ""
      say "   Or launch manually (Node 22+ required):"
      if local_gemma_available; then
        say "       ./start-model.sh --server     # in another terminal"
        say "       PI_CODING_AGENT_DIR=\"$ROOT/.toolkit/pi-agent\" pi --provider llamafile --model gemma4-e2b --append-system-prompt \"$ROOT/.pi/routing-prompt.md\""
      else
        say "       PI_CODING_AGENT_DIR=\"$ROOT/.toolkit/pi-agent\" pi --append-system-prompt \"$ROOT/.pi/routing-prompt.md\""
      fi
      say ""
      if addon_enabled docsMcp || addon_enabled executeMcp; then
        say "   Inside Pi:  /mcp status   shows connected Twilio servers"
        say "   MCP uses Pi's lazy mcp proxy unless you opt into directTools."
      fi
      if [[ -n "$MCP_CREDS" ]]; then
        say ""
        say "   Export creds so the execute MCP can authenticate:"
        say "       export TWILIO_MCP_CREDS=\"${MCP_CREDS}\""
      fi
      warn "Local 2B model: keep the tool set small. For heavy MCP use a cloud /model."
    fi
    ;;
  "Claude Code")
    say "   Run these in a Claude Code session (installs skills + docs MCP):"
    say "       /plugin marketplace add twilio/ai"
    say "       /plugin install twilio-developer-kit@twilio"
    say "   Add the Docs MCP (searchable live Twilio API reference):"
    say "       claude mcp add twilio-docs --transport http ${DOCS_MCP_URL}"
    say "   Add the Execute MCP (lets your agent make real Twilio API calls):"
    print_execute_oneliner
    ;;
  "Cursor")
    say "   In Cursor Composer:"
    say "       /add-plugin twilio-developer-kit"
    say "   Add Execute MCP under Cursor Settings > MCP, or run:"
    print_execute_oneliner
    ;;
  "Codex")
    say "   In Codex, open Plugins and install \"Twilio developer kit\"."
    say "   Add Execute MCP:"
    say "       codex mcp add twilio-docs --url ${DOCS_MCP_URL}"
    print_execute_oneliner
    ;;
  "Other / Bring my own")
    header "Bring Your Own Agent"
    say "Everything is open-standard (MCP + Agent Skills). Paste into your agent:"
    say ""
    say "  Docs MCP (HTTP, no auth):"
    say "      ${DOCS_MCP_URL}"
    say ""
    say "  Execute MCP (experimental, stdio):"
    print_execute_oneliner
    say ""
    say "  Skills (Agent Skills standard) — make them global:"
    say "      cp -r \"$ROOT/vendor/twilio-ai/skills/\" ~/.agents/skills/"
    say ""
    say "  Local model (OpenAI-compatible):"
    say "      http://127.0.0.1:8080/v1   (run ./start-model.sh)"
    say ""
    say "  Works with Copilot, Gemini CLI, JetBrains Junie + 30 more."
    ;;
esac
