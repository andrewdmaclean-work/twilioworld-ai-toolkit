#!/usr/bin/env bash
#
# setup.sh — Twilio Escape Room "Lockpick Kit" setup.
#
# Arms your machine with everything needed to build & run Twilio things
# with your AI coding agent:
#   • Twilio Skills + Docs MCP (knows Twilio cold)
#   • Execute MCP (agent can call real Twilio APIs) — EXPERIMENTAL
#   • Twilio CLI + Dev Phone (manual testing)
#   • Gemma 4 E2B local model via llamafile (free, offline)
#
# Re-runnable: safe to run multiple times.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

CONFIG_DIR="$ROOT/.toolkit"
CONFIG_FILE="$CONFIG_DIR/config.json"
DEFAULT_CONFIG_FILE="$ROOT/toolkit.defaults.json"
LEGACY_DEFAULT_CONFIG_FILE="$CONFIG_DIR/defaults.json"
ADDON_TWILIO_SKILLS=false
ADDON_DOCS_MCP=false
ADDON_EXECUTE_MCP=false
ADDON_DEV_PHONE=false
ADDON_LOCAL_GEMMA=false
ADDON_BUILT_IN_PI=false

# ── Pinned versions (reproducibility) ────────────────────────────────
LLAMAFILE_VERSION="0.10.3"
# Official Google Gemma 4 E2B GGUF from Kaggle — no API key required
# Returns a zip containing main model + mmproj GGUFs
GGUF_URL="https://www.kaggle.com/api/v1/models/google/gemma-4/gguf/gemma-4-e2b-it-qat-q4_0-gguf/2/download"
GGUF_DEST="$ROOT/models/gemma4-e2b.gguf"
GGUF_MMPROJ="$ROOT/models/gemma4-e2b-mmproj.gguf"
GGUF_STAGING="$ROOT/models/gemma4-e2b.download"
GGUF_MIN_BYTES=1500000000   # 1.5GB floor for the main language model GGUF

# Detect OS at setup time so download path + runtime path always agree
OS_NAME="$(uname -s 2>/dev/null || echo "unknown")"
if [[ "$OS_NAME" == *"_NT"* || -n "${WINDIR:-}" ]]; then
  LLAMAFILE_URL="https://github.com/mozilla-ai/llamafile/releases/download/${LLAMAFILE_VERSION}/llamafile-${LLAMAFILE_VERSION}.exe"
  LLAMAFILE_DEST="$ROOT/tools/llamafile.exe"
else
  LLAMAFILE_URL="https://github.com/mozilla-ai/llamafile/releases/download/${LLAMAFILE_VERSION}/llamafile-${LLAMAFILE_VERSION}"
  LLAMAFILE_DEST="$ROOT/tools/llamafile"
fi

# ── --check: validate download URLs without running setup ────────────
if [[ "${1:-}" == "--check" ]]; then
  echo "Checking download URLs resolve…"
  rc=0
  for url in "$LLAMAFILE_URL" "$GGUF_URL"; do
    if curl -fsIL "$url" >/dev/null 2>&1; then
      echo "  OK   $url"
    else
      echo "  FAIL $url"
      rc=1
    fi
  done
  [[ $rc -eq 0 ]] && echo "All URLs reachable." || echo "One or more URLs failed — update the pinned versions in setup.sh."
  exit $rc
fi

# ── --dry-run: walk the flow without mutating the system ─────────────
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  echo "[DRY RUN] No installs, downloads, logins, or API calls will be performed."
fi

# run CMD...  — executes normally, or just prints it in dry-run mode
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '   \033[36m[dry-run]\033[0m would run: %s\n' "$*"
    return 0
  fi
  "$@"
}

