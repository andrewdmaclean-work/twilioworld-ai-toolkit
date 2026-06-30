#!/usr/bin/env bash
#
# uninstall.sh — reverse everything setup.sh added to your system.
#
# Removes (with confirmation for each):
#   • Dev Phone CLI plugin
#   • Twilio CLI global npm package
#   • gum (via brew)
#   • the scoped API key this kit minted
#   • ~/.agents/skills/ copy (BYO/Cursor/Codex path)
#   • downloaded model + llamafile binary (in-repo)
#
# It does NOT log you out of the Twilio CLI or touch your account beyond the
# one API key it created. Re-runnable.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m⚠\033[0m  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
ask()  { read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; }

printf '\n=== TwilioWorld AI Toolkit — Uninstall ===\n\n'

# 1. Dev Phone plugin
if have twilio && twilio plugins 2>/dev/null | grep -q "plugin-dev-phone"; then
  if ask "Remove Dev Phone plugin?"; then
    twilio plugins:remove @twilio-labs/plugin-dev-phone >/dev/null 2>&1 && ok "Dev Phone removed" || warn "removal failed"
  fi
fi

# 2. The API key this kit minted
if have twilio; then
  if ask "Delete the API key this kit created (friendly name 'twilioworld-toolkit')?"; then
    SK="$(twilio api:core:keys:list -o json 2>/dev/null | jq -r '[.[] | select(.friendlyName == "twilioworld-toolkit")] | first | .sid // empty')"
    if [[ -n "$SK" ]]; then
      twilio api:core:keys:remove --sid "$SK" >/dev/null 2>&1 && ok "API key $SK deleted" || warn "could not delete $SK"
    else
      warn "No matching key found (may already be deleted)."
    fi
  fi
fi

# 3. Twilio CLI global package
if have twilio; then
  if ask "Uninstall the Twilio CLI globally (npm uninstall -g twilio-cli)?"; then
    npm uninstall -g twilio-cli >/dev/null 2>&1 && ok "Twilio CLI removed" || warn "removal failed"
  fi
fi

# 4. gum
if have gum && have brew; then
  if ask "Uninstall gum (brew uninstall gum)?"; then
    brew uninstall gum >/dev/null 2>&1 && ok "gum removed" || warn "removal failed"
  fi
fi

# 5. Global skills copy
if [[ -d "$HOME/.agents/skills" ]]; then
  if ask "Remove copied skills from ~/.agents/skills/?"; then
    rm -rf "$HOME/.agents/skills" && ok "removed \$HOME/.agents/skills/" || warn "removal failed"
  fi
fi

# 6. In-repo model + runtime
if [[ -f "$ROOT/models/gemma4-e2b.gguf" || -e "$ROOT/tools/llamafile" \
   || -f "$ROOT/models/gemma4-e2b.download" || -f "$ROOT/models/gemma4-e2b-mmproj.gguf" ]]; then
  if ask "Delete the downloaded model + archive + llamafile binary in this repo?"; then
    rm -f "$ROOT/models/gemma4-e2b.gguf" "$ROOT/models/gemma4-e2b-mmproj.gguf" \
          "$ROOT/models/gemma4-e2b.download" \
          "$ROOT/tools/llamafile" "$ROOT/tools/llamafile.exe" \
      && ok "local model files removed" || warn "removal failed"
    rm -rf "$ROOT/models/extract_tmp"
  fi
fi

printf '\nDone. Note: this did NOT run "twilio logout" — your CLI profile is untouched.\n'
printf 'To fully sign out:  twilio logout\n'
