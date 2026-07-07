# TwilioWorld Agentic Coding Toolkit

> ⚠️ **Experimental — in active development.** This is a demo built for the
> 2026 Twilio Assemble series, not a supported/production toolkit. Expect
> rough edges, breaking changes without notice, and gaps between what's
> documented here and what's implemented. Use it to explore, not to ship.

Arm your AI coding agent with deep Twilio expertise — Skills, live Docs MCP, and
optional real API execution — out of the box. Clone it, run one script, choose what
to install or wire into your agent, and your agent is ready to build and run real Twilio things with no hunting
through docs and no copying configs.

**Chat with the local model right inside the TUI** — no external agent required.
Or configure any coding agent — Pi, OpenCode, Claude Code, Cursor, Codex, GitHub
Copilot, or your
own — and the toolkit wires up the same Skills/Docs MCP/Execute MCP knowledge layer
for it. No agent gets special treatment: pick whichever fits, from one menu.

Twilio Skills and Twilio MCP are Public Beta Twilio surfaces. The toolkit treats
them as install choices: Twilio Skills and the read-only Docs MCP are enabled for agent setup by default,
while the execute-capable MCP stays off until you explicitly select it.

---

## Quick start

```bash
git clone --recursive <this-repo-url>
cd twilioworld-agentic-coding-toolkit
./toolkit
```

> Use `--recursive` so the Twilio Skills submodule comes down with the clone.
> Forgot it? Setup (in the menu) runs `git submodule update --init` for you.

`./toolkit` is the command you use from the repo root. Arrow keys to navigate.
The dashboard is a two-column OpenTUI app: actions on the left, status and
selected-action details on the right.

```text
╔════════════════════════════════════════════════════════════════════════════╗
║ TwilioWorld Agentic Coding Toolkit                                        ║
║                                                                            ║
║ TwilioWorld                                                                ║
║ Agentic Coding Toolkit                                                     ║
║ model missing  |  Twilio primary                                           ║
║ Next: Run Setup to download the local Gemma model and llamafile runtime.   ║
╚════════════════════════════════════════════════════════════════════════════╝

┌ Actions ───────────────────────┐ ┌ Install Choices ───────────────────────┐
│ ▶ Setup                         │ │ Install choices  Local chat model,     │
│   Configure agent               │ │ Agent Skills, Agent Docs MCP           │
│   Sign up for TwilioWorld       │ └────────────────────────────────────────┘
│   Uninstall                     │ ┌ Active ────────────────────────────────┐
│   Exit                          │ │   ·  No running toolkit services.      │
└─────────────────────────────────┘ └────────────────────────────────────────┘
                                  ┌ Selected Action ────────────────────────┐
                                  │ Purpose                                  │
                                  │   Choose what to install locally and     │
                                  │   what to wire into coding agents.       │
                                  │                                          │
                                  │ Network installs/downloads happen only   │
                                  │ after the confirmation step.             │
                                  └──────────────────────────────────────────┘

  ↑/↓ or j/k navigate    Enter run    Setup changes install choices    q quit
```

Setup asks what to install or wire once, then Configure agent uses those choices
silently. The fastest path to a working agent is:

1. Run `./toolkit` → **Setup** → choose what to install (Gemma is on by default —
   it powers in-app chat and, if you pick Pi, Pi too)
2. Back at the menu → **Chat with Twilio** for instant Q&A, or **Configure
   agent** → pick any agent (Pi included) to wire it up

**Chat with Twilio** and **Model server** only appear after the local model and
runtime are installed. **Dev Phone** appears only if it is selected or already
installed. **Sign up for TwilioWorld** is always visible and opens
`https://twilio.world` in your browser.

Setup, agent configuration, local chat, and model server control all run inside the
TUI dashboard. **Pi** and **Dev Phone** are different — they're real interactive CLIs,
so choosing them opens a brand-new terminal window and runs there. The dashboard
keeps running in this window; nothing is suspended or handed over. Every agent —
Pi included — is configured through the same "Configure agent" menu item; none of
them get a dedicated menu entry or install-choice toggle of their own. Pi is the one agent
the toolkit can fully install and launch for you (it needs a model to talk to and a
process to start); the others are external tools you already have, so Configure
agent prints the exact MCP-wiring command for those instead.