# ── Tiny styling helpers (work with or without gum) ──────────────────
HAS_GUM=0
say()    { printf '%s\n' "$*"; }
header() {
  if [[ $HAS_GUM -eq 1 ]]; then
    gum style --border double --margin "1 0" --padding "0 2" --border-foreground 212 "$*"
  else
    printf '\n=== %s ===\n' "$*"
  fi
}
step()   {
  if [[ $HAS_GUM -eq 1 ]]; then
    gum style --foreground 212 --bold "▶ $*"
  else
    printf '\n▶ %s\n' "$*"
  fi
}
ok()     { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn()   { printf '   \033[33m⚠\033[0m  %s\n' "$*"; }
err()    { printf '   \033[31m✗\033[0m %s\n' "$*"; }
have()   { command -v "$1" >/dev/null 2>&1; }

# Require an interactive terminal — gum and read both hang on non-tty stdin
# Set FORCE_TTY=1 to bypass this check (used by automated tests only)
if [[ $DRY_RUN -eq 0 && ! -t 0 && "${FORCE_TTY:-0}" != "1" ]]; then
  echo "ERROR: setup.sh must be run in an interactive terminal (stdin is not a tty)."
  echo "       Use --dry-run to walk the flow non-interactively."
  exit 1
fi

# jq is required for reliable JSON parsing — auto-install via brew if possible
if ! have jq; then
  if have brew; then
    printf 'Installing jq... '
    brew install jq >/dev/null 2>&1 && echo "done" || {
      echo "failed."
      echo "ERROR: jq is required. Install manually:"
      echo "  macOS:  brew install jq"
      echo "  Linux:  apt install jq  /  yum install jq"
      exit 1
    }
  else
    echo "ERROR: jq is required. Install it first:"
    echo "  macOS:  brew install jq"
    echo "  Linux:  apt install jq  /  yum install jq"
    exit 1
  fi
fi

confirm() {
  # $1 = prompt. Returns 0 for yes.
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '   \033[36m[dry-run]\033[0m prompt: %s -> assuming no\n' "$1"
    return 1
  fi
  if [[ $HAS_GUM -eq 1 ]]; then
    gum confirm "$1"
  else
    read -r -p "$1 [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]]
  fi
}

choose() {
  # $1 = header, rest = options. Echoes chosen option.
  local prompt="$1"; shift
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '   \033[36m[dry-run]\033[0m choose: %s -> %s\n' "$prompt" "$1" >&2
    echo "$1"
    return
  fi
  if [[ $HAS_GUM -eq 1 ]]; then
    gum choose --header "$prompt" "$@"
  else
    say "$prompt" >&2
    select opt in "$@"; do
      [[ -n "$opt" ]] && { echo "$opt"; return; }
    done
  fi
}

addon_enabled() {
  local key="$1"
  case "$key" in
    twilioSkills) [[ "$ADDON_TWILIO_SKILLS" == "true" ]] && return 0 ;;
    docsMcp)      [[ "$ADDON_DOCS_MCP" == "true" ]] && return 0 ;;
    executeMcp)   [[ "$ADDON_EXECUTE_MCP" == "true" ]] && return 0 ;;
    devPhone)     [[ "$ADDON_DEV_PHONE" == "true" ]] && return 0 ;;
    localGemma)   [[ "$ADDON_LOCAL_GEMMA" == "true" ]] && return 0 ;;
    builtInPi)    [[ "$ADDON_BUILT_IN_PI" == "true" ]] && return 0 ;;
  esac
  local source="$CONFIG_FILE"
  [[ -f "$source" ]] || source="$DEFAULT_CONFIG_FILE"
  [[ -f "$source" ]] || source="$LEGACY_DEFAULT_CONFIG_FILE"
  [[ -f "$source" ]] || return 1
  jq -e --arg key "$key" '.addons[$key] == true' "$source" >/dev/null 2>&1
}

