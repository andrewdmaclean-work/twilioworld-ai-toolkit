#!/usr/bin/env bash
#
# test.sh — smoke tests for the toolkit.
# Runs everything that can be checked WITHOUT a Twilio account or downloads.
#
#   ./test.sh           # static + dry-run checks (offline-safe except --check)
#   ./test.sh --no-net  # skip the URL reachability check
#
# Exit 0 = all passed.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

PASS=0; FAIL=0
check() { # $1 = description, rest = command
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  \033[32mPASS\033[0m %s\n' "$desc"; PASS=$((PASS+1))
  else
    printf '  \033[31mFAIL\033[0m %s\n' "$desc"; FAIL=$((FAIL+1))
  fi
}

echo "── Static checks ──"
check "setup.sh parses"        bash -n setup.sh
check "uninstall.sh parses"    bash -n uninstall.sh
check "start-model.sh parses"  bash -n start-model.sh
check "test.sh parses"         bash -n test.sh
if command -v shellcheck >/dev/null 2>&1; then
  check "shellcheck setup.sh"       shellcheck -S warning setup.sh
  check "shellcheck uninstall.sh"   shellcheck -S warning uninstall.sh
  check "shellcheck start-model.sh" shellcheck -S warning start-model.sh
else
  echo "  SKIP shellcheck (not installed)"
fi
if command -v jq >/dev/null 2>&1; then
  check "opencode.json valid JSON" jq empty opencode.json
else
  echo "  SKIP jq (not installed)"
fi

echo "── Structure checks ──"
check "submodule populated"           test -f vendor/twilio-ai/skills/README.md
check "executables are +x"            test -x setup.sh -a -x start-model.sh -a -x uninstall.sh
check ".gitignore ignores gguf"       grep -q 'models/\*.gguf' .gitignore
check "opencode.json has docs MCP"    grep -q 'mcp.twilio.com/docs' opencode.json
check "opencode.json has execute MCP" grep -q 'twilio-execute' opencode.json
check "opencode.json has llamafile"   grep -q 'gemma4-e2b' opencode.json
check ".gitignore ignores add-on config" grep -q '.toolkit/config.json' .gitignore
check ".gitignore ignores built-in Pi state" grep -q '.toolkit/pi-agent/' .gitignore
check "default add-ons valid JSON"      jq empty toolkit.defaults.json
check "default add-ons include Gemma"   bash -c 'jq -e ".addons.localGemma and .addons.builtInPi" toolkit.defaults.json'
check "defaults outside runtime state"  bash -c '! grep -q "^DEFAULT_CONFIG_FILE=.*\\.toolkit/defaults" toolkit.sh setup.sh configure-agent.sh'
check "jq required in setup.sh"       grep -q 'have jq' setup.sh
check "non-tty guard in setup.sh"     grep -q '\-t 0' setup.sh

echo "── Behavioural checks ──"
check "start-model errors w/o model"     bash -c '! ./start-model.sh'
check "non-tty blocked without flag"     bash -c '! (echo "" | ./setup.sh 2>/dev/null)'
check "setup --dry-run completes"        bash -c 'FORCE_TTY=1 ./setup.sh --dry-run 2>&1 | grep -q "toolkit is ready"'
check "dry-run reaches ready"            bash -c 'FORCE_TTY=1 ./setup.sh --dry-run 2>&1 | grep -q "toolkit is ready"'
check "dry-run reports skills"           bash -c 'FORCE_TTY=1 ./setup.sh --dry-run 2>&1 | grep -q "skills available"'
check "dry-run reports add-ons"          bash -c 'FORCE_TTY=1 ./setup.sh --dry-run 2>&1 | grep -q "Add-on choices"'
check "dry-run: no duplicate key msg"    bash -c '! (FORCE_TTY=1 ./setup.sh --dry-run 2>&1 | grep -q "already exists from a previous run")'
check "partial GGUF triggers re-dl warn" bash -c '
  mkdir -p models
  printf "tiny" > models/gemma4-e2b.gguf
  result=$(FORCE_TTY=1 ./setup.sh --dry-run 2>&1 || true)
  rm -f models/gemma4-e2b.gguf
  echo "$result" | grep -q "incomplete model file"
'

echo "── Security checks ──"
check "jq used for JSON — no grep -o AC" bash -c '! grep -qE "grep -o .AC" setup.sh'
check "blast-radius warning present"     grep -q 'spend limit' setup.sh
check "history warning present"          grep -q 'history' setup.sh
check "profile dump redacted"            grep -q 'accountSid\[-4:\]' setup.sh
check "Windows .exe path exists"         grep -q 'llamafile.exe' setup.sh
check "GGUF size floor defined"          grep -q 'GGUF_MIN_BYTES' setup.sh
check "build-system-prompt.js present"   test -f build-system-prompt.js
check "system prompt builds"             bash -c 'node build-system-prompt.js | grep -q "skills"'
check "routing prompt present"           grep -q 'Do not answer Twilio' .pi/routing-prompt.md
check "system prompt loads routing"      grep -q 'routing-prompt' build-system-prompt.js
check "routing survives no skills"       bash -c 'TOOLKIT_USE_SKILLS=0 node build-system-prompt.js >/dev/null && grep -q "Do not answer Twilio" models/system-prompt.txt'
check "routing teaches proxy call"       grep -q 'twilio_docs_twilio__search' .pi/routing-prompt.md
check "routing rejects MCP cache only"   grep -q 'cached tool metadata' .pi/routing-prompt.md
check "system prompt can skip skills"    grep -q 'TOOLKIT_USE_SKILLS' build-system-prompt.js
check "setup has add-on picker"          grep -q 'choose_addons' setup.sh
check "opencode install in configurator" grep -q 'anomalyco/tap/opencode' configure-agent.sh
check "pi mcp.json valid JSON"           jq empty .pi/mcp.json
check "pi mcp template inert by default" bash -c 'jq -e ".mcpServers == {}" .pi/mcp.json'
check "pi mcp uses lazy proxy default"   bash -c '! grep -q "directTools" .pi/mcp.json'
check "pi models.json valid JSON"        jq empty .pi/models.json
check "pi local model configured"        bash -c 'jq -e ".providers.llamafile.models[0].id == \"gemma4-e2b\"" .pi/models.json'
check "Pi option in configurator"        grep -q 'pi-coding-agent' configure-agent.sh
check "Pi mcp adapter referenced"        grep -q 'pi-mcp-adapter' configure-agent.sh
check "Pi launch uses local provider"    bash -c 'grep -q -- "--provider llamafile --model gemma4-e2b" toolkit.sh || (grep -q "PI_ARGS=(--provider llamafile --model gemma4-e2b" toolkit.sh)'
check "Pi launch appends routing prompt" grep -q -- '--append-system-prompt' toolkit.sh
check "local model detected from files"  grep -q 'local_model_ready' toolkit.sh
check "local model bypasses stale add-on" grep -q 'local_gemma_available' toolkit.sh
check "local model requires size floor"  grep -q 'GGUF_MIN_BYTES' toolkit.sh
check "toolkit warning helper present"  grep -q '^warn()' toolkit.sh
check "Pi docs MCP direct tools"         grep -q 'directTools: true' toolkit.sh
check "Pi docs MCP eager lifecycle"      grep -q 'lifecycle: "eager"' toolkit.sh
check "Pi launch does not force OpenAI"  bash -c '! grep -q "OPENAI_API_KEY=local\\|--provider openai" toolkit.sh'
check "Pi uses selected capabilities"    grep -q 'install_pi_selected_capabilities' toolkit.sh
check "Pi launch uses kit agent dir"     grep -q 'PI_CODING_AGENT_DIR="$PI_AGENT_DIR"' toolkit.sh
check "Pi launch isolates skills"        grep -q -- '--no-skills' toolkit.sh
check "Execute MCP requires creds"       grep -q 'TWILIO_MCP_CREDS is not set' toolkit.sh
check "configure-agent.sh parses"        bash -n configure-agent.sh
check "configure-agent.sh executable"    test -x configure-agent.sh
check "toolkit has configure agent"     grep -q 'Configure AI agent' toolkit.sh
check "toolkit has native Pi launch"    grep -q 'Open Pi agent' toolkit.sh
check "setup calls configure-agent"      grep -q 'configure-agent.sh' setup.sh

echo "── toolkit.sh checks ──"
check "toolkit.sh parses"               bash -n toolkit.sh
if command -v shellcheck >/dev/null 2>&1; then
  check "shellcheck toolkit.sh"         shellcheck -S warning toolkit.sh
fi
check "toolkit.sh is executable"        test -x toolkit.sh
check "toolkit.sh status uses jq"       grep -q 'jq -r' toolkit.sh
check "toolkit.sh has all menu items"   bash -c '
  grep -q "Setup" toolkit.sh &&
  grep -q "Open Pi agent" toolkit.sh &&
  grep -q "Chat"  toolkit.sh &&
  grep -q "model" toolkit.sh &&
  grep -q "Dev Phone" toolkit.sh &&
  grep -q "Exit"  toolkit.sh
'
check "toolkit.sh renders status"       bash -c '
  out=$(echo "" | bash toolkit.sh 2>&1 || true)
  echo "$out" | grep -q "TwilioWorld AI Toolkit"
'

if [[ "${1:-}" != "--no-net" ]]; then
  echo "── Network checks ──"
  check "download URLs resolve" bash -c './setup.sh --check'
fi

echo
echo "Passed: $PASS   Failed: $FAIL"
[[ $FAIL -eq 0 ]]