Your install choices live in `.toolkit/config.json` and are local to your machine.
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
| **Twilio CLI** | The command line to all things Twilio, logged in and ready. |
| **Dev Phone** | A browser soft phone — make/receive real SMS + voice with no physical device. |
| **Pi** *(one of several agent options)* | [Pi](https://pi.dev) is the one agent the toolkit can fully install, wire, and launch for you — Configure agent → Pi does everything in one step. |
| **TwilioWorld signup** | Always-visible dashboard action that opens `https://twilio.world` in your browser. |

### Install choices

The base toolkit gives you the menu and repo-local assets. Setup groups choices
under **Local chat**, **Coding agents**, and **Twilio tools**. Those choices decide
what gets installed locally and what gets attached when you configure an agent:

| Choice | What it does | Default |
| --- | --- | --- |
| Local Gemma model | Required for Chat with Twilio; also serves `http://127.0.0.1:8080/v1` for other tools (including Pi) | ✓ on |
| Twilio Skills for agents | Installs Twilio Skills where coding agents can find them | ✓ on |
| Docs MCP for agents | Adds searchable live Twilio API reference to configured agents | ✓ on |
| Execute MCP for agents | Lets configured agents call real Twilio APIs | off |
| Dev Phone | Browser SMS/voice test phone | off |

There's no "which agent do I use" setup choice — that's not a machine-wide setting,
it's a choice you make each time you open Configure agent. Skills and MCP choices
attach to whichever agent you configure, if you selected them.

Use Skills and Docs MCP together: Skills guide product choice, architecture, and
pitfalls; Docs MCP retrieves current endpoint schemas and documentation details.

---

## Prerequisites

- **Node.js**, **git**, **curl** (the script checks these)
- A **Twilio account** (only needed for Execute MCP and Dev Phone)
- ~2.5 GB free disk if you want the local Gemma model

The toolkit can install the Twilio CLI, Dev Phone plugin, supported agent CLIs,
llamafile runtime, and local Gemma model files when those choices are selected.

---

## What the setup does

1. **Prerequisites** — verifies node, git, curl.
2. **Twilio CLI** — installs if needed for Execute MCP or Dev Phone, then checks for an active login.
3. **API key** — mints a scoped key via `twilio api:core:keys:create` for the Execute MCP, so your root Auth Token never lands in a config string.
4. **Local model** — downloads the llamafile runtime + Gemma 4 E2B weights only if selected.
5. **Dev Phone** — installs the plugin only if selected.
6. **Skills** — initializes the submodule and installs skills globally if the agent Skills choice is enabled.

If a Twilio account is active, Setup verifies the credentials with a real API call.
When it finishes, it returns you to the dashboard.

---

## Per-agent setup

The toolkit uses each agent's **native** install path — nothing proprietary. Each
supported agent starts from the same place: `./toolkit` → **Configure agent** →
pick one. For the CLI-based agents — Claude Code, Codex, Cursor, OpenCode, and
GitHub Copilot — that step is identical: it installs the agent if it's missing,
wires your selected Skills/MCP choices, and opens the agent in a brand-new
terminal window. Pi is the only structural exception: it's a local agent, so
Configure agent also starts the local Gemma model it talks to before launching.

### Claude Code

```bash
./toolkit
# choose: Configure agent → Claude Code
```

That step:
- installs Claude Code if it isn't on PATH yet (Homebrew cask → npm → the official
  install script, in that order)
- adds the `twilio-developer-kit` plugin marketplace + plugin if Skills are enabled
- adds the Docs MCP and/or Execute MCP if those choices are enabled
- opens `claude` in a brand-new terminal window — sign in there on first run

**Manual equivalent**, if you'd rather do it yourself:
```text
brew install --cask claude-code        # or: npm install -g @anthropic-ai/claude-code
claude plugin marketplace add https://github.com/twilio/ai
claude plugin install twilio-developer-kit@twilio
claude mcp add twilio-docs --transport http https://mcp.twilio.com/docs
```

### Codex

```bash
./toolkit
# choose: Configure agent → Codex
```

That step:
- installs Codex if it isn't on PATH yet (Homebrew → npm → the official install
  script, in that order)