write_addon_config() {
  local twilio_skills="$1"
  local docs_mcp="$2"
  local execute_mcp="$3"
  local dev_phone="$4"
  local local_gemma="$5"
  local built_in_pi="$6"

  ADDON_TWILIO_SKILLS="$twilio_skills"
  ADDON_DOCS_MCP="$docs_mcp"
  ADDON_EXECUTE_MCP="$execute_mcp"
  ADDON_DEV_PHONE="$dev_phone"
  ADDON_LOCAL_GEMMA="$local_gemma"
  ADDON_BUILT_IN_PI="$built_in_pi"

  if [[ $DRY_RUN -eq 1 ]]; then
    printf '   \033[36m[dry-run]\033[0m would save add-on choices to %s\n' "$CONFIG_FILE"
    return
  fi

  mkdir -p "$CONFIG_DIR"
  jq -n \
    --argjson twilioSkills "$twilio_skills" \
    --argjson docsMcp "$docs_mcp" \
    --argjson executeMcp "$execute_mcp" \
    --argjson devPhone "$dev_phone" \
    --argjson localGemma "$local_gemma" \
    --argjson builtInPi "$built_in_pi" \
    '{
      version: 1,
      addons: {
        twilioSkills: $twilioSkills,
        docsMcp: $docsMcp,
        executeMcp: $executeMcp,
        devPhone: $devPhone,
        localGemma: $localGemma,
        builtInPi: $builtInPi
      }
    }' > "$CONFIG_FILE"
}

choose_addons() {
  local opt_skills="Twilio Skills in agents"
  local opt_docs="Docs MCP"
  local opt_execute="Execute MCP (real Twilio API calls)"
  local opt_devphone="Dev Phone"
  local opt_gemma="Local Gemma model"
  local opt_pi="Built-in Pi agent"

  local selected=""
  if [[ $DRY_RUN -eq 1 ]]; then
    selected="${opt_skills}
${opt_docs}
${opt_gemma}
${opt_pi}"
  elif [[ $HAS_GUM -eq 1 ]]; then
    selected="$(gum choose --no-limit --header "Choose add-ons to install/configure now" \
      --selected="${opt_skills},${opt_docs},${opt_gemma},${opt_pi}" \
      "$opt_skills" \
      "$opt_docs" \
      "$opt_execute" \
      "$opt_devphone" \
      "$opt_gemma" \
      "$opt_pi")"
  else
    say "Choose add-ons to install/configure now:" >&2
    confirm "$opt_skills?" && selected+="${opt_skills}"$'\n'
    confirm "$opt_docs?" && selected+="${opt_docs}"$'\n'
    confirm "$opt_execute?" && selected+="${opt_execute}"$'\n'
    confirm "$opt_devphone?" && selected+="${opt_devphone}"$'\n'
    confirm "$opt_gemma?" && selected+="${opt_gemma}"$'\n'
    confirm "$opt_pi?" && selected+="${opt_pi}"$'\n'
  fi

  local twilio_skills=false
  local docs_mcp=false
  local execute_mcp=false
  local dev_phone=false
  local local_gemma=false
  local built_in_pi=false

  grep -qxF "$opt_skills" <<<"$selected" && twilio_skills=true
  grep -qxF "$opt_docs" <<<"$selected" && docs_mcp=true
  grep -qxF "$opt_execute" <<<"$selected" && execute_mcp=true
  grep -qxF "$opt_devphone" <<<"$selected" && dev_phone=true
  grep -qxF "$opt_gemma" <<<"$selected" && local_gemma=true
  grep -qxF "$opt_pi" <<<"$selected" && built_in_pi=true

  if [[ "$built_in_pi" == "true" && "$local_gemma" != "true" ]]; then
    warn "Built-in Pi uses the local Gemma service — enabling Local Gemma model too."
    local_gemma=true
  fi

  if [[ "$execute_mcp" == "true" && "$docs_mcp" != "true" ]]; then
    warn "Execute MCP selected without Docs MCP. That's allowed, but Docs MCP is usually useful too."
  fi

  write_addon_config "$twilio_skills" "$docs_mcp" "$execute_mcp" "$dev_phone" "$local_gemma" "$built_in_pi"
  ok "Add-on choices saved to $CONFIG_FILE"
}

