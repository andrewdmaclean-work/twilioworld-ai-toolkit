#!/usr/bin/env bash
#
# test.sh — smoke tests for the TwilioWorld Agentic Coding Toolkit.
# All logic now lives in tui/src/. No bash scripts to parse or dry-run.
#
#   ./test.sh           # all checks (offline-safe except --net)
#   ./test.sh --no-net  # skip URL reachability check
#
# Exit 0 = all passed.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

PASS=0; FAIL=0
check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  \033[32mPASS\033[0m %s\n' "$desc"; PASS=$((PASS+1))
  else
    printf '  \033[31mFAIL\033[0m %s\n' "$desc"; FAIL=$((FAIL+1))
  fi
}

echo "── Entry point ──"
check "toolkit entry exists"          test -f toolkit
check "toolkit is executable"         test -x toolkit
check "toolkit invokes OpenTUI"       grep -q 'bun run src/index.ts' toolkit

echo "── TypeScript project ──"
if command -v bun >/dev/null 2>&1; then
  check "bun install succeeds"          bash -c 'cd tui && bun install --frozen-lockfile 2>/dev/null || bun install'
  check "tsc --noEmit passes"           bash -c 'cd tui && bunx tsc --noEmit -p tsconfig.json'
  check "tui boots without crash"       bash -c '
    cd tui
    TOOLKIT_TUI_SMOKE=1 bun run src/index.ts > /tmp/tui-boot-test.log 2>&1
    grep -q "TwilioWorld\|Skills\|Twilio CLI" /tmp/tui-boot-test.log
  '
else
  echo "  SKIP bun checks (bun not installed)"
fi

echo "── Structure ──"
check "submodule populated"           test -f vendor/twilio-ai/skills/README.md
check ".gitignore ignores gguf"       grep -q 'models/\*.gguf' .gitignore
check ".gitignore ignores add-on config" grep -q '.toolkit/config.json' .gitignore
check ".gitignore ignores Pi state"   grep -q '.toolkit/pi-agent/' .gitignore
check "opencode.json valid JSON"      bash -c 'command -v jq && jq empty opencode.json || python3 -c "import json,sys; json.load(open(\"opencode.json\"))"'
check "opencode.json has docs MCP"    grep -q 'mcp.twilio.com/docs' opencode.json
check "opencode.json has execute MCP" grep -q 'twilio-execute' opencode.json
check "opencode.json has llamafile"   grep -q 'gemma4-e2b' opencode.json
check "defaults valid JSON"           bash -c 'command -v jq && jq empty toolkit.defaults.json || python3 -c "import json,sys; json.load(open(\"toolkit.defaults.json\"))"'
check "defaults have Gemma on, no Pi add-on" bash -c 'command -v jq && jq -e ".addons.localGemma and (.addons | has(\"builtInPi\") | not)" toolkit.defaults.json || python3 -c "import json; d=json.load(open(\"toolkit.defaults.json\")); assert d[\"addons\"][\"localGemma\"] and \"builtInPi\" not in d[\"addons\"]"'
check "builtInPi removed from config schema" bash -c '! grep -q "builtInPi" tui/src/lib/config.ts'

echo "── Library modules ──"
check "constants.ts exists"           test -f tui/src/lib/constants.ts
check "config.ts exists"              test -f tui/src/lib/config.ts
check "exec.ts exists"                test -f tui/src/lib/exec.ts
check "setup.ts exists"               test -f tui/src/lib/setup.ts
check "configure-agent.ts exists"     test -f tui/src/lib/configure-agent.ts
check "model.ts exists"               test -f tui/src/lib/model.ts
check "pi.ts exists"                  test -f tui/src/lib/pi.ts

echo "── Correctness checks ──"
check "constants has GGUF_MIN_BYTES"  grep -q 'GGUF_MIN_BYTES' tui/src/lib/constants.ts
check "constants has llamafile URL"   grep -q 'llamafile' tui/src/lib/constants.ts
check "constants has whisperfile URL" grep -q 'WHISPERFILE_URL' tui/src/lib/constants.ts
check "constants has GGUF URL"        grep -q 'kaggle' tui/src/lib/constants.ts
check "setup checks prerequisites"   grep -q 'node.*git.*curl' tui/src/lib/setup.ts
check "setup handles model download"  grep -q 'GGUF_STAGING' tui/src/lib/setup.ts
check "setup has blast-radius warning" grep -q 'spend limit' tui/src/lib/setup.ts
check "setup never prints secret to log" bash -c '! grep -q "SHOWN ONCE" tui/src/lib/setup.ts'
check "setup has GGUF size check"     grep -q 'GGUF_MIN_BYTES' tui/src/lib/setup.ts
check "setup handles Windows path"    grep -q 'llamafile.exe\|win32' tui/src/lib/constants.ts
check "configure-agent pins pi package" grep -q 'PI_AGENT_PKG' tui/src/lib/configure-agent.ts
check "configure-agent has Pi MCP adapter" grep -q 'pi-mcp-adapter' tui/src/lib/pi.ts
check "configure-agent has OpenCode"  grep -q 'anomalyco/tap/opencode' tui/src/lib/configure-agent.ts
check "opencode.json never written by toolkit" bash -c '! grep -q "writeFileSync" tui/src/lib/configure-agent.ts'
check "opencode drift uses OPENCODE_CONFIG_CONTENT" grep -q 'OPENCODE_CONFIG_CONTENT' tui/src/lib/configure-agent.ts
check "pi.ts uses routing prompt"     grep -q 'PI_ROUTING_PROMPT\|routing-prompt' tui/src/lib/pi.ts
check "pi.ts uses --no-skills"        grep -q '\-\-no-skills' tui/src/lib/pi.ts
check "pi.ts uses --provider llamafile" grep -q 'llamafile' tui/src/lib/pi.ts
check "pi-mcp has directTools"        grep -q 'directTools' tui/src/lib/pi-mcp.ts
check "pi-mcp has eager lifecycle"    grep -q 'eager' tui/src/lib/pi-mcp.ts
check "pi-mcp has execute mcp guard"  grep -q 'TWILIO_MCP_CREDS' tui/src/lib/pi-mcp.ts
check "model.ts has server args"      grep -q 'serverArgs\|--server' tui/src/lib/model.ts
check "model starts reasoning off"    bash -c 'grep -q "\"--reasoning\", \"off\"" tui/src/lib/model.ts && grep -q "\"--reasoning-budget\", \"0\"" tui/src/lib/model.ts'
check "voice module uses whisperfile" bash -c 'grep -q "transcribeVoiceFile" tui/src/lib/voice.ts && grep -q "WHISPERFILE_DEST" tui/src/lib/voice.ts'
check "voice uses documented whisper args" bash -c 'grep -q "\"-m\", q(WHISPER_MODEL_DEST)" tui/src/lib/voice.ts && grep -q "\"--no-prints\"" tui/src/lib/voice.ts'
check "voice input is gated coming soon" bash -c 'grep -q "VOICE_COMING_SOON" tui/src/lib/voice.ts && grep -q "Whisper model is not bundled yet" tui/src/lib/voice.ts'
check "setup hides unfinished voice input" bash -c '! grep -q "Voice input — coming soon" tui/src/lib/setup.ts && ! grep -q "Planned command" tui/src/lib/setup.ts'
check "chat stays inside OpenTUI"     bash -c 'grep -q "buildChatScreen" tui/src/index.ts && ! grep -RIn "combinedArgs\\|chatArgs\\|--chat" tui/src 2>/dev/null'
check "chat enter sends message"      bash -c 'grep -q "InputRenderableEvents.ENTER" tui/src/screens/chat.ts && ! grep -q "input.onSubmit" tui/src/screens/chat.ts'
check "chat supports tool calls"      bash -c 'grep -q "CHAT_TOOLS" tui/src/screens/chat.ts && grep -q "tool_choice" tui/src/screens/chat.ts && grep -q "runChatTool" tui/src/screens/chat.ts'
check "chat disables markdown replies" bash -c 'grep -q "plainTextChatResponse" tui/src/screens/chat.ts && grep -q "plain text only" tui/src/screens/chat.ts && grep -q "Do not use Markdown" tui/src/screens/chat.ts'
check "chat hides unfinished voice shortcut" bash -c 'grep -q "isVoiceShortcut" tui/src/screens/chat.ts && grep -q "key.ctrl" tui/src/screens/chat.ts && ! grep -q "Ctrl+R voice input is wired" tui/src/screens/chat.ts'
check "chat transcript scroll is wired" bash -c 'grep -q "isTranscriptScrollKey" tui/src/screens/chat.ts && grep -q "transcript.handleKeyPress" tui/src/screens/chat.ts && grep -q "pageup" tui/src/screens/chat.ts'
check "chat can read skills"         bash -c 'grep -q "search_twilio_skills" tui/src/lib/chat-tools.ts && grep -q "read_twilio_skill" tui/src/lib/chat-tools.ts'
check "chat can use docs MCP"        bash -c 'grep -q "search_twilio_docs_mcp" tui/src/lib/chat-tools.ts && grep -q "twilio__search" tui/src/lib/chat-tools.ts && grep -q "twilio__retrieve" tui/src/lib/chat-tools.ts'
check "index.ts has all menu items"   bash -c '
  grep -q '"'"'chat'"'"' tui/src/index.ts &&
  grep -q '"'"'server'"'"' tui/src/index.ts &&
  grep -q '"'"'devphone'"'"' tui/src/index.ts &&
  grep -q '"'"'setup'"'"' tui/src/index.ts &&
  grep -q '"'"'agent'"'"' tui/src/index.ts &&
  grep -q '"'"'signup'"'"' tui/src/index.ts &&
  grep -q '"'"'aidocs'"'"' tui/src/index.ts &&
  grep -q '"'"'uninstall'"'"' tui/src/index.ts
'
check "signup opens TwilioWorld" bash -c '
  grep -q "Sign up for TwilioWorld" tui/src/index.ts &&
  grep -q "https://twilio.world" tui/src/index.ts &&
  grep -q "export function openUrl" tui/src/lib/exec.ts
'
check "Twilio AI Docs quick link wired" bash -c '
  grep -q "Twilio AI Docs" tui/src/index.ts &&
  grep -q "https://www.twilio.com/docs/ai" tui/src/index.ts
'
check "agent picker offers GitHub Copilot" grep -q "GitHub Copilot" tui/src/screens/agent.ts
check "README links Twilio AI docs" grep -q "https://www.twilio.com/docs/ai)" README.md
check "terminal easter egg is wired" bash -c '
  grep -q "buildInvadersScreen" tui/src/index.ts &&
  grep -q "Signal Invaders" tui/src/screens/invaders.ts &&
  grep -q "screen.focusable = true" tui/src/screens/invaders.ts &&
  grep -q "konamiSecret" tui/src/index.ts &&
  grep -q "typedSecret = \"twilio\"" tui/src/index.ts
'
check "README mirrors dashboard labels" bash -c '
  grep -q "Actions" README.md &&
  grep -q "Install Choices" README.md &&
  grep -q "Selected Action" README.md &&
  grep -q "Sign up for TwilioWorld" README.md &&
  grep -q "TwilioWorld Agentic Coding Toolkit" README.md &&
  grep -q "twilioworld-agentic-coding-toolkit" README.md
'
check "uninstall available from TUI" bash -c '
  grep -q "buildUninstallScreen" tui/src/index.ts &&
  grep -q "runUninstall" tui/src/lib/uninstall.ts &&
  grep -q "Uninstall" tui/src/screens/uninstall.ts
'
check "no dedicated Pi menu item"     bash -c '! grep -q "case \"pi\"" tui/src/index.ts'
check "index.ts has ASCII wordmark banner" bash -c '
  grep -q "ASCIIFontRenderable" tui/src/index.ts &&
  grep -q "\"TwilioWorld\"" tui/src/index.ts &&
  grep -q "font: \"tiny\"" tui/src/index.ts &&
  grep -q "banner.visible" tui/src/index.ts
'
check "agent picker has no Pi favoritism" bash -c '! grep -iq "recommended\|built-in" tui/src/screens/agent.ts'
check "configure-agent launches Pi via lib/pi.ts" grep -q 'launchPi' tui/src/lib/configure-agent.ts
check "configure-agent auto-installs Claude/Codex/Cursor/Copilot" bash -c '
  grep -q "@anthropic-ai/claude-code" tui/src/lib/configure-agent.ts &&
  grep -q "@openai/codex" tui/src/lib/configure-agent.ts &&
  grep -q "cursor-cli" tui/src/lib/configure-agent.ts &&
  grep -q "@github/copilot" tui/src/lib/configure-agent.ts
'
check "all non-Pi agents share configureStandardAgent" bash -c '
  grep -q "async function configureStandardAgent" tui/src/lib/configure-agent.ts &&
  [ "$(grep -c "await configureStandardAgent(" tui/src/lib/configure-agent.ts)" -eq 5 ]
'
check "configureStandardAgent launches every agent in a new window" bash -c '
  grep -q "openInNewWindow(spec.bin" tui/src/lib/configure-agent.ts
'
check "OpenCode no longer print-only (launches like the rest)" bash -c '
  ! grep -q "rather than.*opening a new window" tui/src/lib/configure-agent.ts
'
check "index uses openInNewWindow"    bash -c 'grep -q "openInNewWindow" tui/src/index.ts && grep -q "openInNewWindow" tui/src/lib/pi.ts'
check "no suspend/resume left in index" bash -c '! grep -q "renderer.suspend\|renderer.resume" tui/src/index.ts'
check "exec.ts has new-window opener" grep -q 'export function openInNewWindow' tui/src/lib/exec.ts
check "no gum references remain"      bash -c '! grep -RIn "\bgum\b" README.md uninstall.sh tui/src tui/package.json 2>/dev/null'
check "no plain UI fallback remains"  bash -c '! grep -RIn "src/plain\|TOOLKIT_PLAIN\|--plain" toolkit tui/src tui/package.json 2>/dev/null'
check "no legacy route purple remains" bash -c '! grep -RIn "C084FC\|3B2A52" tui/src 2>/dev/null'
check "no legacy shell scripts remain" bash -c '! ls setup.sh configure-agent.sh start-model.sh toolkit.sh toolkit-tui.sh build-system-prompt.js 2>/dev/null | grep -q .'

echo "── Security audit fixes ──"
check "E-11 context window raised (model.ts)"      grep -q '"32768"' tui/src/lib/model.ts
check "E-11 context window raised (pi models.json)" bash -c 'command -v jq && jq -e ".providers.llamafile.models[0].contextWindow == 32768" .pi/models.json || python3 -c "import json; d=json.load(open(\".pi/models.json\")); assert d[\"providers\"][\"llamafile\"][\"models\"][0][\"contextWindow\"] == 32768"'
check "E-11 context window raised (opencode.json)"  bash -c 'command -v jq && jq -e ".provider.llamafile.models[\"gemma4-e2b\"].limit.context == 32768" opencode.json || python3 -c "import json; d=json.load(open(\"opencode.json\")); assert d[\"provider\"][\"llamafile\"][\"models\"][\"gemma4-e2b\"][\"limit\"][\"context\"] == 32768"'
check "E-2/M-3 curl downloads resume + bound redirects" bash -c 'grep -q "curlDownloadArgs" tui/src/lib/setup.ts && grep -q "\-\-max-redirs" tui/src/lib/setup.ts && grep -q "\"-C\", \"-\"" tui/src/lib/setup.ts'
check "E-8/H-4 root guard in index.ts" grep -q 'assertNotRoot' tui/src/index.ts
check "E-8/H-4 root guard in toolkit entry" bash -c 'grep -q "EUID" toolkit && grep -q "should not be run as root" toolkit'
check "C-1/H-3 magic-byte check before chmod +x" grep -q 'looksLikeExecutable' tui/src/lib/setup.ts
check "C-2/H-1/H-2 creds written chmod 600, not printed" bash -c 'grep -q "writeMcpCredsFile" tui/src/lib/setup.ts && grep -q "0o600" tui/src/lib/setup.ts && ! grep -q "TWILIO_MCP_CREDS=\${mcpCreds}" tui/src/lib/setup.ts'
check "C-3 extraction uses mkdtemp, not predictable path" bash -c 'grep -q "mkdtempSync" tui/src/lib/setup.ts && ! grep -q "extract_tmp" tui/src/lib/setup.ts'
check "C-4 creds format validated"    grep -q 'looksLikeMcpCreds' tui/src/lib/setup.ts
check "M-1 PORT/CTX_SIZE validated"   grep -q 'validDigits' tui/src/lib/model.ts
check "M-2 umask set in setup"        grep -q 'process.umask' tui/src/lib/setup.ts
check "L-1 pi package version pinned" grep -q 'PI_AGENT_PKG = "@earendil-works/pi-coding-agent@' tui/src/lib/constants.ts

echo "── Pi config files ──"
check "pi mcp.json valid JSON"        bash -c 'command -v jq && jq empty .pi/mcp.json || python3 -c "import json; json.load(open(\".pi/mcp.json\"))"'
check "pi mcp template inert"         bash -c 'command -v jq && jq -e ".mcpServers == {}" .pi/mcp.json || python3 -c "import json; assert json.load(open(\".pi/mcp.json\"))[\"mcpServers\"] == {}"'
check "pi models.json valid JSON"     bash -c 'command -v jq && jq empty .pi/models.json || python3 -c "import json; json.load(open(\".pi/models.json\"))"'
check "pi local model configured"     bash -c 'command -v jq && jq -e '"'"'.providers.llamafile.models[0].id == "gemma4-e2b"'"'"' .pi/models.json || python3 -c "import json; d=json.load(open(\".pi/models.json\")); assert d[\"providers\"][\"llamafile\"][\"models\"][0][\"id\"] == \"gemma4-e2b\""'
check "routing prompt present"        grep -q 'Do not answer Twilio' .pi/routing-prompt.md

if [[ "${1:-}" != "--no-net" ]]; then
  echo "── Network ──"
  check "llamafile URL resolves" bash -c '
    url="https://github.com/mozilla-ai/llamafile/releases/download/0.10.3/llamafile-0.10.3"
    curl -fsIL "$url" >/dev/null 2>&1
  '
  check "whisperfile URL resolves" bash -c '
    url="https://github.com/mozilla-ai/llamafile/releases/download/0.10.3/whisperfile-0.10.3"
    curl -fsIL "$url" >/dev/null 2>&1
  '
fi

echo
echo "Passed: $PASS   Failed: $FAIL"
[[ $FAIL -eq 0 ]]