- adds the Docs MCP and/or Execute MCP if those choices are enabled (Codex's
  plugin marketplaces aren't auto-wired yet — see the manual step below)
- opens `codex` in a brand-new terminal window — sign in there on first run

**Manual equivalent:**
```bash
brew install codex                     # or: npm install -g @openai/codex
codex mcp add twilio-docs --url https://mcp.twilio.com/docs
# Plugins: open Codex → /plugins → install "Twilio developer kit"
```

### Cursor

```bash
./toolkit
# choose: Configure agent → Cursor
```

That step installs the [Cursor CLI](https://cursor.com/docs/cli) (`cursor-agent`)
if it isn't on PATH yet (Homebrew cask → the official install script), then opens
it in a brand-new terminal window. MCP and plugin wiring for Cursor isn't
CLI-scriptable yet, so Configure agent prints the manual steps:

```text
In Cursor Composer or the CLI:  /add-plugin twilio-developer-kit
Add Execute MCP under Cursor Settings > MCP, or run the Execute MCP one-liner
Configure agent prints for you.
```

### OpenCode

`opencode.json` (in this repo) defines both MCP servers, committed with static
defaults that match the toolkit's own defaults: Docs MCP on, Execute MCP off.
This file is never modified by the toolkit — if your install choices differ
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
source .toolkit/.env   # created by Setup, chmod 600 — never printed to the log

# If you enabled Execute MCP as an install choice, Configure agent will have printed
# an override like this (opencode.json's committed default stays off):
export OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json","mcp":{"twilio-execute":{"enabled":true}}}'
```

Configure agent installs OpenCode for you (Homebrew tap → npm) if it isn't on
PATH yet, then opens it in a brand-new terminal window — the same as every other
CLI-based agent. OpenCode still needs a model before it's useful, so run its
`/connect` step in that window to pick one (Anthropic, OpenAI, or OpenCode Zen).

### Pi

Pi is the agent the toolkit fully installs, wires, **and launches** with zero
manual follow-up beyond that. It needs a model to talk to (local Gemma) and a
process started, so Configure agent does all of that in one step and opens Pi in
a brand-new terminal window:

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
recommended pairing) — or just use **Chat with Twilio** from the menu for quick
Twilio Q&A without installing Pi at all.

**Manual launch** (Configure agent is simpler):

```bash
# After Setup installs the local model, start "Model server" from the TUI first.
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
    http://127.0.0.1:8080/v1   (choose Model server in the TUI after Setup)
```

Verified-compatible: Claude Code, Cursor, Codex, OpenCode, Pi, GitHub Copilot,
Gemini CLI, JetBrains Junie, and 30+ more.

---

## The local model

```bash
./toolkit                   # choose "Chat with Twilio" or "Model server"
CTX_SIZE=65536 ./toolkit    # even more headroom for long multi-tool sessions
```

Powered by [llamafile](https://github.com/mozilla-ai/llamafile) (Mozilla) — a single
executable. The TUI starts the local OpenAI-compatible server in the background and
renders chat inside the OpenTUI dashboard, so the toolkit does not appear to exit
when you choose **Chat with Twilio**. Tools (OpenCode, Cursor, etc.) can connect
to `http://127.0.0.1:8080/v1` at the same time.

### The built-in web UI on `:8080`

llamafile is Mozilla's packaging of [llama.cpp](https://github.com/ggml-org/llama.cpp)'s
server, so when the model server is running it exposes **two things on the same
port 8080**:

| Path | What it is | Who uses it |
| --- | --- | --- |
| `http://127.0.0.1:8080/` | llama.cpp's built-in **web chat UI**, compiled into the llamafile binary | you, in a browser — a quick way to poke the raw model |
| `http://127.0.0.1:8080/v1` | the **OpenAI-compatible API** | the toolkit's in-app chat, OpenCode, Cursor, Pi, etc. |

The web UI itself ships inside the `tools/llamafile` binary downloaded during
Setup — this toolkit doesn't build it. But with the MCP proxy enabled (below),
the toolkit automatically opens the web UI in your browser and pre-configures
it: the Twilio Docs MCP server is wired in and a Twilio-aware system message is
set, so it behaves like a Twilio-aware assistant from the first message — no
manual Settings navigation required. Use **Chat with Twilio** in the TUI (or a
configured agent) for the toolkit's full tool surface (Skills, status/config
introspection); use the web UI at `:8080/` when you want that Twilio-aware
assistant in a plain browser tab instead.

> The web UI binds to `127.0.0.1` only — it is not exposed off your machine. If you
> run the model server inside one of the `demo/` GUI containers, note that noVNC
> also historically used 8080; the demo containers serve noVNC on a different port
> so the two don't collide (see each `demo/*/README.md`).

### Setting up the Twilio MCP server inside the web UI (experimental)

llama.cpp's web UI has its own MCP client, separate from — and much more limited
than — the toolkit's Skills/Docs MCP/Execute MCP wiring for coding agents. Two
real constraints, straight from upstream llama.cpp:

- **HTTP/SSE/WebSocket only — no stdio.** The Docs MCP (`https://mcp.twilio.com/docs`,
  no auth) works. The **Execute MCP does not** — it launches via
  `npx @twilio-alpha/mcp ...` over stdio, which a browser cannot spawn. Use a
  configured agent (Configure agent → any agent) for Execute MCP instead.
- **The bundled llamafile has no OpenSSL.** llamafile 0.10.3's CORS proxy
  (`--ui-mcp-proxy`) can only reach `http://` targets — pointing the web UI
  directly at `https://mcp.twilio.com/docs` fails with
  `HTTPS requested but CPPHTTPLIB_OPENSSL_SUPPORT is not defined`. The toolkit
  works around this with a tiny local HTTP→HTTPS bridge (see below).

**1. Turn it on** — check **"Enable MCP in the local model web UI"** in Setup (off
by default; it's experimental, and llama.cpp's own docs say "do not enable in
untrusted environments" since it opens a CORS proxy in the local server).

**2. That's it.** From then on, any time you choose **Model server** or **Chat
with Twilio** from the menu, the toolkit starts everything wired up and opens the
web UI already configured — no clicking through Settings, no pasting URLs.

Under the hood, when the addon is on the toolkit:
- passes `--ui-mcp-proxy` to enable llama.cpp's browser CORS proxy
- writes `.toolkit/webui/ui-config.json` and passes it via
  `--ui-config-file` — this is llamafile's built-in mechanism for seeding the
  web UI's default settings **server-side**, so the Twilio Docs MCP server and a
  Twilio-aware system message are present the first time the UI loads (no
  browser `localStorage` injection)
- starts `tools/mcp-proxy.js` — a dependency-free Node.js HTTP→HTTPS bridge on
  `127.0.0.1:18080` that forwards to `https://mcp.twilio.com/docs`. The web UI's
  MCP server is set to `http://127.0.0.1:18080/`, so the request path is
  `browser → llamafile /cors-proxy (plain HTTP) → bridge → mcp.twilio.com`.

The full chain (web UI → CORS proxy → bridge → Twilio) completes a real MCP
`initialize` handshake — verified end to end.

> `--ui-config-file` and `--ui-mcp-proxy` are new upstream (llama.cpp PR
> [#18655](https://github.com/ggml-org/llama.cpp/pull/18655)) and marked
> experimental. If a future llamafile ships with OpenSSL, the bridge becomes
> unnecessary and the config can point straight at `https://mcp.twilio.com/docs`.

The in-app chat starts the local server with reasoning disabled and supports a small
safe tool surface for toolkit introspection: local status, install choices, and
local Twilio Skill listing. It does **not** call real Twilio APIs from chat; use
the Execute MCP in a configured agent for that.

**Memory footprint:** the model runs with a 32 768-token context window and a
quantized KV cache (`q4_0`), keeping runtime RAM around **~3-3.5 GB** (the
quantized KV cache scales with context size, but is small relative to the
model weights, so doubling the window doesn't double total RAM). That covers
the full Twilio Skills system prompt plus many turns of conversation comfortably
(a 4096-token window was tried first and reliably ran out of context within 2-3
turns once the Skills prompt was included, and even 16 384 got tight in longer multi-tool
Pi/agent sessions — a security/reliability audit flagged the original issue
before the event, see "Notes & caveats" below).
Override the context window with `CTX_SIZE=<n>` if a task needs even more room.

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
| Skills copy | `~/.agents/skills/twilio/`, `~/.agents/skills/sendgrid/` | `uninstall.sh` |
| Local toolkit copy of Skills | `vendor/twilio-ai/skills/` | `uninstall.sh` |
| Local config + Execute MCP creds | `.toolkit/config.json`, `.toolkit/.env` | `uninstall.sh` |
| llamafile + model | `tools/`, `models/` (in this repo) | `uninstall.sh` |

```bash
./toolkit              # choose Uninstall for an in-TUI checklist
./uninstall.sh         # same cleanup from a shell, with a confirmation per item
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
- **`TWILIO_MCP_CREDS`** — Setup writes it to `.toolkit/.env` (chmod 600, gitignored,
  never printed to the log) instead of echoing it to stdout/shell history. Load it
  with `source .toolkit/.env`.
- Model weights plus local runtime binaries are git-ignored. Setup currently
  downloads Gemma/llamafile only; voice runtime paths are reserved for the
  coming-soon Whisper work.
- **Don't run `./toolkit` as root/sudo.** It refuses to start as root (E-8/H-4)
  so downloaded models and `.toolkit/config.json` never end up root-owned,
  breaking subsequent normal-user runs.
- **Downloaded binaries are structurally verified**, not just downloaded —
  llamafile's magic bytes are checked before `chmod +x` runs, so a captive-portal
  page or corrupted transfer gets rejected and deleted instead of executed
  (C-1/H-3). A pinned SHA-256 check is a planned follow-up
  (`LLAMAFILE_SHA256` in `tui/src/lib/constants.ts`) once a hash is verified
  per platform for the pinned llamafile release.

---

Built on [github.com/twilio/ai](https://github.com/twilio/ai) ·
[Twilio AI docs](https://www.twilio.com/docs/ai) ·
[Twilio MCP docs](https://www.twilio.com/docs/ai/mcp) ·
[Twilio Skills docs](https://www.twilio.com/docs/ai/skills)