# ── 0. Bootstrap gum ─────────────────────────────────────────────────
if [[ $DRY_RUN -eq 1 ]]; then
  have gum && HAS_GUM=1
elif have gum; then
  HAS_GUM=1
else
  if have brew; then
    printf 'Installing gum (nicer setup UI)... '
    brew install gum >/dev/null 2>&1 && { HAS_GUM=1; echo "done"; } || echo "skipped"
  else
    echo "Note: install 'gum' (brew install gum) for a nicer UI. Continuing in plain mode."
  fi
fi

header "TwilioWorld AI Toolkit"
say "This sets up your machine to build & run Twilio things with your AI agent."
say ""

step "Choose add-ons"
choose_addons

# ── 1. Prerequisites ─────────────────────────────────────────────────
step "[1/7] Checking prerequisites"
MISSING=0
for tool in node git curl jq; do
  if have "$tool"; then
    ok "$tool ($("$tool" --version 2>/dev/null | head -1))"
  else
    err "$tool not found"
    MISSING=1
  fi
done
if [[ $MISSING -eq 1 ]]; then
  err "Install the missing tools above, then re-run ./setup.sh"
  exit 1
fi

# ── 2. Twilio CLI ────────────────────────────────────────────────────
step "[2/7] Twilio CLI"
if have twilio; then
  ok "twilio CLI present ($(twilio --version 2>/dev/null | head -1))"
else
  warn "Twilio CLI not found."
  if addon_enabled executeMcp || addon_enabled devPhone; then
    if confirm "Install Twilio CLI now (npm install -g twilio-cli)?"; then
      npm install -g twilio-cli && ok "Installed" || {
        err "Install failed. If you see EACCES, fix your npm global dir:"
        err "  https://docs.npmjs.com/resolving-eacces-permissions-errors"
        err "Or: https://www.twilio.com/docs/twilio-cli/quickstart"
        exit 1
      }
    else
      err "Twilio CLI required for Execute MCP / Dev Phone. Install: https://www.twilio.com/docs/twilio-cli/quickstart"
      exit 1
    fi
  else
    warn "Twilio CLI not installed — skipping (not needed for your selected add-ons)."
    warn "Install later if needed: https://www.twilio.com/docs/twilio-cli/quickstart"
  fi
fi

# Login + active account confirmation.
# This whole block is OPTIONAL — it only enables the Execute MCP (step 3).
# Skills, Docs MCP, the local model, and Dev Phone all work without it,
# so credential problems warn and continue rather than aborting setup.
ACTIVE_ACCOUNT_SID=""
ACTIVE_PROFILE_NAME=""
TWILIO_OK=0

if [[ $DRY_RUN -eq 1 ]]; then
  ok "(dry-run) would ensure twilio login + confirm active account"
  TWILIO_OK=1
