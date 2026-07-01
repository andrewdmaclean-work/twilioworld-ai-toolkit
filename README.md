# TwilioWorld AI Toolkit

Arm your AI coding agent with deep Twilio expertise — Skills, live Docs MCP, and
optional real API execution — out of the box. Clone it, run one script, choose your
add-ons, and your agent is ready to build and run real Twilio things with no hunting
through docs and no copying configs.

**Chat with the local model right inside the TUI** — no external agent required.
Or configure any coding agent — Pi, OpenCode, Claude Code, Cursor, Codex, or your
own — and the toolkit wires up the same Skills/Docs MCP/Execute MCP knowledge layer
for it. No agent gets special treatment: pick whichever fits, from one menu.

---

## Quick start

```bash
git clone --recursive <this-repo-url>
cd twilioworld-ai-toolkit
./toolkit
```

> Use `--recursive` so the Twilio Skills submodule comes down with the clone.
> Forgot it? Setup (in the menu) runs `git submodule update --init` for you.

`./toolkit` is the command you use from the repo root. Arrow keys to navigate:

```
╔══════════════════════════════════╗
║  TwilioWorld AI Toolkit          ║
╚══════════════════════════════════╝

  ✓  Twilio CLI    primary (…e4c7)
  ✓  Skills        56 loaded
  ✗  Model file    not downloaded
  ✓  Runtime       llamafile ready
  ✓  Node          v22.19.0
  ✓  Dev Phone     installed

  What do you want to do?
  ▶ Setup — configure this machine
    Configure AI agent (Pi, OpenCode, Claude Code, Cursor, Codex…)
    Chat with local model        (in-app + API on :8080)
    Local model server only      (for tools / background)
    Dev Phone — browser soft phone (new terminal window)
    Exit
```

Setup asks which add-ons you want once, then Configure agent uses those choices
silently. The fastest path to a working agent is:

1. Run `./toolkit` → **Setup** → select your add-ons (Gemma is on by default —
   it powers in-app chat and, if you pick Pi, Pi too)
2. Back at the menu → **Chat with local model** for instant Q&A, or **Configure
   agent** → pick any agent (Pi included) to wire it up

Setup, agent configuration, local chat, and model server control all run inside the
TUI dashboard. **Pi** and **Dev Phone** are different — they're real interactive CLIs,
so choosing them opens a brand-new terminal window and runs there. The dashboard
keeps running in this window; nothing is suspended or handed over. Every agent —
Pi included — is configured through the same "Configure agent" menu item; none of
them get a dedicated menu entry or add-on toggle of their own. Pi is the one agent
the toolkit can fully install and launch for you (it needs a model to talk to and a
process to start); the others are external tools you already have, so Configure
agent prints the exact MCP-wiring command for those instead.

Your add-on choices live in `.toolkit/config.json` and are local to your machine.
If that file is removed or you reset local state, the toolkit falls back to tracked
defaults in `toolkit.defaults.json` — local Gemma (for in-app chat) stays on. The
local model is also detected from the actual `models/gemma4-e2b.gguf` and
`tools/llamafile` files, so resetting `.toolkit/` does not make a downloaded model
disappear from the menu.

---

## What's in the toolkit

