# TwilioWorld AI Toolkit

> **🚀 Try the new terminal UI (in progress):** there's a full interactive TUI
> version of this toolkit — in-app chat with a local model, one-menu agent
> setup for Pi/OpenCode/Claude Code/Cursor/Codex, Dev Phone, and more — on the
> [`opentui-prototype`](../../tree/opentui-prototype) branch. To try it:
> ```bash
> git clone --recursive -b opentui-prototype <this-repo-url>
> cd twilioworld-ai-toolkit
> ./toolkit
> ```
> The instructions below are for the current `main` (shell-script) version.

Arm your AI coding agent with deep Twilio expertise — Skills, live Docs MCP, and
optional real API execution — out of the box. Clone it, run one script, choose your
add-ons, and your agent is ready to build and run real Twilio things with no hunting
through docs and no copying configs.

**Pi is included as a first-class built-in agent.** One menu option launches a
fully-configured [Pi](https://pi.dev) session with the local Gemma model, Twilio Skills,
and your selected MCP servers already attached — no manual wiring. Bring your own
cloud agent (OpenCode, Claude Code, Cursor, Codex) or use the built-in Pi; either way
the same Twilio knowledge layer powers it.

---

## Quick start

```bash
git clone --recursive <this-repo-url>
cd twilioworld-escape-room
./toolkit.sh
```

> Use `--recursive` so the Twilio Skills submodule comes down with the clone.
> Forgot it? Setup (in the menu) runs `git submodule update --init` for you.

`./toolkit.sh` is the only command you need. Arrow keys to navigate:

```
╔══════════════════════════════════╗
║  TwilioWorld AI Toolkit          ║
╚══════════════════════════════════╝

  ✓  Twilio CLI    primary (…e4c7)
  ✓  Skills        56 loaded
  ✗  Local model   not downloaded
  ✓  Dev Phone     installed
  ✓  OpenCode      1.17.11
  ✓  Pi            installed

  What do you want to do?
  ▶ Setup — configure this machine
    Configure AI agent (OpenCode, Pi, Cursor…)
    Open Pi agent               (selected add-ons)
    Chat with local model        (terminal + API on :8080)
    Local model server only      (for tools / background)
    Dev Phone — browser soft phone
    Exit
```

Setup asks which add-ons you want once, then the menu and agent launchers use
those choices silently. The fastest path to a working agent is:

1. Run `./toolkit.sh` → **Setup** → select your add-ons (Pi + Gemma are on by default)
2. Back at the menu → **Open Pi agent** — Pi launches with everything attached

Everything else (`setup.sh`, `start-model.sh`, `build-system-prompt.js`) is an
implementation detail called by the menu — you don't need to run them directly.

Your add-on choices live in `.toolkit/config.json` and are local to your machine.
If that file is removed or you reset local state, the toolkit falls back to tracked
defaults in `toolkit.defaults.json`, which keep the built-in Pi + local Gemma
experience available. The local model is also detected from the actual
`models/gemma4-e2b.gguf` and `tools/llamafile` files, so resetting `.toolkit/`
does not make a downloaded model disappear from the menu.

---

## What's in the toolkit

| Tool | What it does |
| --- | --- |
| **Pi (built-in agent)** | A zero-setup [Pi](https://pi.dev) agent session, pre-wired to the local Gemma model and your selected Skills/MCP. One menu tap to launch. |
| **Twilio Skills** | 48+ skill files that teach your agent which Twilio product to use, in what order, and what to avoid. |
| **Docs MCP** | Your agent searches the live Twilio API surface (1,800+ endpoints) and pulls exact schemas. No auth. |
| **Execute MCP** *(experimental)* | Your agent **calls real Twilio APIs** — "send a text to my phone" just works. Uses a scoped API key. |
| **Gemma 4 E2B (local)** | A free, offline model via [llamafile](https://github.com/mozilla-ai/llamafile). Powers the built-in Pi agent and serves an OpenAI-compatible API on `:8080` for any other tool. |
| **Twilio CLI** | The command line to all things Twilio, logged in and ready. |
| **Dev Phone** | A browser soft phone — make/receive real SMS + voice with no physical device. |

### Add-ons

The base toolkit gives you the menu and repo-local assets. Add-ons decide what gets
installed and silently attached when you launch an agent:

| Add-on | What it unlocks | Default |
| --- | --- | --- |
| Built-in Pi agent | One-tap local agent — select add-ons attach automatically | ✓ on |
| Local Gemma model | Powers Pi; also serves `http://127.0.0.1:8080/v1` for other tools | ✓ on |
| Twilio Skills | Agent Twilio knowledge — 48+ procedural skill files | ✓ on |
| Docs MCP | Searchable live Twilio API reference (no auth) | ✓ on |
| Execute MCP | Real Twilio API calls from the agent | off |
| Dev Phone | Browser SMS/voice test phone | off |

Built-in Pi and Local Gemma are coupled — enabling Pi enables Gemma automatically.
Skills and MCP add-ons attach to Pi only if you selected them.

---

## Prerequisites

- **Node.js**, **git**, **curl** (the script checks these)
- A **Twilio account** (only needed for Execute MCP and Dev Phone add-ons)
- ~2.5 GB free disk if you want the local Gemma model

The script auto-installs the Twilio CLI, `gum` (nicer UI), `jq`, Dev Phone, and
llamafile for you.

---

## What the setup does (7 steps)

1. **Prerequisites** — verifies node, git, curl.
2. **Twilio CLI** — installs if needed, then `twilio login`. Skipped automatically if you only selected Skills and/or Docs MCP.
3. **API key** — mints a scoped key via `twilio api:core:keys:create` for the Execute MCP, so your root Auth Token never lands in a config string.
4. **AI agent** — pick OpenCode / Pi / Claude Code / Cursor / Codex / **Other**. Wires MCP + skills the native way for each. Skippable — re-run any time from the menu.
5. **Local model** — downloads the llamafile runtime + Gemma 4 E2B weights only if selected.
6. **Dev Phone** — installs the plugin only if selected.
7. **Skills** — initializes the submodule and installs skills globally if the add-on is enabled.

Then it verifies your credentials with a real API call and prints a cheat sheet.

---

## Per-agent setup

The toolkit uses each agent's **native** install path — nothing proprietary.

### Pi (built-in — zero extra setup)

[Pi](https://pi.dev) is the toolkit's first-class built-in agent. It is selected by
default in Setup, and launching it from the menu requires no manual configuration:

```bash
./toolkit.sh
# choose: Open Pi agent
```

That's it. The menu:
- starts the local Gemma service if it isn't running
- installs Pi if needed
- attaches your selected Skills, Docs MCP, and/or Execute MCP automatically
- opens the Pi session

> **Requires Node ≥ 22.19.0.** Node 18/20 crash Pi. Run `nvm use 22` first if needed —
> the menu will tell you if your Node version is too old.

Pi is intentionally lightweight. It is the right tool for focused Twilio tasks, quick
questions, and iterating on code. For long multi-tool agent runs with heavy context,
use a cloud-backed agent (OpenCode + Anthropic/OpenAI is the recommended pairing).

**Manual launch** (the menu is simpler):

```bash
./start-model.sh --server   # in another terminal
PI_CODING_AGENT_DIR="$PWD/.toolkit/pi-agent" \
  pi --provider llamafile --model gemma4-e2b \
     --append-system-prompt .pi/routing-prompt.md
```

### OpenCode

`opencode.json` (in this repo) defines both MCP servers. For serious agent work,
pick a cloud model with `/connect` inside OpenCode (Anthropic, OpenAI, or OpenCode Zen).

> **Local Gemma E2B + tool calling:** the local model has tool calling enabled, but
> it's a 2B edge model. It works with a *small* number of tools attached. If you point
> it at the full Twilio **Docs MCP** (a large tool surface) it can get slow or stall.
> For local tool use, enable only the **Execute MCP** and disable Docs MCP.
> For heavy multi-tool agent work, use a cloud model.

To enable the Execute MCP:

```bash
export TWILIO_MCP_CREDS="ACxxx/SKxxx:secret"   # printed during setup
# opencode.json already has twilio-execute.enabled = true if you selected the add-on
```

### Claude Code
```text
/plugin marketplace add twilio/ai
/plugin install twilio-developer-kit@twilio
claude mcp add twilio-docs --transport http https://mcp.twilio.com/docs
```

### Cursor
```text
/add-plugin twilio-developer-kit
```
Add the Execute MCP under **Cursor Settings > MCP**.

### Codex
Open **Plugins**, install "Twilio developer kit", then:
```bash
codex mcp add twilio-docs --url https://mcp.twilio.com/docs
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
    http://127.0.0.1:8080/v1   (run ./start-model.sh)
```

Verified-compatible: Claude Code, Cursor, Codex, OpenCode, Pi, GitHub Copilot,
Gemini CLI, JetBrains Junie, and 30+ more.

---

## The local model

```bash
./start-model.sh           # terminal chat + OpenAI API on :8080 (one process)
./start-model.sh --server  # API only — for tools / background use
CTX_SIZE=8192 ./start-model.sh  # larger context if you need it (~2.5 GB RAM)
```

Powered by [llamafile](https://github.com/mozilla-ai/llamafile) (Mozilla) — a single
executable, no background daemon. The default mode gives you a **terminal chat UI and
an OpenAI-compatible HTTP server in the same process**: chat right there while your
tools (OpenCode, Cursor, etc.) connect to `http://127.0.0.1:8080/v1` simultaneously.

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
./start-model.sh        # run Gemma 4 E2B locally
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
| gum | brew | `uninstall.sh` |
| Scoped API key | your Twilio account | `uninstall.sh` |
| Skills copy | `~/.agents/skills/` | `uninstall.sh` |
| llamafile + model | `tools/`, `models/` (in this repo) | `uninstall.sh` |

```bash
./setup.sh --check     # verify download URLs resolve, without installing anything
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
./setup.sh --dry-run   # walk the full setup flow without installing or downloading anything
./setup.sh --check     # verify model download URLs resolve
```

`./test.sh` runs in CI on every push (see `.github/workflows/test.yml`). It needs
no Twilio account — login, key-minting, and the live API call are exercised only in
a real `./setup.sh` run.

---

## Notes & caveats

- **Execute MCP is experimental** (Twilio Alpha). Great for building, pre-GA.
- **Dev Phone overwrites a number's webhooks** — never point it at a production number.
- **`TWILIO_MCP_CREDS`** — persist across sessions by adding to a local `.env` file
  (gitignored): `echo 'export TWILIO_MCP_CREDS="..."' >> .env && source .env`
- Model weights and the llamafile binary are git-ignored (multi-GB) — downloaded by
  `setup.sh`, never committed.

---

Built on [github.com/twilio/ai](https://github.com/twilio/ai) ·
[Twilio MCP docs](https://www.twilio.com/docs/ai/mcp) ·
[Twilio Skills docs](https://www.twilio.com/docs/ai/skills)