else
  PROFILES_JSON="$(twilio profiles:list -o json 2>/dev/null || echo '[]')"

  if [[ "$(printf '%s' "$PROFILES_JSON" | jq 'length')" -eq 0 ]]; then
    warn "Not logged in to the Twilio CLI."
    if confirm "Log in now? (only needed for the experimental Execute MCP)"; then
      twilio login && PROFILES_JSON="$(twilio profiles:list -o json 2>/dev/null || echo '[]')" \
        || warn "Login failed — continuing without Execute MCP."
    else
      warn "Skipping login — Execute MCP won't be configured (everything else still works)."
    fi
  fi

  if [[ "$(printf '%s' "$PROFILES_JSON" | jq 'length')" -gt 0 ]]; then
    # .accountSid = the AC... SID,  .id = the human profile name
    ACTIVE_ACCOUNT_SID="$(printf '%s' "$PROFILES_JSON" | jq -r '[.[] | select(.active == true)] | first | .accountSid // empty')"
    ACTIVE_PROFILE_NAME="$(printf '%s' "$PROFILES_JSON" | jq -r '[.[] | select(.active == true)] | first | .id // empty')"
    if [[ -z "$ACTIVE_ACCOUNT_SID" ]]; then
      ACTIVE_ACCOUNT_SID="$(printf '%s' "$PROFILES_JSON" | jq -r 'first | .accountSid // empty')"
      ACTIVE_PROFILE_NAME="$(printf '%s' "$PROFILES_JSON" | jq -r 'first | .id // empty')"
    fi
  fi

  if [[ -z "$ACTIVE_ACCOUNT_SID" ]]; then
    warn "No usable Twilio account — Execute MCP will be skipped (optional)."
  # Verify credentials actually work — a profile existing doesn't mean creds are valid
  elif ! twilio api:core:accounts:fetch --sid "$ACTIVE_ACCOUNT_SID" -o json 2>/dev/null \
      | jq -e '.[0].sid' >/dev/null 2>&1; then
    warn "Credentials for '$ACTIVE_PROFILE_NAME' appear stale or invalid (got 401)."
    if confirm "Re-authenticate now? (optional — only for Execute MCP)"; then
      if twilio login; then
        PROFILES_JSON="$(twilio profiles:list -o json 2>/dev/null || echo '[]')"
        ACTIVE_ACCOUNT_SID="$(printf '%s' "$PROFILES_JSON" | jq -r '[.[] | select(.active == true)] | first | .accountSid // empty')"
        ACTIVE_PROFILE_NAME="$(printf '%s' "$PROFILES_JSON" | jq -r '[.[] | select(.active == true)] | first | .id // empty')"
        TWILIO_OK=1
      else
        warn "Login failed — skipping Execute MCP."
      fi
    else
      warn "Skipping — Execute MCP won't be configured. Everything else still works."
    fi
  else
    TWILIO_OK=1
  fi

  if [[ $TWILIO_OK -eq 1 ]]; then
    ok "Logged in"
    say ""
    say "   Active account:"
    say "     Profile: $ACTIVE_PROFILE_NAME"
    say "     SID:     $ACTIVE_ACCOUNT_SID"
    say ""
    ok "Account: $ACTIVE_PROFILE_NAME ($ACTIVE_ACCOUNT_SID)"
    say  "   If this is the wrong account, run:  twilio profiles:use <name>  then re-run Setup."
    say  "   Available profiles:"
    printf '%s' "$PROFILES_JSON" | jq -r '.[] | "     \(.id)  (…\(.accountSid[-4:]))"'
  fi
fi

# ── 3. API key for the Execute MCP ───────────────────────────────────
step "[3/7] API key for Execute MCP (optional)"
MCP_CREDS=""
if ! addon_enabled executeMcp; then
  warn "Execute MCP add-on not selected — skipping API key creation."
elif [[ $DRY_RUN -eq 1 ]]; then
  ok "(dry-run) would check for / create: twilioworld-toolkit API key"
elif [[ -z "$ACTIVE_ACCOUNT_SID" ]]; then
  warn "No confirmed Twilio account — skipping Execute MCP."
  say  "   Everything else (Skills, Docs MCP, local model, Dev Phone) still works."
  say  "   To enable it later: twilio login, then re-run Setup."