| Tool | What it does |
| --- | --- |
| **Twilio Skills** | 48+ skill files that teach your agent which Twilio product to use, in what order, and what to avoid. |
| **Docs MCP** | Your agent searches the live Twilio API surface (1,800+ endpoints) and pulls exact schemas. No auth. |
| **Execute MCP** *(experimental)* | Your agent **calls real Twilio APIs** — "send a text to my phone" just works. Uses a scoped API key. |
| **Gemma 4 E2B (local)** | A free, offline model via [llamafile](https://github.com/mozilla-ai/llamafile). Serves an OpenAI-compatible API on `:8080` — powers in-app chat and, if selected, Pi. |
| **Voice input** *(coming soon)* | `Ctrl+R` is wired inside Chat and reports the planned local speech-to-text flow. Whisper model installation is not enabled yet. |
| **Twilio CLI** | The command line to all things Twilio, logged in and ready. |
| **Dev Phone** | A browser soft phone — make/receive real SMS + voice with no physical device. |
| **Pi** *(one of several agent options)* | [Pi](https://pi.dev) is the one agent the toolkit can fully install, wire, and launch for you — Configure agent → Pi does everything in one step. |

### Add-ons

The base toolkit gives you the menu and repo-local assets. Add-ons decide what gets
installed and silently attached when you configure an agent:

| Add-on | What it unlocks | Default |
| --- | --- | --- |
| Local Gemma model | Powers in-app chat; also serves `http://127.0.0.1:8080/v1` for other tools (including Pi) | ✓ on |
| Voice input | Keeps the `Ctrl+R` voice entry point visible in Chat while local Whisper support is completed | ✓ on |
| Twilio Skills | Agent Twilio knowledge — 48+ procedural skill files | ✓ on |
| Docs MCP | Searchable live Twilio API reference (no auth) | ✓ on |
| Execute MCP | Real Twilio API calls from the agent | off |
| Dev Phone | Browser SMS/voice test phone | off |

There's no "which agent do I use" add-on — that's not a machine-wide setting, it's
a choice you make each time you open Configure agent. Skills and MCP add-ons attach
to whichever agent you configure, if you selected them.

---

## Prerequisites

- **Node.js**, **git**, **curl** (the script checks these)
- A **Twilio account** (only needed for Execute MCP and Dev Phone add-ons)
- ~2.5 GB free disk if you want the local Gemma model
- `rec` from SoX, `ffmpeg`, or `arecord` will be needed for the coming-soon microphone voice input

The toolkit can install the Twilio CLI, Dev Phone plugin, Pi, OpenCode, llamafile
runtime, and local Gemma model files when those add-ons are selected. Voice input
does not download whisperfile or Whisper weights yet.

---

## What the setup does

1. **Prerequisites** — verifies node, git, curl.
2. **Twilio CLI** — installs if needed for Execute MCP or Dev Phone, then checks for an active login.
3. **API key** — mints a scoped key via `twilio api:core:keys:create` for the Execute MCP, so your root Auth Token never lands in a config string.
4. **Local model** — downloads the llamafile runtime + Gemma 4 E2B weights only if selected.
5. **Voice input** — marks the OpenTUI `Ctrl+R` entry point as coming soon and checks future recorder availability.
6. **Dev Phone** — installs the plugin only if selected.
7. **Skills** — initializes the submodule and installs skills globally if the add-on is enabled.

Then it verifies your credentials with a real API call and prints a cheat sheet.

---

## Per-agent setup

The toolkit uses each agent's **native** install path — nothing proprietary. All
five are configured the same way: `./toolkit` → **Configure agent** → pick one.

### Claude Code
```text
/plugin marketplace add twilio/ai
/plugin install twilio-developer-kit@twilio
claude mcp add twilio-docs --transport http https://mcp.twilio.com/docs
```

### Codex
Open **Plugins**, install "Twilio developer kit", then:
```bash
codex mcp add twilio-docs --url https://mcp.twilio.com/docs
```

### Cursor
```text
/add-plugin twilio-developer-kit
```
Add the Execute MCP under **Cursor Settings > MCP**.

### OpenCode

`opencode.json` (in this repo) defines both MCP servers, committed with static
defaults that match the toolkit's own defaults: Docs MCP on, Execute MCP off.
This file is never modified by the toolkit — if your add-on choices differ
from those defaults, Configure agent prints an `OPENCODE_CONFIG_CONTENT`
override for you rather than rewriting the tracked file. For serious agent
work, pick a cloud model with `/connect` inside OpenCode (Anthropic, OpenAI,
or OpenCode Zen).

> **Local Gemma E2B + tool calling:** the local model has tool calling enabled, but
> it's a 2B edge model. It works with a *small* number of tools attached. If you point
> it at the full Twilio **Docs MCP** (a large tool surface) it can get slow or stall.
> For local tool use, enable only the **Execute MCP** and disable Docs MCP.
> For heavy multi-tool agent work, use a cloud model.

To enable the Execute MCP:

```bash
export TWILIO_MCP_CREDS="ACxxx/SKxxx:secret"   # printed during setup

# If you enabled Execute MCP as an add-on, Configure agent will have printed
# an override like this (opencode.json's committed default stays off):
export OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json","mcp":{"twilio-execute":{"enabled":true}}}'
```

### Pi

The only one of the five the toolkit can fully install, wire, **and launch** for
you — it needs a model to talk to (local Gemma) and a process started, so Configure
agent does all of that in one step and opens Pi in a brand-new terminal window:

```bash
./toolkit
# choose: Configure agent → Pi
```

That single step:
- installs Pi if it isn't on PATH yet
- starts the local Gemma service if it isn't running
- attaches your selected Skills, Docs MCP, and/or Execute MCP automatically
- opens Pi in a brand-new terminal window — the dashboard keeps running in this one

> **Requires Node ≥ 22.19.0.** Node 18/20 crash Pi. Run `nvm use 22` first if needed —
> Configure agent will tell you if your Node version is too old.

Pi is intentionally lightweight. It is the right tool for focused Twilio tasks, quick
questions, and iterating on code, with no API key required. For long multi-tool agent
runs with heavy context, use a cloud-backed agent (OpenCode + Anthropic/OpenAI is the
recommended pairing) — or just use **Chat with local model** from the menu for quick
Twilio Q&A without installing Pi at all.

**Manual launch** (Configure agent is simpler):

```bash
# Start "Model server" from the TUI first.
PI_CODING_AGENT_DIR="$PWD/.toolkit/pi-agent" \
  pi --provider llamafile --model gemma4-e2b \
     --append-system-prompt .pi/routing-prompt.md
```

---

## Bring your own agent

Everything is built on open standards — [MCP](https://modelcontextprotocol.io) and
[Agent Skills](https://agentskills.io). Any compatible agent can use the toolkit:

```text
Docs MCP (HTTP, no auth):
    https://mcp.twilio.com/docs

Execute MCP (experimental, stdio):
    npx -y @twilio-alpha/mcp@0.6.0 "ACxxx/SKxxx:secret"

Skills (make them global):
    cp -r vendor/twilio-ai/skills/ ~/.agents/skills/

Local model (OpenAI-compatible):
    http://127.0.0.1:8080/v1   (choose Model server in the TUI)
```

Verified-compatible: Claude Code, Cursor, Codex, OpenCode, Pi, GitHub Copilot,
Gemini CLI, JetBrains Junie, and 30+ more.

---

## The local model

```bash
./toolkit                  # choose "Chat with local model" or "Model server"
CTX_SIZE=8192 ./toolkit    # larger context if you need it (~2.5 GB RAM)
```

Powered by [llamafile](https://github.com/mozilla-ai/llamafile) (Mozilla) — a single
executable. The TUI starts the local OpenAI-compatible server in the background and
renders chat inside the OpenTUI dashboard, so the toolkit does not appear to exit
when you choose **Chat with local model**. Tools (OpenCode, Cursor, etc.) can connect
to `http://127.0.0.1:8080/v1` at the same time.

The in-app chat starts the local server with reasoning disabled and supports a small
safe tool surface for toolkit introspection: readiness/status, selected add-ons, and
vendored Twilio Skill listing. It does **not** call real Twilio APIs from chat; use
the Execute MCP in a configured agent for that.

Voice input is wired but coming soon. In Chat, `Ctrl+R` is already handled inside
OpenTUI and shows a controlled message instead of exiting, spawning a legacy prompt,
or attempting a missing model download.

The planned local flow follows Mozilla's whisperfile getting-started shape:
`tools/whisperfile -m models/whisper-tiny.en-q5_1.bin -f <audio> --no-prints`.
Setup intentionally does not download whisperfile or the Whisper weights until the
feature is ready end to end.

**Memory footprint:** the model runs with a 4 096-token context window and a
quantized KV cache (`q4_0`), keeping runtime RAM around **~1.5 GB**. That covers
the full Twilio Skills system prompt plus several turns of conversation comfortably.
Override the context window with `CTX_SIZE=<n>` if a task needs more room.

It loads a Twilio system prompt built from the Skills index, so the local model
answers Twilio questions with the right context. Multimodal (text + image), runs on
a laptop. Great for quick Q&A — too small to drive a full tool-calling agent, so
point OpenCode/Cursor at a cloud model for that.

---

## Cheat sheet

```bash
twilio dev-phone        # browser soft phone — USE A SPARE NUMBER (overwrites webhooks)
./toolkit               # run Gemma 4 E2B locally from the menu
twilio --help           # explore the CLI
```

---

## What this touches on your system

Host-native by design — your AI agent, browser (for Dev Phone), and GPU/Metal
acceleration all live on your machine, so the toolkit installs there rather than in a
container. The footprint is small and fully reversible:

| Added | Where | Removed by |
| --- | --- | --- |
| Twilio CLI | npm global | `uninstall.sh` |
| Dev Phone plugin | Twilio CLI plugins | `uninstall.sh` |
| Scoped API key | your Twilio account | `uninstall.sh` |
| Skills copy | `~/.agents/skills/` | `uninstall.sh` |
| llamafile + model | `tools/`, `models/` (in this repo) | `uninstall.sh` |
| voice input | coming soon; no setup download yet | n/a |

```bash
./uninstall.sh         # reverse everything, with a confirmation per item
```

`uninstall.sh` never runs `twilio logout` — your CLI profile stays put unless you
ask for it.

> Want full isolation anyway? Run the repo inside a devcontainer/VM — but note
> Dev Phone needs browser + port access and llamafile won't get GPU acceleration
> in Docker on macOS, so the host-native path is recommended.

---

## Testing

```bash
./test.sh              # static + structure + dry-run checks (no Twilio account needed)
./test.sh --no-net     # skip URL reachability checks
```

`./test.sh` runs in CI on every push (see `.github/workflows/test.yml`). It needs
no Twilio account — login, key-minting, and live API calls are exercised only when
you run Setup with Execute MCP or Dev Phone selected.

---

## Notes & caveats

- **Execute MCP is experimental** (Twilio Alpha). Great for building, pre-GA.
- **Dev Phone overwrites a number's webhooks** — never point it at a production number.
- **`TWILIO_MCP_CREDS`** — persist across sessions by adding to a local `.env` file
  (gitignored): `echo 'export TWILIO_MCP_CREDS="..."' >> .env && source .env`
- Model weights plus local runtime binaries are git-ignored. Setup currently
  downloads Gemma/llamafile only; voice runtime paths are reserved for the
  coming-soon Whisper work.

---

Built on [github.com/twilio/ai](https://github.com/twilio/ai) ·
[Twilio MCP docs](https://www.twilio.com/docs/ai/mcp) ·
[Twilio Skills docs](https://www.twilio.com/docs/ai/skills)