else
  say "   The Twilio CLI stores its own credentials in your system keychain — those"
  say "   can't be shared with the Execute MCP, which runs as a separate npx process."
  say "   We mint one scoped API key so the MCP can call Twilio on your behalf."
  say ""
  warn "The Execute MCP (EXPERIMENTAL) can call any Twilio API on this account,"
  warn "including sending messages, making calls, and deleting resources."
  warn "Recommend: set a spend limit at console.twilio.com/billing before continuing."
  say ""
  SID="$ACTIVE_ACCOUNT_SID"
  say "   Account: $SID ($ACTIVE_PROFILE_NAME)"

  # Check for existing key using jq — reliable regardless of CLI output formatting
  EXISTING_SK="$(twilio api:core:keys:list -o json 2>/dev/null \
    | jq -r '[.[] | select(.friendlyName == "twilioworld-toolkit")] | first | .sid // empty')"

  if [[ -n "$EXISTING_SK" ]]; then
    warn "Key 'twilioworld-toolkit' already exists on this account (${EXISTING_SK})."
    warn "The secret is not recoverable. Options:"
    say  "     a) Delete and re-run:  twilio api:core:keys:remove --sid $EXISTING_SK"
    say  "     b) Set manually:       export TWILIO_MCP_CREDS=\"${SID}/${EXISTING_SK}:<secret>\""
  elif KEY_JSON="$(twilio api:core:keys:create --friendly-name "twilioworld-toolkit" -o json 2>/dev/null)" \
    && [[ -n "$KEY_JSON" ]]; then
    API_KEY="$(printf '%s' "$KEY_JSON" | jq -r '.sid // empty')"
    API_SECRET="$(printf '%s' "$KEY_JSON" | jq -r '.secret // empty')"
    if [[ -n "$SID" && -n "$API_KEY" && -n "$API_SECRET" ]]; then
      MCP_CREDS="${SID}/${API_KEY}:${API_SECRET}"
      ok "API key created on $SID ($API_KEY)"
      warn "SECRET SHOWN ONCE ONLY — do not screenshot or share your screen right now."
      say  "   Copy this and keep it safe:"
      say  "   TWILIO_MCP_CREDS=${MCP_CREDS}"
      say  ""
      say  "   To avoid re-exporting every session, save to a local .env (gitignored):"
      say  "       echo 'export TWILIO_MCP_CREDS=\"${MCP_CREDS}\"' >> .env"
      say  "   Then load it in any terminal:  source .env"
      warn "This value will appear in your shell history after you export it."
      warn "Clear it with:  history -d \$(history 1 | awk '{print \$1}')"
    else
      warn "Couldn't parse key output; wire Execute MCP creds manually later."
    fi
  else
    warn "Couldn't mint a key automatically. Skipping — Execute MCP can be wired later."
  fi
fi

# ── 4. AI agent ──────────────────────────────────────────────────────
step "[4/7] AI agent"
# Hand off to the standalone agent configurator (also callable from the menu).
if confirm "Configure your AI agent now?"; then
  TWILIO_MCP_CREDS="${MCP_CREDS:-}" HAS_GUM="$HAS_GUM" bash "$ROOT/configure-agent.sh"
else
  warn "Skipped — run 'Configure AI agent' from the toolkit menu any time."
fi

# ── 5. Local model (Gemma 4 E2B via llamafile) ───────────────────────
step "[5/7] Local AI model — Gemma 4 E2B via llamafile"
MODEL_RUNTIME_OK=0
MODEL_WEIGHTS_OK=0
[[ -x "$LLAMAFILE_DEST" ]] && MODEL_RUNTIME_OK=1

# Treat a partial or corrupt download as absent — check file size floor
if [[ -f "$GGUF_DEST" ]]; then
  GGUF_SIZE="$(wc -c < "$GGUF_DEST" 2>/dev/null | tr -d ' ')"
  if [[ "${GGUF_SIZE:-0}" -ge "$GGUF_MIN_BYTES" ]]; then
    MODEL_WEIGHTS_OK=1
  else
    warn "Found incomplete model file ($((${GGUF_SIZE:-0}/1024/1024))MB < 1.5GB) — will re-download."
    rm -f "$GGUF_DEST"
  fi
fi

if ! addon_enabled localGemma; then
  warn "Local Gemma add-on not selected — skipping model download."
elif [[ $MODEL_RUNTIME_OK -eq 1 && $MODEL_WEIGHTS_OK -eq 1 ]]; then
  ok "llamafile runtime already present"
  ok "model weights already present"
  [[ -f "$GGUF_MMPROJ" ]] && ok "mmproj (multimodal) already present"
  say "   Run the model anytime with:  ./start-model.sh"
elif confirm "Download the local model now? (~2.5GB, optional)"; then
  # Disk space preflight — need at least 5GB free (zip + extracted files)
  if have df; then
    FREE_KB="$(df -k "$ROOT" 2>/dev/null | awk 'NR==2 {print $4}')"
    if [[ -n "$FREE_KB" && "$FREE_KB" -lt 5242880 ]]; then
      warn "Only $((FREE_KB/1024))MB free in $ROOT. Need ~5GB. Skipping download."
      warn "Free up space then re-run ./setup.sh"
    else
      if [[ $MODEL_RUNTIME_OK -eq 0 ]]; then
        say "   Downloading llamafile runtime v${LLAMAFILE_VERSION}…"
        curl -fL --progress-bar "$LLAMAFILE_URL" -o "$LLAMAFILE_DEST" && chmod +x "$LLAMAFILE_DEST" \
          && ok "llamafile runtime ready" || err "runtime download failed"
      else
        ok "llamafile runtime already present"
      fi
      if [[ $MODEL_WEIGHTS_OK -eq 0 ]]; then
        # Kaggle serves a .tar.gz — bsdtar/tar auto-detects gzip.
        # The downloaded archive is NEVER deleted by this script — only the user removes it.
        if [[ ! -f "$GGUF_STAGING" ]]; then
          say "   Downloading Gemma 4 E2B from Kaggle (~2.5GB .tar.gz)…"
          if ! curl -fL --progress-bar "$GGUF_URL" -o "$GGUF_STAGING"; then
            err "Download failed. Partial file kept at: $GGUF_STAGING"
            err "Delete it yourself if you want a clean retry."
          fi
        else
          ok "Archive already present ($(wc -c < "$GGUF_STAGING" | awk '{printf "%.1fGB", $1/1073741824}')) — skipping download"
        fi

        if [[ -f "$GGUF_STAGING" ]]; then
          say "   Extracting…"
          EXTRACT_TMP="$ROOT/models/extract_tmp"
          rm -rf "$EXTRACT_TMP"; mkdir -p "$EXTRACT_TMP"
          tar -xf "$GGUF_STAGING" -C "$EXTRACT_TMP"

          say "   Extracted:"
          find "$EXTRACT_TMP" -name "*.gguf" | while read -r f; do
            say "     $(basename "$f")  ($(wc -c < "$f" | awk '{printf "%.0fMB", $1/1048576}'))"
          done

          # Projector = file with mmproj in the name
          MMPROJ_GGUF="$(find "$EXTRACT_TMP" -name "*mmproj*.gguf" | head -1)"
          # Main model = the LARGEST .gguf that is NOT the projector (size, not name — robust)
          MAIN_GGUF="$(find "$EXTRACT_TMP" -name "*.gguf" ! -name "*mmproj*" -exec ls -S {} + 2>/dev/null | head -1)"

          if [[ -n "$MAIN_GGUF" && -f "$MAIN_GGUF" ]]; then
            mv "$MAIN_GGUF" "$GGUF_DEST"
            [[ -n "$MMPROJ_GGUF" && -f "$MMPROJ_GGUF" ]] && mv "$MMPROJ_GGUF" "$GGUF_MMPROJ"
            rm -rf "$EXTRACT_TMP"
            ok "Model ready ($(wc -c < "$GGUF_DEST" | awk '{printf "%.1fGB", $1/1073741824}'))"
            ok "Archive kept at $GGUF_STAGING — delete it to reclaim ~2.5GB"
          else
            # Extraction didn't yield a usable main model — DO NOT delete anything.
            err "No main model GGUF found in archive. Left everything in place:"
            err "  Archive:   $GGUF_STAGING  (kept — never auto-deleted)"
            err "  Extracted: $EXTRACT_TMP   (kept for inspection)"
            find "$EXTRACT_TMP" -type f | sed 's/^/     /'
          fi
        fi
      else
        ok "model weights already present"
      fi
      say "   Run the model anytime with:  ./start-model.sh"
    fi
  fi
else
  warn "Skipped. Download later by re-running ./setup.sh, or grab it manually."
fi

# ── 6. Dev Phone ─────────────────────────────────────────────────────
step "[6/7] Dev Phone"
if ! addon_enabled devPhone; then
  warn "Dev Phone add-on not selected — skipping plugin install."
elif [[ $DRY_RUN -eq 1 ]]; then
  ok "(dry-run) would install @twilio-labs/plugin-dev-phone"
  warn "Dev Phone OVERWRITES a number's webhooks — use a spare number, not production."
  say  "   Launch later with:  twilio dev-phone"
elif twilio plugins 2>/dev/null | grep -q "plugin-dev-phone"; then
  ok "Dev Phone plugin already installed"
  warn "Dev Phone OVERWRITES a number's webhooks — use a spare number, not production."
  say  "   Launch later with:  twilio dev-phone"
else
  if confirm "Install the Dev Phone plugin (browser soft phone for SMS + voice)?"; then
    twilio plugins:install @twilio-labs/plugin-dev-phone && ok "Dev Phone installed" || warn "Dev Phone install failed (non-fatal)"
    warn "Dev Phone OVERWRITES a number's webhooks — use a spare number, not production."
    say  "   Launch later with:  twilio dev-phone"
  else
    warn "Skipped Dev Phone."
  fi
fi

# ── 7. Skills ────────────────────────────────────────────────────────
step "[7/7] Twilio Skills"
if [[ -f "$ROOT/vendor/twilio-ai/skills/README.md" ]]; then
  ok "Skills already present (submodule populated)"
else
  say "   Pulling skills (git submodule)…"
  git submodule update --init --recursive && ok "Skills pulled" || err "submodule init failed"
fi
SKILL_COUNT="$(find "$ROOT/vendor/twilio-ai/skills" -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')"
ok "${SKILL_COUNT} skills available"

if addon_enabled twilioSkills; then
  say "   Installing skills globally to ~/.agents/skills/ (for Cursor, Copilot, Codex, and other agents)."
  mkdir -p ~/.agents/skills
  cp -r "$ROOT/vendor/twilio-ai/skills/." ~/.agents/skills/ && ok "Skills installed globally to ~/.agents/skills/" || warn "global copy failed — skills still available in this repo at vendor/twilio-ai/skills/"
else
  warn "Twilio Skills add-on not selected — skills available in this repo only."
fi

# ── Verify ───────────────────────────────────────────────────────────
step "Verifying Twilio credentials"
if [[ $DRY_RUN -eq 1 ]]; then
  ok "(dry-run) would verify with: twilio api:core:accounts:fetch"
elif [[ -n "$ACTIVE_ACCOUNT_SID" ]]; then
  if twilio api:core:accounts:fetch --sid "$ACTIVE_ACCOUNT_SID" -o json >/dev/null 2>&1; then
    ok "Twilio API reachable — credentials work ($ACTIVE_ACCOUNT_SID)"
  else
    warn "Could not reach Twilio API. Check your connection and run 'twilio login'."
  fi
else
  warn "No confirmed account SID — skipping verify."
fi

# ── Done ─────────────────────────────────────────────────────────────
header "Your toolkit is ready"
say "Quick commands:"
say "   ./toolkit.sh              # the menu (configure agent, chat, dev phone)"
say "   twilio dev-phone           # browser soft phone (use a spare number!)"
say "   ./start-model.sh           # local Gemma: terminal chat + API on :8080"
say "   ./start-model.sh --server  # local Gemma: API only (for tools)"
say "   twilio --help              # explore the CLI"
say ""
say "Your agent has: Twilio Skills + Docs MCP + (optional) Execute MCP."
say "Try asking it: \"How do I send an SMS with Twilio?\""
